# Feature Specification: Source Translation

**Feature Branch**: `002-source-translation`

**Created**: 2026-07-08

**Status**: Draft

**Input**: Reusable command-line tool that turns the French OCR text (`issue.txt`) produced by the gallica-fetcher into readable English, following a cleanup-then-translate pipeline. Design source of truth: `docs/specs/2026-07-08-source-translation-design.md` (approved). Roadmap item: `impl:feature/source-translation` (depends-on `impl:feature/gallica-fetcher`).

## Clarifications

### Session 2026-07-08

- Q: Where should the translation artifacts (corrected French + English) be stored? → A: In the private archive alongside the source, exactly like the fetcher's `issue.txt` (single source of truth; publishing is a separate later decision).
- Q: What format should the per-artifact provenance/companion record use? → A: A per-artifact YAML companion file (`.yml`), matching the gallica-fetcher's actual shipped convention (`src/archive/provenance.ts`, the archive's `PB-P001.yml`); the feature reuses the existing provenance module rather than reimplementing it. (The initial "JSON" phrasing was a factual error corrected 2026-07-08; the operator's intent was to match the fetcher.)
- Q: When one issue fails during a whole-source (`translate-source`) run, what should happen? → A: Continue translating the remaining issues, but abort the whole run after N consecutive failures (a small threshold signalling a systemic problem); report per-issue outcomes.
- Q: How should the cleanup and translation passes be staged? → A: Decompose each issue's processing into small, idempotent chunks (cleanup + translation per chunk) so a failure loses only a small amount of work, chunks are individually resumable, and the pipeline is easy to integration-test; the whole-issue corrected French and English artifacts are assembled from the chunk outputs.
- Q: What is the natural chunk unit? → A: The individual page image of the issue. Each issue is naturally composed of individual page images; the tool processes the issue page by page (one page's OCR text → corrected French → English per chunk), and each page's outputs are durable and individually idempotent.

## User Scenarios & Testing *(mandatory)*

The "user" is a researcher or research agent building the Colony Cults archive. The archive's stated goal is an **English-language** research archive of the Port Breton colony scheme. The gallica-fetcher already mirrors public-domain French sources into a private archive and self-OCRs them into a plain-text `issue.txt` per fascicle — but that text is French and carries OCR noise. This feature turns that French OCR into a corrected French transcription and a readable English translation, each recorded as a durable, provenanced research artifact. The first concrete target is *La Nouvelle France* (`PB-P001`), a public-domain (1879–1885) promotional newspaper.

### User Story 1 - Translate a single issue to English (Priority: P1)

A researcher points the tool at one archived issue (by its identifier). The tool processes the issue page by page — its natural chunk unit — cleaning each page's noisy French OCR into a corrected French transcription and translating that corrected French into readable English, one page at a time. It then assembles the whole-issue corrected French and English and stores both alongside the source with provenance records that label the output machine-assisted and retain the original-language citation. Each page's outputs are durable and idempotent, so an interrupted run resumes at the first incomplete page.

**Why this priority**: This is the core value — turning one fascicle's French OCR into usable English research text. It is a complete, demonstrable slice on its own and the foundation every other story builds on.

**Independent Test**: Take one archived public-domain issue that already has an `issue.txt`, run the single-issue translate command, and confirm two new artifacts appear alongside the source — a corrected French transcription and an English translation — each with a provenance record naming the engine, the model, the date, the `translation: machine-assisted` label, and the original-language citation.

**Acceptance Scenarios**:

1. **Given** an archived public-domain issue with an `issue.txt`, **When** the researcher runs the single-issue translate command, **Then** the tool produces (a) a corrected French transcription and (b) an English translation, each stored alongside the source with a provenance record.
2. **Given** the cleanup pass, **When** it runs on noisy OCR, **Then** the corrected French transcription dehyphenates line-broken words, joins broken lines, repairs obvious scan errors, and drops non-text condition markers (e.g. "Contraste insuffisant"), while remaining faithful to the source's words.
3. **Given** the translation pass, **When** it runs, **Then** the English is produced from the *corrected French*, not from the raw OCR.
4. **Given** a completed run, **When** the artifacts are written, **Then** each artifact's provenance records `engine: claude-code-cli`, the model identifier, the run date, the `translation: machine-assisted` label, and the original-language citation.
5. **Given** an issue that already has translation artifacts, **When** the command is re-run without forcing, **Then** the existing artifacts are left untouched and the tool reports them as already present.
6. **Given** an issue that already has translation artifacts, **When** the command is re-run with the force flag, **Then** the artifacts are regenerated.
7. **Given** an issue whose processing was interrupted partway through its pages, **When** the command is re-run, **Then** already-completed pages are not reprocessed and the run resumes at the first incomplete page, losing at most the work of the single in-flight page.

---

### User Story 2 - Translate an entire source (Priority: P2)

A researcher points the tool at a whole source (by its source identifier). The tool iterates the archived issues of that source and translates each one, skipping those already translated (unless forced), so an entire periodical run can be brought to English in one invocation.

**Why this priority**: Scales the P1 capability from one fascicle to a full periodical (dozens of issues), which is how the archive is actually built. It depends on US1's per-issue pipeline and is separable from it.

**Independent Test**: Point the tool at a source with several archived issues, run the whole-source translate command, and confirm every not-yet-translated issue gains a corrected French transcription and an English translation, that already-translated issues are skipped, and that the run reports per-issue outcomes.

**Acceptance Scenarios**:

1. **Given** a source with multiple archived issues, **When** the researcher runs the whole-source translate command, **Then** each issue that lacks translation artifacts is translated and each already-translated issue is skipped (unless forced).
2. **Given** a whole-source run over many issues, **When** it executes, **Then** it paces its calls to respect the engine's rate limits and is resumable — a re-run after an interruption continues from where it stopped rather than redoing completed issues or completed pages.
3. **Given** one issue in the run fails, **When** the failure occurs, **Then** the tool records the failure with a descriptive error, does not emit partial or fabricated output for that issue, and continues with the remaining issues — aborting the whole run only after N consecutive failures (a small threshold signalling a systemic problem).
4. **Given** N consecutive issue failures, **When** the threshold is reached, **Then** the tool aborts the run and reports the consecutive-failure condition rather than continuing to burn engine calls against a systemic problem.

---

### User Story 3 - Preview intended work without writing (Priority: P3)

Before committing to a run — especially a whole-source run that consumes rate-limited engine calls — a researcher previews exactly what the tool would do: which issues would be translated, which would be skipped, and each issue's rights status, with nothing written.

**Why this priority**: A safety and planning affordance over US1/US2. Valuable but not required for the core translate capability.

**Independent Test**: Run either command with the dry-run flag and confirm the tool reports the intended per-issue work (translate vs skip), each issue's rights status, and writes no files.

**Acceptance Scenarios**:

1. **Given** the dry-run flag, **When** a translate command is invoked, **Then** the tool reports the intended work per issue (translate / skip / refuse-on-rights) and writes nothing.
2. **Given** the dry-run flag on a source with a mix of translated and untranslated issues, **When** invoked, **Then** the report distinguishes issues that would be translated from those that would be skipped as already present.

---

### Edge Cases

- **Engine absent**: When the Claude Code CLI is not on PATH, a translation-requesting run fails loud before doing work, naming how to install/authenticate it. A dry-run that writes nothing does not require the engine to be present to report intended work (the exact preflight gating point is decided in the plan).
- **Copyrighted source**: When the target source is not confirmed public-domain, the tool refuses to produce a committed full translation and fails loud, writing nothing — consistent with `AGENTS.md`.
- **Missing input**: When an issue has no `issue.txt` (never OCR'd), the tool reports that issue as not-translatable with a descriptive message rather than fabricating input.
- **Empty or near-empty OCR**: When `issue.txt` is empty or contains only condition markers / no recoverable text, the tool reports it and does not emit an empty or fabricated translation.
- **Engine call fails mid-pipeline**: When a page's cleanup or translation call fails or returns unusable output, the tool throws a descriptive error and does not write a partial artifact; only the in-flight page's work is at risk, and completed pages remain durable.
- **Rate-limit / interruption during a whole-source run**: The run can be resumed without redoing completed issues or completed pages.
- **Assembly with a missing page**: When some pages of an issue could not be processed, the whole-issue assembly reflects only completed pages and the issue is reported as incomplete rather than presented as a finished translation.
- **Consecutive systemic failures**: When issues fail back-to-back (e.g. the engine's auth expires or rate limits are exhausted), the whole-source run aborts after N consecutive failures rather than continuing indefinitely.
- **Identifier not found**: When the given issue or source identifier does not resolve to an archived item, the tool fails loud naming the unresolved identifier.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tool MUST accept a single-issue translate operation identified by an issue identifier, and a whole-source translate operation identified by a source identifier that iterates the archived issues of that source.
- **FR-002**: For each issue, the tool MUST read the French OCR text produced by the gallica-fetcher as its input, and MUST fail loud (translating nothing for that issue) when that input is absent or unusable — never fabricating input.
- **FR-003**: The tool MUST perform a cleanup pass that produces a **corrected French transcription** from the raw OCR — dehyphenating, joining broken lines, repairing obvious scan errors, and dropping non-text condition markers — remaining faithful to the source's words.
- **FR-004**: The tool MUST perform a translation pass that produces **readable English from the corrected French transcription** (not from the raw OCR), and MUST assemble the whole-issue corrected French and whole-issue English from the per-page outputs.
- **FR-005**: The tool MUST store the corrected French transcription and the English translation as durable artifacts in the private archive alongside the source, so each is independently retrievable as a research artifact.
- **FR-006**: Every artifact the tool writes (corrected French and English) MUST carry a provenance record — stored as a per-artifact YAML companion file (`.yml`) matching the gallica-fetcher's shipped archive convention and reusing its provenance module — capturing at least: the engine (`claude-code-cli`), the model identifier, the run date, the `translation: machine-assisted` label, and the original-language citation, consistent with `AGENTS.md` § "Handling translations".
- **FR-007**: The tool MUST retain the original-language citation and MUST label translated output as machine-assisted (not human-reviewed) in its provenance.
- **FR-008**: The tool MUST only produce a committed full translation for a source confirmed public-domain; for a source not confirmed public-domain it MUST refuse and fail loud, writing nothing — consistent with `AGENTS.md`'s "do not commit full translations of copyrighted works".
- **FR-009**: The tool MUST verify the translation engine is available before performing any translation work, and MUST fail loud when it is absent — naming how to install/authenticate it — gated to fire only when a translation is actually requested.
- **FR-010**: The tool MUST support a dry-run mode that reports the intended per-issue work (translate / skip / refuse-on-rights), each issue's rights status, and writes nothing.
- **FR-011**: The tool MUST be idempotent by default: an issue that already has translation artifacts is skipped, and MUST support a force mode that regenerates existing artifacts.
- **FR-012**: A run MUST be resumable at both issue and page granularity — a re-run after an interruption continues without redoing already-completed issues or already-completed pages — and MUST pace its engine calls to respect rate limits.
- **FR-013**: The tool MUST NOT emit fabricated, partial, or fallback output: a missing engine, a failed cleanup/translation call, unusable input, or ambiguous rights MUST raise a descriptive error rather than produce placeholder content.
- **FR-014**: The tool MUST be reusable across any archived source's OCR, with *La Nouvelle France* (`PB-P001`) as the first target — no source-specific hardcoding of the pipeline.
- **FR-015**: The tool MUST report per-issue outcomes for a run (translated / skipped / refused / failed / incomplete) so a researcher can see what happened without inspecting the archive directly.
- **FR-016**: The tool MUST process each issue as a sequence of small, idempotent chunks whose natural unit is the individual page image — cleaning and translating one page at a time — so that a failure loses at most the in-flight page's work, each page's outputs are durable and individually skippable on re-run, and the pipeline is integration-testable at page granularity.
- **FR-017**: During a whole-source run the tool MUST continue past an isolated issue failure and MUST abort the whole run after N consecutive issue failures (a small threshold signalling a systemic problem such as expired auth or exhausted rate limits), reporting the consecutive-failure condition.

### Key Entities *(include if feature involves data)*

- **Issue OCR input**: The French OCR of one fascicle, produced by the gallica-fetcher and stored in the private archive's per-source/per-issue tree. Read-only input to this feature. An issue is naturally composed of individual page images, each with corresponding OCR text.
- **Page chunk**: The natural unit of work — one page image of an issue and its OCR text. The tool cleans and translates the issue one page at a time; each page's outputs are durable and individually idempotent, bounding the blast radius of any failure to a single page.
- **Corrected French transcription**: A durable artifact derived from the OCR by the cleanup pass — the OCR de-noised into faithful French — produced per page and assembled into the whole issue. Stored in the private archive alongside the source with a provenance record.
- **English translation**: A durable artifact derived from the corrected French by the translation pass — readable English — produced per page and assembled into the whole issue. Stored in the private archive alongside the source with a provenance record.
- **Provenance record**: The companion metadata for each derived artifact, stored as a per-artifact YAML companion file (`.yml`, matching the gallica-fetcher's shipped archive convention and reusing its provenance module) — engine, model, date, the `translation: machine-assisted` label, and the original-language citation.
- **Source / Issue identifiers**: The identifiers by which archived items are addressed (e.g. source `PB-P001` and its per-issue identifiers), used to locate inputs and target outputs.
- **Rights status**: The public-domain-or-not determination for a source, which gates whether a committed full translation may be produced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Given an archived public-domain issue with an `issue.txt`, a researcher can produce both a corrected French transcription and an English translation in a single command invocation.
- **SC-002**: 100% of artifacts the tool writes carry a provenance record that includes the engine, model, date, the machine-assisted label, and the original-language citation — verifiable by inspecting any produced artifact's companion record.
- **SC-003**: The English translation is derived from the corrected French transcription in 100% of runs (never directly from raw OCR), verifiable because the corrected French artifact always exists whenever an English artifact does.
- **SC-004**: A whole-source run over multiple issues skips every already-translated issue and translates every not-yet-translated one, with zero redundant re-translation on a repeat run (absent the force flag).
- **SC-005**: For a source not confirmed public-domain, the tool refuses and writes no committed full translation in 100% of attempts.
- **SC-006**: When the translation engine is absent, a translation-requesting run fails before writing any artifact and names how to install/authenticate the engine.
- **SC-007**: A dry-run of any command writes zero files while reporting the intended per-issue work and rights status.
- **SC-008**: An issue run interrupted after some pages complete, when re-run, reprocesses none of the already-completed pages and finishes the remainder — losing at most one page's work to the interruption.
- **SC-009**: A whole-source run aborts after N consecutive issue failures rather than attempting every remaining issue, and reports the consecutive-failure condition.

## Assumptions

- **Engine**: The translation engine is the Claude Code CLI, invoked non-interactively, reusing the operator's existing subscription authentication rather than an API key or per-token billing. (Design decision 1; the Anthropic API path is explicitly rejected.)
- **Archive location & layout**: Inputs and outputs live in the existing private archive (the fixed sibling path used by the gallica-fetcher), in its per-source/per-issue directory tree. Translation artifacts are stored in the private archive alongside the source (single source of truth, matching the fetcher); publishing derived English of public-domain text to a public tree is a separate, later decision, out of scope for v1. (Clarified 2026-07-08.)
- **Provenance format**: The provenance/companion-record format is a per-artifact YAML companion file (`.yml`), matching the gallica-fetcher's shipped per-asset convention; the feature reuses `src/archive/provenance.ts` (`ProvenanceFields`, `writeProvenance`, `companionYamlPath`) rather than reimplementing serialization. The *required fields* are fixed by FR-006. (Clarified 2026-07-08; "JSON" phrasing corrected to YAML after inspecting the shipped fetcher.)
- **Chunking / pass staging**: Each issue is processed page by page (the natural chunk unit), with cleanup and translation per page and per-page durable, idempotent outputs; the whole-issue artifacts are assembled from the pages. Whether a page's cleanup and translation are one engine call or two is a prompt-design detail for the plan; the page-level idempotency and blast-radius guarantee (FR-016) is fixed. (Clarified 2026-07-08.)
- **Consecutive-failure threshold**: The exact value of N (consecutive issue failures that abort a whole-source run, FR-017) is a small operational constant to be set in the plan.
- **Engine invocation details**: The exact non-interactive invocation of the Claude Code CLI (flags, how source text is passed — stdin vs. argument vs. temp file, output capture, output mode) is a spike for the plan.
- **Input granularity**: Whether the fetcher exposes per-page OCR text directly or the whole-issue OCR must be split into pages is resolved in the plan against the actual archive layout; either way, the page is the processing unit (FR-016).
- **First target rights**: *La Nouvelle France* (1879–1885) and the Port Breton primary sources are public-domain by age, so a full committed English translation is permitted for them.
- **Quality signalling**: Marking low-confidence spans for a future human-review surface is deferred from v1, but the provenance model should not preclude adding it later.
- **House rules**: The tool follows the same engineering house rules as the gallica-fetcher (thin client, dependency injection, fail-loud, no fallbacks/mock data outside tests). These are implementation constraints carried into the plan, not user-facing requirements.

## Out of Scope

- Calling the Anthropic API directly (rejected in favor of the Claude Code CLI).
- A dedicated machine-translation service (DeepL / Google) — rejected as too blunt for archaic French and OCR noise.
- Translating raw OCR without a cleanup pass — rejected; cleanup-first is required.
- Per-article segmentation and entity extraction (people / ships / places) — this is the separate future evidence-model feature, not translation v1.
- A human-review UI / low-confidence-review surface — deferred (provenance leaves room for it).
