# Feature Specification: Asset Summaries

**Feature Branch**: `feature/asset-summaries`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Asset Summaries — per-issue two-depth LLM summaries of the acquired corpus. Roadmap item impl:feature/asset-summaries; authored from the approved design doc docs/superpowers/specs/2026-07-21-asset-summaries-design.md."

## Overview

The acquired corpus — newspaper issues and monographs, in French and English — is
readable page-by-page (facsimile + OCR + translation) but carries no condensed,
human-readable account of *what each document contains*. A researcher cannot learn
"what is in this issue" without reading it; the website shows no abstract; the
bibliography catalog carries structured metadata (title, creator, date, rights) but no
substantive content description.

This feature generates, per issue / document, an LLM-produced **summary at two depths
from one generation flow**: a **thorough** exhaustive research summary (a bibliography
finding-aid) and a **concise** abstract (for the website) **distilled from the
thorough** — so the two never disagree and the corpus is not paid to be read twice.
A per-**source** rollup (concise + thorough), synthesized from the issue summaries,
gives each run/book a landing-page abstract.

Summaries are machine-generated **interpretation**: machine-labeled, provenance-stamped,
stored separately from the authoritative scans/OCR, and **never** asserted as fact or
evidence (Constitution Principles I & III). The authoritative record remains the scans +
OCR; a summary is a finding-aid over them.

## Clarifications

### Session 2026-07-21

- Q: Thorough-summary shape — freeform prose vs. a structured account? → A: **Structured account** (topics, people, places, dates, notable claims) **plus** a narrative prose body.
- Q: Per-source rollup when some of the source's issues are not yet summarized? → A: **Cover what exists** — synthesize from the available issue summaries and record which issues were included/missing in the rollup's provenance.
- Q: Noisy / low-confidence OCR handling at summarization time? → A: **Always summarize, and stamp a low-confidence quality note in provenance** when OCR quality is below threshold (never block; the vision-from-images option remains a future enhancement).
- Q: `SummarizationRunner` model default? → A: **Configurable, default Claude Sonnet 5**, overridable per run.
- Q: How far should this feature go toward feeding `corpus-gap-closure` / the coverage audit from the structured fields? → A: **Produce only** — emit the structured fields in a stable, documented shape; `corpus-gap-closure` / the audit consume them in separate, later work.
- Q: Concise length target (settled by reasonable default, not asked)? → A: Concise is **~1–3 sentences (~60–80 words)**; the thorough summary is **exhaustive** (structured fields + narrative, no hard length cap).

### Session 2026-07-22 (extend — Papers Past input adapter)

- Q: The Papers Past newspaper articles have OCR text — where does it live, and can the summarizer read it? → A: The OCR is a **B2-resident `ocr-text` asset** (`archive/papers-past/<id>/<sha>.txt`, `sourceRepresentation: papers-past-text-tab`) the SSOT record points at — NOT `issue.txt`. The summarizer must resolve it via the shipped browser resolver and pre-fetch the B2 `.txt` (FR-018–FR-020).
- Q: How should the OCR provenance of Papers Past differ from Gallica? (operator-authoritative) → A: The Gallica OCR **and** English translation are the **project's own derived work**; the Papers Past OCR is **downloaded from the source (Papers Past's own OCR), NOT our work**. Papers Past input is **English-only, no translation**, and its provenance MUST attribute the OCR to Papers Past as source-downloaded (FR-021).
- Q: What happens to a French Gallica source whose translation hasn't run yet? → A: **Fail loud** ("translation pending") — never summarize raw French OCR as if English-native (FR-023; fixes the silent wrong-input defect).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate a per-issue two-depth summary from acquired text (Priority: P1)

For a single issue/document that has usable acquired text, the operator generates one
**thorough** summary and one **concise** summary (distilled from the thorough), written
to the archive as machine-labeled companion artifacts each with a provenance sidecar.
This is the generation core every other story consumes.

**Why this priority**: Nothing downstream (website abstract, bibliography finding-aid,
rollup) exists without the generated summaries. It is the smallest slice that delivers
standalone value — a researcher can already read a finding-aid file — and it establishes
the machine-labeled, provenance-stamped, interpretation-not-evidence contract.

