# Phase 0 Research: Asset Summaries

All spec ambiguities were resolved in `/speckit-clarify` (see spec.md Clarifications). The only
item left to planning was FR-C3 (exact companion/provenance encoding), resolved below. This file
also records the technical decisions that ground the plan in the shipped codebase.

## Decision 1 — Claude access: shelled `claude` CLI adapter, NOT a new HTTP API client

**Decision**: Implement `SummarizationRunner` as a **shelled `claude` CLI adapter**, mirroring
`createClaudeCli` (`src/claude/client.ts`) behind the `TranslationEngine`-style interface, with
the model configurable via `--model` and defaulting to `claude-sonnet-5`.

**Rationale**:
- The codebase reaches Claude **only** through the `claude` CLI today — there is no
  `@anthropic-ai/sdk` dependency, no `ANTHROPIC_API_KEY` handling, no HTTP client anywhere
  (verified by grep). Adding an HTTP SDK would introduce net-new key management, a new dependency,
  and a second Claude-access path divergent from OCR/translation.
- The design doc says "Claude via API" but also "**shelled** behind an interface with constructor
  injection — mirroring how OCR / translation engines are already composed." "Shelled" + "mirror
  the existing engines" resolves to the CLI adapter; "API" is the loose sense (the CLI wraps the
  API). Constitution VI (mirror existing composition) and VIII (faithful adoption, no divergent
  shadow implementation) both point at reuse.
- The `claude` CLI accepts `--model`, so "configurable, default Sonnet 5" (FR-011, clarified) is
  fully satisfiable via the CLI adapter — `--model claude-sonnet-5`.

**Alternatives considered**:
- *Net-new Anthropic HTTP SDK client* (`@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`): rejected for v1
  — new dependency + secret handling + a second Claude path, no capability the CLI lacks for this
  use. Retained as a future option if streaming/fine cost-control/model-pinning guarantees are
  later required. **SURFACED to the operator** (Constitution XIV): if the operator specifically
  wants the HTTP API, this is their call to make; the interface seam makes the swap a one-adapter
  change.
- *Reuse the `codex` engine as well*: the factory (`createSummarizer(name)`) leaves room for a
  `codex` summarizer for free (mirrors `engine/factory.ts`), but v1 wires only `claude`.

## Decision 2 — Thorough-summary encoding (FR-C3, FR-001a): markdown body + YAML frontmatter

**Decision**: The thorough artifact `issue.summary.long.en.md` is a markdown file whose
**YAML frontmatter** carries the structured fields (`topics`, `people`, `places`, `dates`,
`claims`) and whose **body** is the narrative prose. The concise artifact
`issue.summary.short.en.md` is plain markdown (~1–3 sentences), no structured fields.

**Rationale**: keeps one human-readable file per artifact (readable in the browser and by a
researcher), while the structured fields are machine-parseable for later `corpus-gap-closure`
consumption (FR-017, produce-only). Frontmatter is already how the repo mixes structured + prose
in authored docs, and the browser already parses YAML on read (`src/browser/load/translation.ts`
uses the `yaml` lib). The structured fields stay a documented, stable shape (FR-017).

**Alternatives**: separate `.json` sidecar for structured fields (rejected — splits one logical
summary across two files, more to keep in sync); structured-only, no prose (rejected — spec wants
a readable finding-aid).

## Decision 3 — Provenance sidecar shape: derive-from-source-page + summary-specific block

**Decision**: `buildSummaryProvenance(...)` mirrors `buildTranslationProvenance`
(`src/translate/artifacts.ts`): derive from the source page's companion to inherit
rights/catalog metadata, then override the derived-specific fields — `type`
(`summary-thorough` | `summary-concise`), `format: 'text/markdown'`, `language: 'English'`,
`engine`, `model`, `object_store: null`. Add summary-specific fields:
- `interpretation: 'machine-generated-summary'` — the explicit "interpretation, not evidence"
  label (FR-005/FR-006).
