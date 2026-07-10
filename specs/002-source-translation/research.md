# Phase 0 Research: Source Translation

All open questions carried in from the design record and the spec's Assumptions are resolved below. Format: Decision / Rationale / Alternatives considered.

## R1 — Claude Code CLI invocation (`claude -p`)

**Decision**: Shell out to `claude --print` (non-interactive), passing the instruction as the prompt argument and the page's source text on **stdin**, capturing **stdout** as the result. Pin the model with `--model <alias-or-full-name>` and record the resolved model in provenance. Default `--output-format text` (raw text out); a structured mode (`--output-format json`) is available if we later need the wrapper's metadata. The invocation goes through a DI'd runner so tests never call the real CLI.

**Rationale**: Verified against the installed CLI (`claude --help`): `-p, --print` "Print response and exit (useful for non-interactive mode)"; `--model`, `--append-system-prompt`, `--input-format`, and `--output-format` all documented and gated to `--print`. Reuses the operator's subscription auth — no API key, no billing wiring (design decision 1). `claude` is on PATH here (aliased to `~/.local/bin/claude`).

**Alternatives considered**: Anthropic Messages API (rejected by operator — needs API key + billing); embedding source text in the prompt argument instead of stdin (rejected — large 19th-c pages bloat argv and risk shell-quoting issues; stdin is clean); `--output-format json` as default (rejected for v1 — we only need the text; adds parsing surface).

**Carried to tasks**: confirm exact flag spelling on the target machine's installed `claude` version during the first integration wiring; decide the `--append-system-prompt` vs in-prompt split for the cleanup/translation instructions.

## R2 — Page chunk boundary (the natural chunk unit)

**Decision**: The chunk unit is the **page**, and per-page text is obtained by splitting the existing whole-issue `issue.txt` on the **form-feed character (`\f`, 0x0C)**. Page N of the split aligns with page image `fNNN.jpg`.

**Rationale**: **Empirically confirmed.** The shipped OCR pipeline (`src/ocr/run.ts`) runs `pdftotext searchablePdf textFile` **without `-nopgbrk`**, so `pdftotext` emits a form-feed at every page boundary. A real archived issue — `port-breton/newspapers/la-nouvelle-france/1881-09-15_bpt6k5606854m/issue.txt` (126 KB) — contains **20 form-feeds** (≈21 pages), matching its page-image count. This makes per-page chunking a pure, offline string split of an artifact that already exists; no re-OCR, no re-fetch, no network.