**Independent Test**: Point the pipeline at one issue whose archive holds an OCR
(and, for a French source, an English translation) text layer. Confirm two summary
companion artifacts are written, the concise is consistent with (a distillation of) the
thorough, each carries a provenance sidecar naming engine/model/date/input-layers-used
and the explicit "machine-generated summary — interpretation, not evidence" label, and
that pointing it at an issue with **no** usable text layer **fails loud** and writes no
summary.

**Acceptance Scenarios**:

1. **Given** an issue with an English OCR text layer, **When** the operator runs
   summarization for it, **Then** a thorough summary artifact and a concise summary
   artifact are written to the archive, each with a provenance sidecar, and the concise
   is a distillation of the thorough (no claim in the concise that is absent from the
   thorough).
2. **Given** a French-source issue with both French OCR and an English translation
   layer, **When** summarization runs, **Then** the summary is produced in **English**
   and the provenance records that both the French OCR and the English translation were
   the input layers used.
3. **Given** an issue with no usable text layer (no OCR and no translation), **When**
   summarization runs, **Then** the operation fails with a descriptive error naming the
   missing text and **no** summary artifact is written (no fabricated summary).
4. **Given** a summary artifact, **When** any consumer reads it, **Then** it is clearly
   labeled machine-generated interpretation and is stored separately from the scans/OCR
   (never overwriting or co-mingling with the evidentiary layers).

---

### User Story 2 - Read the concise abstract on the website (Priority: P2)

A researcher browsing the corpus website sees a concise abstract for each issue/document
(and, at the source landing page, the source rollup abstract), so they can tell what a
document contains before opening the reader.

**Why this priority**: This is the primary public-facing payoff of the feature, but it
depends on US1 having produced concise summaries first. It is independently testable and
demonstrable on its own once summaries exist.

**Independent Test**: With concise summary artifacts present for a browsable issue, load
that issue's website view and confirm the concise abstract renders, is attributed as a
machine-generated summary, and links/positions correctly relative to the reader; confirm
an issue lacking a summary degrades gracefully (no broken UI, clear "no summary" state).

**Acceptance Scenarios**:

1. **Given** an issue with a concise summary artifact, **When** the researcher opens that
   issue on the website, **Then** the concise abstract is displayed, visibly labeled as a
   machine-generated summary (interpretation, not evidence).
2. **Given** a source with a concise rollup, **When** the researcher opens the source
   landing page, **Then** the source-level concise abstract is displayed.
3. **Given** an issue with no summary yet, **When** the researcher opens it, **Then** the
   view renders without error and indicates no summary is available.

---

### User Story 3 - Reference the thorough finding-aid from the bibliography (Priority: P2)

A bibliographer/researcher consulting the catalog can reach the thorough, exhaustive
finding-aid summary for a source — the bibliography record **references** the thorough
summary artifact rather than inlining exhaustive prose into the structured SSOT.

**Why this priority**: Delivers the "thorough for the bibliography" half of the operator's
two-consumer requirement. Depends on US1. Independently testable via the catalog record.

**Independent Test**: For a source with a thorough summary, confirm its bibliography
record carries a reference (pointer) to the thorough summary artifact, that the reference
resolves to the artifact, and that the structured SSOT (source YAML) does **not** contain
the inlined exhaustive prose.

**Acceptance Scenarios**:

1. **Given** a source with a thorough summary artifact, **When** its bibliography record
   is inspected, **Then** the record contains a reference to the thorough summary and the
   reference resolves to the on-archive artifact.
2. **Given** the same source, **When** the source YAML (SSOT) is inspected, **Then** it
   does **not** contain the inlined long-form summary prose (the SSOT stays structured
   metadata).

---

### User Story 4 - Per-source rollup abstract (Priority: P3)

Each source (a newspaper run, or a book) gets a concise + thorough rollup summary
synthesized from its issue/document summaries — an abstract of the whole run/book for the
landing page and the catalog.

**Why this priority**: Adds source-level orientation on top of the per-issue summaries;
valuable but not required for the per-issue MVP. Depends on US1 (needs issue summaries to
synthesize from).

**Independent Test**: For a source with multiple summarized issues, run the rollup and
confirm a source-level concise and thorough summary are produced, each provenance-stamped,
and that they reflect the constituent issue summaries.

**Acceptance Scenarios**:

