# Design: Source Translation (`impl:feature/source-translation`)

- Date: 2026-07-08
- Roadmap item: `impl:feature/source-translation` (depends-on `impl:feature/gallica-fetcher`)
- Status: designing (awaiting operator approval)
- Backend: `superpowers:brainstorming`, driven under `stack-control:design`

## Problem domain

The gallica-fetcher now mirrors public-domain French sources and self-OCRs them
into `issue.txt` (French) per fascicle in the private archive. But the project's
stated goal is an **English-language** research archive, and there is no mechanism
to turn that French OCR into readable English.

`AGENTS.md` § "Handling translations" already sets the rules any mechanism must
follow: retain the original-language citation, **label translations as
machine-assisted** unless human-reviewed, do not commit full translations of
*copyrighted* works, quote sparingly with page references.

Two facts shape the design:

- **Copyright is favorable.** *La Nouvelle France* (1879–1885) and the other Port
  Breton primary sources are public-domain by age, so a **full English
  translation is committable** (the "no full translations of copyrighted works"
  caveat bites only for later copyrighted secondary sources).
- **The input is noisy.** The OCR carries real errors (broken ligatures,
  hyphenation, BnF condition markers like *"Contraste insuffisant"*), so raw text
  is a poor direct translation input.

## Solution space

### Chosen — reusable TS/tsx CLI that shells out to the Claude Code CLI, cleanup-then-translate

Mirrors the fetcher's shape (thin client + DI + fail-loud), with an external CLI
behind a dependency-injected runner exactly like the OCR pipeline shells out to
`ocrmypdf`.

- **`ClaudeCli` runner** — invokes the Claude Code CLI (`claude -p <prompt>`,
  non-interactive/print mode) via an injected command runner so tests stub it. A
  **preflight** verifies `claude` is on PATH and fails loud with install/auth
  guidance when absent (gated only when a translation is requested).
- **Cleanup pass** — one `claude` invocation that produces a **corrected French
  transcription** from the OCR (dehyphenate, join broken lines, repair obvious
  scan errors, drop non-text condition markers). This corrected French is itself
  a durable research artifact, kept alongside the original OCR.
- **Translation pass** — French → **whole-issue readable English** via `claude`.
- **Artifact writer** — stores the corrected French + the English next to the
  source, each with a provenance record: `engine: claude-code-cli`, model/date,
  the **`translation: machine-assisted`** label, and the original-language
  citation — conforming to the archive's existing companion-YAML convention and
  `AGENTS.md`.
- **CLI** — `translate <issueArk>` and `translate-source <sourceId>` (iterate the
  archived issues of a source); `--dry-run` (report intended work, write nothing),
  `--force` (re-translate). Reusable across any archived `issue.txt`; first target
  is La Nouvelle France (`PB-P001`).

Rationale: reusing the Claude Code CLI leverages the operator's existing auth /
subscription (no API key or billing wiring in the tool), and the LLM handles 19th-c
French register + OCR noise and can flag uncertainty — better than a raw MT.
Cleanup-first yields a corrected-French artifact *and* a better translation input.

### Rejected — call the Anthropic API directly

A TS tool using the Anthropic Messages API. Rejected by operator decision
(2026-07-08): it requires an API key + per-token billing to manage, whereas
shelling out to the Claude Code CLI reuses existing subscription auth. (The
`claude-api` reference is therefore out of scope here — no API surface is used.)

### Rejected — dedicated machine-translation service (DeepL / Google)

Cheaper/faster but blunter on archaic French and OCR errors, cannot flag
scholarly uncertainty, and adds an external paid dependency. Weak fit for
primary-source translation.

### Rejected — translate raw OCR without a cleanup pass

Simpler, but the OCR noise propagates into the English and no corrected-French
artifact is produced. Operator chose cleanup-first.

### Rejected — per-article segmentation / entity extraction

Higher-value but much larger scope; entity extraction (people/ships/places) is
really the separate future **evidence-model** feature (Phase 3 research), not
translation v1. Deferred.

## Decisions

1. **Engine**: shell out to the **Claude Code CLI** (`claude -p`), NOT the
   Anthropic API. Reuses operator auth/subscription.
2. **Runtime**: TypeScript + `tsx`, `@/` imports, no `any`/`as`/`@ts-ignore`,
   composition + DI, files ≤ 300–500 lines (same house rules as the fetcher).
3. **Cleanup-then-translate**: produce a corrected French transcription first,
   then translate it to English. Both are durable artifacts.
4. **Granularity**: whole-issue readable English per `issue.txt` (v1).
5. **Reusable**: works on any archived source's OCR text; first target `PB-P001`.
6. **External-CLI preflight (fail loud)**: verify `claude` is available before any
   translation; gated only when translation is requested.
7. **Provenance + labeling (AGENTS.md)**: every translation/cleaned artifact
   carries a companion record — `engine: claude-code-cli`, model + date,
   `translation: machine-assisted`, and the original-language citation.
8. **Copyright**: only translate public-domain sources to a committable full
   translation; a copyrighted source must not get a committed full translation
   (fail loud / refuse), consistent with `AGENTS.md`.
9. **No fallbacks**: missing `claude`, a failed translation, or ambiguous rights
   → throw a descriptive error; never emit fabricated or partial output.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Pass staging**: two `claude` calls (cleanup → translate) vs one call emitting
  both corrected-French and English. Lean two calls (separable artifacts, simpler
  prompts); decide in the spec.
- **`claude -p` invocation details**: exact flags, how the source text is passed
  (stdin vs argument vs a temp file), output capture, and non-interactive/JSON
  output mode. Spike in the spec.
- **Storage location**: translations alongside the source in the private archive
  vs a public `translations/` tree — since they are derived English of PD text,
  they *may* be publishable, unlike the heavy image masters. Decide in the spec.
- **Bulk pacing / rate limits**: the subscription rate limits on a `translate-source`
  run over dozens of issues; likely needs polite spacing / resumability like the
  fetcher.
- **Quality signalling**: whether to have `claude` mark low-confidence spans for a
  later human-review surface (deferred from v1, but the provenance should leave
  room for it).

## Provenance

- Origin: interactive design conversation, 2026-07-08, driven under
  `stack-control:design` with the `superpowers:brainstorming` backend.
- Decisions 1, 3, 4, 5 sourced from operator answers to four `AskUserQuestion`
  prompts (engine, OCR-noise handling, granularity, scope), plus the explicit
  operator correction "we will shell out to claude code cli" (decision 1).
- Translation policy (decisions 7, 8) sourced from `AGENTS.md` § "Handling
  translations".
- Input artifact (`issue.txt`) is produced by the shipped `impl:feature/gallica-fetcher`.
- Handoff target: `/stack-control:define`.