**Alternatives considered**: Re-OCR per page to get per-page text (rejected — wasteful; the text already exists); treat the whole issue as one chunk (rejected — violates the operator's small-blast-radius / idempotency / integration-testability requirement, FR-016); split on heuristic length/paragraph boundaries (rejected — arbitrary, non-reproducible, unaligned with the page images).

**Carried to tasks**: handle a trailing empty chunk after the final `\f`; decide whether a blank/near-empty page chunk is skipped-with-note vs errored (spec Edge Case "empty or near-empty OCR").

## R3 — Rights determination (public-domain gate) without network

**Decision**: Read the issue's `rights_status` **offline** from an already-stored page companion YAML (written by the fetcher at fetch time), and refuse (fail loud, write nothing) unless it is `public-domain` (FR-008). Do **not** re-query Gallica's OAIRecord endpoint.

**Rationale**: Mirrors exactly how `src/ocr/run.ts` reuses `readProvenance(companionYamlPath(pageFiles[0]))` for derived-asset metadata and never re-verifies rights or touches the network. The rights gate already ran at fetch time; the determination is durable in provenance. `ProvenanceFields.rights_status` carries it. This keeps translation fully offline and deterministic.

**Alternatives considered**: Re-run `assertPublicDomain(issueArk, client)` from `@/rights/gate` (rejected — needs an `OaiRecordClient` + network for a fact already recorded; couples translation to Gallica availability); trust a source-level rights flag (rejected — the per-issue provenance is the authoritative, already-verified record).

**Carried to tasks**: locate the issue dir via `findIssueDir(sourceId, issueArk, archiveRoot)` (offline, no census), then read the first page's `.yml` for `rights_status` and citation fields.

## R4 — Provenance format + reuse

**Decision**: Write a per-artifact **YAML companion** (`.yml`) using the existing `@/archive/provenance` module (`ProvenanceFields`, `writeProvenance`) and `@/archive/store` (`storeAsset`, `companionYamlPath`). Corrected-French and English artifacts each get their own `.yml`. Required fields (FR-006): engine `claude-code-cli`, model, date (`retrieved`), the machine-assisted label, and the original-language citation (carried from the source page's provenance: `catalog_url`, `title`, `language`).

**Rationale**: The shipped, on-disk convention is YAML (`serializeProvenance` → `key: "value"`; `companionYamlPath` → `.yml`; the archive's `PB-P001.yml`). Operator confirmed "match the fetcher" = YAML (2026-07-08), correcting the earlier "JSON" mis-statement. Reuse means one provenance writer, one write-guard, one manifest across the whole archive.

**Open detail for tasks**: `ProvenanceFields` has no dedicated `engine`/`model`/`translation` keys — decide whether to (a) carry the machine-assisted label + engine + model in the existing `notes` field as a structured line, or (b) extend `ProvenanceFields` with optional keys. Leaning (b) with additive optional fields so the label is first-class and queryable, while keeping the fetcher's existing records valid. This is an additive change to a shared type — flag its blast radius in tasks.

## R5 — Artifact naming + storage location

**Decision**: Store translation artifacts in the issue directory **alongside `issue.txt`** (private archive; SSOT). Proposed names: `issue.fr.txt` (corrected French, whole-issue assembled) and `issue.en.txt` (English, whole-issue assembled), each with its `.yml` companion (`issue.fr.txt.yml`, `issue.en.txt.yml` per `companionYamlPath`'s append rule for non-image assets). Per-page intermediates (for resumability) live under a subdir, e.g. `translation/pNNN.fr.txt` / `translation/pNNN.en.txt`, so a completed page is skippable on re-run.

**Rationale**: "Alongside source" clarified 2026-07-08; the write-guard (`assertInsideArchive`) already covers the issue dir. Whole-issue assembled artifacts match the design's "whole-issue readable English"; per-page intermediates deliver the page-level resumability guarantee (FR-012/FR-016) — a present, checksum-recorded page is skipped via the existing `isAssetRecorded` mechanism.

**Alternatives considered**: Public `translations/` tree (deferred — out of scope v1, clarified); only whole-issue artifacts with no per-page intermediates (rejected — can't resume mid-issue, breaks the small-blast-radius requirement); per-page as the only output with no assembly (rejected — design requires whole-issue readable English).

**Carried to tasks**: finalize the exact filenames/subdir and confirm they don't collide with fetcher outputs (`issue.txt`, `issue.pdf`, `f###.jpg`).

## R6 — Whole-source pacing + consecutive-failure abort

**Decision**: `translate-source` iterates the source's archived issues (discovered on disk, like the fetcher), skipping already-translated issues (resumable), paces `claude` calls with a small inter-call delay (injected/configurable, defaulting to a polite constant), and **aborts after N consecutive issue failures** (FR-017). Default **N = 3**.

**Rationale**: Subscription rate limits over dozens of issues need polite spacing (mirrors the fetcher's `src/gallica/rate-limiter.ts` ethos). Consecutive failures signal a systemic problem (expired auth, exhausted quota) where continuing only burns calls; N = 3 tolerates isolated bad issues while catching a systemic break quickly. Both the delay and N are injected for testability.

**Alternatives considered**: Abort on first failure (rejected — one bad issue shouldn't stop a long run); never abort (rejected — burns calls against a systemic outage); a time-based circuit breaker (rejected — over-engineered for v1; a consecutive-count is simpler and directly testable).

**Carried to tasks**: confirm issue discovery reuses the fetcher's on-disk enumeration; make N and the delay injectable with the stated defaults.

## R7 — Archive root resolution (worktree nuance)

**Decision**: Resolve the archive with the reused `resolveArchiveRoot(repoRoot)` → `../colony-cults-archive` relative to the **public repository root**. The effective archive is `/Users/orion/work/colony-cults-archive` (confirmed present, with real `PB-P001` issues).

**Rationale**: `resolveArchiveRoot` is the single authoritative resolver (`@/archive/location`); reuse it rather than hardcode a path. Note: this feature is being authored in a **worktree** (`.../colony-cults-work/source-translation`) whose sibling is not the archive — so `repoRoot` must be the mainline public repo root, not the worktree path, or the resolver points at a non-existent sibling.

**Carried to tasks**: determine `repoRoot` from the package/mainline location (not `process.cwd()` blindly) so the resolver lands on the real archive in both mainline and worktree checkouts; cover this in an integration test with a tmp archive root injected.

## R8 — External-CLI runner reuse

**Decision**: Reuse the generic `execCommand(command, args)` from `@/ocr/exec` for the `claude` shell-out (it is tool-agnostic and already tested), wrapped by a small `ClaudeCli` runner + an `assertClaudeAvailable()` preflight modeled on `@/ocr/preflight`'s `assertOcrToolchain`.

**Rationale**: `execCommand` is already generic (`command`, `args`, captures stdout/stderr/exitCode, never rejects). Reuse avoids a duplicated child-process wrapper. The preflight mirror gives the same fail-loud UX (name the missing tool + how to install/auth), gated to fire only when translation is requested (FR-009).

**Alternatives considered**: Duplicate a ~30-line runner under `src/claude/exec.ts` (rejected — needless duplication); promote `execCommand` to a neutral `@/exec/command` module shared by both `ocr` and `claude` (viable and cleaner long-term, but touches shipped fetcher import paths — deferred to a follow-up unless tasks find it low-risk). For v1, import the existing `execCommand`; note the naming coupling for a future consolidation.