1. **Given** a source whose issues have been summarized, **When** the rollup runs, **Then**
   a source-level concise summary and a source-level thorough summary are written with
   provenance sidecars.
2. **Given** a source with only some issues summarized, **When** the rollup runs, **Then**
   it synthesizes from the available issue summaries (**cover what exists**) and records
   which issues were included and which were missing in the rollup's provenance.

---

### User Story 5 - Resumable, idempotent re-runs keyed to input layers (Priority: P3)

The operator can re-run summarization over the corpus and have it **skip** already-summarized
issues whose input layers are unchanged, and **regenerate** an issue whose OCR/translation
has changed — the same discipline as OCR and translation.

**Why this priority**: Makes the pipeline economical to operate over a growing corpus and
safe to re-run, but the per-issue generation (US1) delivers value without it. Depends on
US1.

**Independent Test**: Run summarization twice with no input change and confirm the second
run performs no regeneration (skips). Change an issue's OCR/translation, re-run, and confirm
only that issue is regenerated.

**Acceptance Scenarios**:

1. **Given** issues already summarized with unchanged input layers, **When** summarization
   is re-run, **Then** those issues are skipped (no regeneration, no LLM call).
2. **Given** an issue whose OCR or translation layer has changed since its summary was
   generated, **When** summarization is re-run, **Then** that issue's summary is regenerated
   and its provenance updated.
3. **Given** an interrupted run, **When** summarization is re-run, **Then** it resumes and
   completes the not-yet-summarized issues without redoing completed ones.

---

### User Story 6 - Summarize the English-language Papers Past articles (Priority: P2)

The ~32 acquired Papers Past newspaper articles (their OCR text downloaded from the source) are
summarized like any other document — completing v1's named "English-language Papers Past items"
scope, so a full corpus generation run covers Gallica (issues + books) **and** Papers Past.

**Why this priority**: Papers Past articles are explicitly in v1 scope, and live validation showed
the summarizer could not read them at all (source-family gap). Delivers a whole missing slice of
the corpus. Depends on US1's generation core.

**Independent Test**: Run `bib summarize <PapersPastSourceId>` on an acquired Papers Past source;
confirm it resolves the source's `ocr-text` asset (pre-fetching the B2 `.txt` as needed), generates
both summaries, and the provenance attributes the input OCR to **Papers Past (source-downloaded)**,
with **no** translation layer. Confirm a source whose `.txt` cannot be fetched fails loud.

**Acceptance Scenarios**:

1. **Given** an acquired Papers Past source, **When** it is summarized, **Then** the OCR text is
   read from its `ocr-text` asset (not `issue.txt`), both summaries are written, and the sidecar's
   input layer is attributed to Papers Past as source-downloaded OCR (English-only, no translation).
2. **Given** a Papers Past source whose OCR `.txt` is not local and cannot be fetched, **When**
   summarization runs, **Then** it fails loud naming the missing asset (no fabricated summary).
3. **Given** a French Gallica source whose translation has not yet been generated, **When**
   summarization runs, **Then** it fails loud ("translation pending") rather than summarizing the
   raw French OCR as if English (FR-023).

### Edge Cases

- **No usable text layer**: fail loud, write nothing (US1 AC-3). Never fabricate.
- **Noisy / low-confidence OCR**: the input text is poor quality. The issue is still
  summarized, and provenance carries a low-confidence quality note when OCR quality is below
  threshold (never blocked); the future vision-from-images option is a non-blocking
  enhancement for such assets.
- **Partial source coverage at rollup time**: some issues in a source are not yet summarized
  (US4 AC-2) — the rollup covers what exists and records included/missing issues in provenance.
- **Input layer changes after summary exists**: triggers regeneration (US5 AC-2); the summary
  must not silently go stale.
- **Non-public-domain / cataloged-but-not-mirrored source**: a summary is interpretation, not
  a reproduction — likely permissible even where the work itself may not be mirrored; the
  rights posture is confirmed in clarify (Constitution IV — cataloging/summary is always
  permitted, mirroring is the gated act).
- **Mixed-language issue**: an issue with some pages OCR'd in one language and some in another —
  the "best available text" selection must be well-defined.