- `input_layers`: a list of `{ path, sha256 }` for each input companion actually used (English
  OCR; or French OCR + English translation) — this is BOTH the provenance record (FR-005) AND the
  idempotency key source (Decision 4).
- `input_quality` (optional, nested `{ tier: low|medium|high, note }`) — the low-confidence note
  from FR-016, populated when the input OCR's `ocr_quality.tier` is `low`. Mirrors the existing
  `ocr_quality` nested-block precedent.

**Rationale**: reuses the single canonical serializer (`writeProvenance`/`serializeProvenance`)
and the additive-optional-field convention (unset fields omitted, so unrelated records
re-serialize byte-identically). No second sidecar format.

## Decision 4 — Idempotency: input-layer sha key (FR-010)

**Decision**: A summary is up-to-date iff the summary artifact exists AND every entry in its
sidecar's `input_layers[*].sha256` still matches the current sha of that input companion
(read via `readRecordedSha`/`readProvenance` on `issue.txt.yml` / `issue.en.txt.yml`).
`summarizeIssue` skips when up-to-date (unless `--force`); regenerates when any input sha differs.

**Rationale**: mirrors `isAssetRecorded` (checksum-in-sidecar skip) and extends it to the
"regenerate when OCR/translation changes" requirement — the input shas ARE the cache key. Matches
the OCR/translation skip discipline (`src/ocr/run.ts` `ocrIssue` force-guard) and is testable via
`tests/integration/translate-idempotent.test.ts` as the template.

## Decision 5 — Bibliography reference: by-path pointer, `census:`-style (FR-007)

**Decision**: Add an optional `summaryRef` (archive-relative path string) to the source record —
pointing at the source **rollup** thorough summary — mirroring the existing `census:` by-path
pointer idiom (`repositoryRecords[*].census: data/census/…`). The exhaustive prose is NEVER
inlined into the YAML; the record holds only the path. Per-issue thorough summaries are reachable
via the archive layout; the SSOT reference is the source-level rollup.

**Rationale**: `census:` already proves the "bibliography record points at an external artifact by
path, not inlined" pattern the SSOT accepts; reuse it rather than invent a new mechanism. Keeps the
structured SSOT clean (FR-007, SC-005) and the summary regenerable.

**Validation note**: `src/bibliography/validate-companion-coverage.ts` enforces SSOT↔companion
lock-step for B2-direct keys — the summaryRef addition must stay outside its false-positive scope
(it points at git-resident markdown, `object_store: null`, like OCR/translation text), and a
light "summaryRef resolves to an existing artifact" check is added rather than reusing the
B2-key-prefix validator.

## Decision 6 — Best-available-text selection (FR-002)

**Decision**: input selection per issue: if an English translation companion exists
(`issue.en.txt`), use French OCR (`issue.txt`) + the English translation as inputs; else if the
source is English-language, use English OCR (`issue.txt`); else fail loud (FR-003). The selection
is a small, tested pure function over which companions are present, recorded in `input_layers`.

**Rationale**: matches the corpus reality (French sources get OCR+translation; Papers Past items
are English OCR) and makes the "which layers were used" auditable via provenance.

## Decision 7 — Website display (US2/FR-008): honest-absence loader + design skill

**Decision**: add `src/browser/load/summary.ts` mirroring `load/translation.ts` (honest-absence:
missing summary → `null`, never fabricated), surface `conciseSummary?` + a `MachineAssistLabel`
on `IssueView` and `SourceView` (`src/browser/model.ts`), wire into `load/corpus.ts`. The actual
UI (Astro under `site/`) is built **only** through `/frontend-design:frontend-design`
(Constitution XI) — the loader/view-model is data plumbing; the rendered abstract is design work.

## Open items carried to tasks

- None blocking. The `/frontend-design` invocation is a hard precondition on the browser-display
  task (not startable without it).
- Operator may override Decision 1 (CLI vs HTTP API) — surfaced, not assumed-final.