- **Concise/thorough disagreement**: the concise MUST be a distillation of the thorough; a
  concise claim absent from the thorough is a defect.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST generate, per issue/document, a **thorough** summary and a
  **concise** summary in a single generation flow, where the concise is **distilled from**
  the thorough (one full-text pass, two depths).
- **FR-001a**: The thorough summary MUST be a **structured account** — machine-readable
  fields for topics, people, places, dates, and notable claims — **plus** a narrative prose
  body. (Clarified 2026-07-21.)
- **FR-001b**: The concise summary MUST be **~1–3 sentences (~60–80 words)**; the thorough
  summary is **exhaustive** (structured fields + narrative, no hard length cap). (Clarified
  2026-07-21; adjustable.)
- **FR-002**: The system MUST use the **best available acquired text** as input — English OCR
  for English-language sources; French OCR **plus** the English translation where it exists for
  French sources — and MUST produce **English** output.
- **FR-003**: The system MUST **fail loud** (descriptive error, no artifact written) when an
  issue has no usable text layer; it MUST NOT fabricate, mock, or fall back to a placeholder
  summary (Constitution V).
- **FR-004**: The system MUST write each summary as a **machine-labeled companion artifact** in
  the archive, alongside the OCR/translation companions, stored **separately** from the
  authoritative scans/OCR.
- **FR-005**: Each summary artifact MUST carry a **provenance sidecar** recording at least:
  generating engine, model, generation date, the input layers used, and an explicit
  "machine-generated summary — interpretation, not evidence" label.
- **FR-006**: The system MUST treat summaries as **interpretation, never evidence** — they are
  machine-labeled, provenance-stamped, and kept visibly separate from evidence (Constitution I &
  III); a summary MUST NOT be recorded as, or converted into, a factual claim.
- **FR-007**: The **bibliography record MUST reference** the thorough summary artifact; the
  structured SSOT (source YAML) MUST NOT inline the exhaustive summary prose.
- **FR-008**: The **website MUST read the concise** summary for display; browser display of the
  abstract is user-facing UI and MUST be built through `/frontend-design:frontend-design`
  (Constitution XI).
- **FR-009**: The system MUST produce a **per-source rollup** (concise + thorough) synthesized
  from the issue/document summaries, each provenance-stamped. When some issues in the source
  are not yet summarized, the rollup MUST **cover what exists** and record the included/missing
  issues in its provenance (rather than failing loud). (Clarified 2026-07-21.)
- **FR-010**: Summarization MUST be **resumable and idempotent**, keyed to the input layers:
  skip an already-summarized issue whose inputs are unchanged; regenerate when its OCR or
  translation changes.
- **FR-011**: The summarization engine MUST be an **injected `SummarizationRunner`** behind an
  interface, composed via constructor dependency injection (mirroring the OCR/translation
  runners), and MUST be swappable/configurable (Constitution VI). The model MUST be
  **configurable with a default of Claude Sonnet 5**, overridable per run. (Clarified
  2026-07-21.)
- **FR-012**: Summarization MUST use its **own dedicated runner** and MUST NOT route through the
  spec-014 governed source-query client — it reads **local** text and calls an LLM API, and is
  NOT an external *source* query (the source-query governance covers fetches *from* sources).
- **FR-013**: v1 MUST cover the corpus-browser's shipped set (the PB-P001 issues, the monographs,
  and the English-language Papers Past items), with the pipeline **generalized** so any source
  slots in.
- **FR-014**: Summaries MUST be permissible for **cataloged-but-not-mirrored** sources (a summary
  is interpretation/cataloging, not a reproduction) consistent with Constitution IV; the rights
  posture is confirmed in clarify.
- **FR-015**: The implementation MUST be **type-safe** — `@/` imports, no `any`/`as`/`@ts-ignore`,
  source files within 300–500 lines (Constitution VII).
- **FR-016**: The system MUST still summarize an issue whose OCR is **noisy / low-confidence**,
  and MUST stamp a **low-confidence quality note** in the summary's provenance when OCR quality
  is below threshold; it MUST NOT block on OCR quality. (Clarified 2026-07-21.)
- **FR-017**: The system MUST emit the thorough summary's **structured fields in a stable,
  documented shape** so that `corpus-gap-closure` / the coverage audit can consume them, but
  this feature **produces only** — it MUST NOT itself drive evidence-class assignment or
  thematic discovery (that is separate, later work). (Clarified 2026-07-21.)

### Source-aware input & the Papers Past family (extended 2026-07-22)

- **FR-018**: Input resolution MUST be **source-aware** — it MUST receive the source's identity/
  language metadata (not just a bare issue-dir path) and select the input layer(s) by source
  family, never by guessing language from which files happen to be present.
- **FR-019**: For a **Papers Past** source (the English-language newspaper articles named in v1
  scope), the system MUST read the OCR text from the source's **`ocr-text` asset** — the
  B2-resident `text/plain` `<sha>.txt` under `archive/papers-past/<article-id>/` that the SSOT
  repository record's `assets[]` points at — reusing the shipped browser resolver
  (`isPapersPastSource` / `papersPastOcrAsset`, `src/browser/load/papers-past.ts`) rather than
  duplicating the layout knowledge. Papers Past input is **English-only** (no translation layer).
- **FR-020**: Because the Papers Past `ocr-text` `.txt` is **B2-only** (absent from a fresh
  clone), the system MUST ensure it is available locally before summarizing — **pre-fetch it from
  the CDN/B2 reusing the shipped mechanism the browser snapshot uses** — or **fail loud** naming
  the missing asset and how to fetch it (never fabricate). Any network access MUST respect
  Constitution XII (frugal, governed access).
- **FR-021**: Papers Past summary **provenance MUST honestly attribute the OCR to its origin**:
  the Papers Past OCR text is **downloaded from the source (Papers Past's own OCR text-tab —
  `sourceRepresentation: papers-past-text-tab`), NOT the project's own work**, and the input-layer
  provenance MUST record this — distinct from the Gallica layers, where the OCR **and** the
  English translation are the **project's own derived work**. (Operator-authoritative distinction,
  2026-07-22.) The interpretation-not-evidence label (FR-006) is unchanged.
- **FR-022**: A Papers Past summary MUST NOT re-publish the source's OCR text verbatim — a summary
  is **interpretation/cataloging, not a reproduction** (Constitution IV); summarizing downloaded
  OCR of public-domain articles is permitted, but the artifact is a finding-aid, not a copy.
- **FR-023 (fixes the untranslated-French defect)**: For a **known-French Gallica source** whose
  English translation (`issue.en.txt`) is **absent**, the system MUST **fail loud** ("translation
  pending — cannot summarize a French source without its English translation") — it MUST NOT fall
  through to treating the raw **French OCR as if it were English-native** input (a silent
  wrong-input summary). English-native handling applies ONLY to a source actually known to be
  English (Papers Past, or a Gallica source whose language metadata is English).
- **FR-024 (enforces the reference invariant, SC-005)**: The `summaryRef` MUST be **enforced**, not
  merely validatable — a dangling `summaryRef` (artifact renamed/moved/never generated) MUST fail
  loud at a **wired** check point (a doctor/validate rule or a validating load path), not only via
  a helper nothing calls; and the resolution MUST reject paths that escape the archive root
  (no `..`/absolute traversal).

*Requirements deferred to `/speckit-plan` (implementation-detail, non-blocking):*

- **FR-C3**: Exact **companion + provenance schema** — file naming (e.g. `issue.summary.long.en.md`
  / `issue.summary.short.en.md`), the concrete sidecar fields (including the structured-field
  encoding from FR-001a and the low-confidence note from FR-016), and the exact form of the
  bibliography reference (FR-007) to the thorough summary. These are storage-contract details
  best fixed during planning; the spec fixes the *what* (structured + prose, provenance content),
  plan fixes the *exact encoding*.

### Key Entities *(include if feature involves data)*

- **Issue/Document Summary**: the per-unit finding-aid. Has two depths (thorough, concise);
  concise distilled from thorough. The thorough carries **structured fields** (topics, people,
  places, dates, notable claims) **plus** a narrative body; the concise is ~1–3 sentences.
  Machine-generated interpretation. Relates to exactly one issue/document and its input text
  layers.
- **Summary Provenance Sidecar**: metadata for a summary artifact — engine, model, generation
  date, input layers used, interpretation-not-evidence label, optional input-quality note. One
  per summary artifact.
- **Source Rollup Summary**: a source-level concise + thorough abstract synthesized from the
  source's issue/document summaries. Relates to one source and the set of issue summaries it
  covers.
- **Input Text Layer**: the acquired text a summary is generated from (English OCR; French OCR +
  English translation). The idempotency key derives from these layers.
- **Bibliography Reference**: the pointer in the structured SSOT (source record) to the thorough
  summary artifact — reference, not inlined prose.
- **SummarizationRunner**: the injected engine interface (Claude via API) that turns input text
  into the two-depth summary; swappable, dedicated (not the source-query client).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every issue/document in the v1 shipped set that has a usable text layer has both a
  thorough and a concise summary artifact, each with a complete provenance sidecar (100% coverage
  of text-bearing units; 0 orphan summaries and 0 summaries missing provenance).
- **SC-002**: Every issue/document in the v1 shipped set with **no** usable text layer produces a
  loud, descriptive skip/error and **zero** fabricated summaries (0 fabricated artifacts).
- **SC-003**: For every generated pair, the concise summary contains no claim absent from the
  corresponding thorough summary (0 concise-only claims on inspection).
- **SC-004**: A researcher on the website can read a concise abstract for any summarized issue and
  the source rollup on its landing page, each visibly attributed as a machine-generated summary.
- **SC-005**: Every thorough summary is reachable from its source's bibliography record via a
  resolvable reference, and no source YAML contains inlined exhaustive summary prose (0 SSOT prose
  inlines).
- **SC-006**: Re-running summarization with no input change regenerates nothing (0 redundant LLM
  calls); changing one issue's input layer regenerates exactly that issue (1 regeneration).
- **SC-007**: A new source can be added to the summarization pipeline without code changes to the
  generation core (configuration/registration only), demonstrating generalization beyond the v1 set.
- **SC-008**: The **Papers Past** family is summarizable — every acquired Papers Past source in v1
  produces both summaries from its `ocr-text` asset, with input provenance attributed to Papers
  Past (source-downloaded); a full corpus run covers Gallica **and** Papers Past (0 in-scope source
  families the summarizer cannot read).
- **SC-009**: A French Gallica source lacking its translation produces a loud "translation pending"
  error, never a summary built from untranslated French OCR (0 silent wrong-language summaries).

## Assumptions

- **Clarified 2026-07-21** (see the Clarifications section). Thorough shape = **structured +
  prose** (FR-001a); concise = ~1–3 sentences, thorough exhaustive (FR-001b); rollup =
  **cover-what-exists + record coverage** (FR-009); noisy OCR = **summarize + low-confidence
  note** (FR-016); model = **configurable, default Sonnet 5** (FR-011); discovery link =
  **produce structured fields only, consume later** (FR-017).
- **Deferred to `/speckit-plan`** (FR-C3): exact companion file naming (assume
  `*.summary.long.en.md` / `*.summary.short.en.md` as the starting point), sidecar field
  encoding, and the bibliography-reference form — storage-contract details fixed at planning.
- The archive/object-store, OCR, and translation layers already exist and are consumed as-is
  (shipped: `source-group-acquisition` / `gallica-fetcher` / `archive-object-store`,
  `source-translation`, `canonical-source-metadata`, `corpus-coverage-audit`, `corpus-browser`).
- The `SummarizationRunner` calls an LLM API over **local** text; it is not a governed source query
  and does not touch the spec-014 client (FR-012).
- Summaries of cataloged-but-not-mirrored works are permissible (interpretation/cataloging, not
  reproduction) per Constitution IV; confirmed in clarify (FR-C rights posture).
- v1 targets the corpus-browser's shipped set; the pipeline is written to generalize (FR-013,
  SC-007).
- Vision-from-images summarization is **out of v1** and retained as a future option for
  image-heavy / badly-OCR'd assets (operator-recorded design decision, not an agent scope-cut).

## Dependencies

- **Consumes (shipped)**: `corpus-browser` (website display), `source-group-acquisition` /
  `gallica-fetcher` / `archive-object-store` (acquired OCR), `source-translation` (English
  translations), `canonical-source-metadata` (bibliography SSOT), `corpus-coverage-audit`
  (evidence-class link).
- **UI dependency**: website display (US2) is built through `/frontend-design:frontend-design`
  (Constitution XI).
