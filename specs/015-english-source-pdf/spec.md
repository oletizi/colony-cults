# Feature Specification: English-Source Facsimile PDF

**Feature Branch**: `feature/edition-publishing` (spec dir `specs/015-english-source-pdf`)

**Created**: 2026-07-17

**Status**: Draft

**Input**: Design record `docs/superpowers/specs/2026-07-17-english-source-pdf-design.md` (approved 2026-07-17). Render English-language sources as facsimile-edition PDFs where the English OCR text IS the reading recto — no French-OCR │ English-translation split, no translation requirement. Scope: PDF rendering only; the browser snapshot path is untouched and out of scope. Builds on spec 014 (archive-direct-pdf).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a facsimile PDF for an English-language source (Priority: P1)

An operator runs the PDF build for an English-language source (e.g. PB-P056, the Richmond / "New Italy" sketch). The source carries per-page image masters and English OCR in the normalized archive but **no translation** — it is already English. The build reads the English OCR as the reading recto, renders each page as verso facsimile │ recto English text (the english-only reading layout), and produces a complete facsimile-edition PDF. The build no longer fails on the "missing translation" gate for a source that legitimately has no translation.

**Why this priority**: This is the whole feature — without it, every English-language source is unbuildable (it hits the French path's fail-loud translation gate). Delivering just this story produces real PDFs for the English documents already acquired and OCR'd.

**Independent Test**: Point the build at an English-language source fixture (image masters + English OCR, no `translation/` artifacts) and confirm it produces a PDF whose recto reading text is the English OCR, with no translation demanded. Verifiable end-to-end against PB-P056.

**Acceptance Scenarios**:

1. **Given** an English-language source (folio provenance `language` = English) with image masters and English OCR but no translation artifacts, **When** the operator builds its PDF, **Then** the build completes and each page renders the verso facsimile beside the English OCR as the reading recto — no translation artifact is required or read.
2. **Given** the same English source, **When** the build assembles a page, **Then** the reading text comes from the page's OCR (corrected per-page OCR text if present, else the positional OCR segment) at the correct page position.
3. **Given** an English source built to PDF, **When** the operator inspects it, **Then** the page ordering and page-to-OCR correspondence follow the source's own folio sequence (a page-range extract maps correctly, unchanged from spec 014).

---

### User Story 2 - The French edition path and its safety net are unchanged (Priority: P1)

An operator builds a French-language source (the existing FR-OCR │ EN-translation edition). Its behavior — including the fail-loud gate when a required per-page translation is genuinely missing — is exactly as before. Adding English-source support must not weaken the safety net that catches real translation gaps in French sources.

**Why this priority**: A regression here would silently mis-render French sources or hide genuine translation gaps — the exact failure this feature's routing must NOT introduce. Equal priority to US1 because the feature is only acceptable if it is additive.

**Independent Test**: Build a French-language source fixture unchanged and confirm identical output; build a French source with a deliberately missing translation and confirm it still fails loud with the translation-gap error.

**Acceptance Scenarios**:

1. **Given** a French-language source (folio provenance `language` = French) with complete OCR + per-page translations, **When** the operator builds its PDF, **Then** the output is identical to the pre-feature behavior (FR-OCR │ EN-translation).
2. **Given** a French-language source with a genuinely missing per-page translation artifact, **When** the operator builds its PDF, **Then** the build FAILS LOUD naming the page and the missing translation — the safety net is intact.

---

### User Story 3 - Honest provenance for a machine-transcribed reading text (Priority: P2)

A reader of an English-source PDF sees, in the colophon, that the reading recto is a **machine OCR transcription** of the English original — not a translation — and, where the OCR is known low-fidelity (e.g. the press leaves), sees that caveat surfaced. The edition never claims a machine-assisted translation it did not perform.

**Why this priority**: Scholarly honesty about how the reading text was produced. Not required to produce a viewable PDF (US1), but required for the edition to be trustworthy, especially for the explicitly low-fidelity sources.

**Independent Test**: Build an English source and inspect its colophon: it carries an OCR-transcription line and no machine-assisted-translation line; for a source whose provenance records a low-fidelity / sub-clean OCR condition, that caveat appears.

**Acceptance Scenarios**:

1. **Given** an English source, **When** its PDF colophon is rendered, **Then** it states the recto is a machine OCR transcription of the English original and carries the OCR engine/status, and it contains NO machine-assisted-translation line.
2. **Given** an English source whose folio provenance records a low-fidelity or sub-high OCR condition, **When** a page is rendered, **Then** that OCR-condition caveat is surfaced on the page (carried through unchanged from the existing apparatus).

---

### Edge Cases

- **Missing OCR on an English page**: an **unmarked** English page with neither corrected per-page OCR text nor a positional OCR segment is a genuine content gap → the build FAILS LOUD naming the page (it is NOT treated as a blank recto). Same discipline as the French path's empty-OCR check.
- **Intentionally blank / plate page (English)**: an English folio explicitly marked as a blank recto — a plate, illustration, cover, or blank leaf with no reading text — via the folio-provenance `blank_recto` marker renders a blank reading recto over its verso facsimile and TOLERATES empty OCR (FR-014). This is the English analog of the French path's `untranslatable` page. The marker is the ONLY way to opt a page out of the empty-OCR gate, so an unmarked empty page (above) still fails loud — genuine OCR gaps are never silenced.
- **Unsupported reading language**: a source whose folio provenance `language` is neither French nor English → the build FAILS LOUD (only French and English editions are in scope; a third reading language is not silently mis-rendered).
- **Mixed reading language within a source**: a source whose folios disagree on `language` (some English, some French) → the build FAILS LOUD naming the source (FR-006a). The reading language is a per-source property; disagreement is an archive-data error, not a page-level choice.
- **Language value form**: the `language` field is matched case-insensitively; the concrete vocabulary (full word "English" vs. a code) is verified against the real sidecars at implementation and normalized at the routing seam if a code is used (see Assumptions / open question).
- **Missing image master**: unchanged from spec 014 — a page whose master is absent from the object store fails loud (archive-completeness gap, never a silent fallback).
- **English source that unexpectedly has translation artifacts**: routing is by `language`, so such artifacts are simply not read on the English path; the reading recto is still the OCR.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The PDF build MUST determine each source's reading-language path from the folio provenance `language` field the archive already carries, matched case-insensitively.
- **FR-002**: When `language` indicates English, the build MUST render the source as an English-source edition: the English OCR text is the reading recto, drawn as a single reading column over the verso facsimile (the existing english-only reading layout).
- **FR-003**: On the English-source path the build MUST NOT require or read a per-page English translation artifact; the absence of translation artifacts MUST NOT cause a build failure.
- **FR-004**: On the English-source path the reading recto text MUST be the page's OCR — the corrected per-page OCR text if present, else the positional OCR segment — at the page's position in the source's own folio sequence.
- **FR-005**: When `language` indicates French, the build MUST behave exactly as before this feature, including the existing fail-loud gate when a genuinely required per-page translation is missing (the translation-gap safety net is unchanged).
- **FR-006**: When `language` is neither French nor English, the build MUST fail loud (only French and English editions are in scope).
- **FR-006a**: A source's reading language MUST be resolved once and be consistent across all of its folios; a source whose folios disagree on `language` (some English, some French) MUST fail loud naming the source (a mixed-language source is not a valid edition — it surfaces an archive-data error, never a silently-picked language).
- **FR-007**: On the English-source path, an **unmarked** English page with neither corrected per-page OCR text nor a positional OCR segment MUST fail loud, naming the page (a genuine content gap, not a blank recto). The sole exception is a page explicitly marked `blank_recto` (FR-014).
- **FR-008**: An English-source edition's colophon MUST state that the reading recto is a machine OCR transcription of the English original, carry the OCR engine/status, and MUST NOT include a machine-assisted-translation line; the machine-assist translation label MUST be absent for English sources.
- **FR-009**: A page's recorded OCR-condition caveat (e.g. a low-fidelity or sub-high quality note) MUST be surfaced on the rendered page for English sources, carried through unchanged from the existing OCR-condition apparatus.
- **FR-010**: Page ordering, the page-to-OCR correspondence within the source's own folio sequence, image-master fetch + integrity verification, pinned-archive reproducibility (the colophon archive reference), the facing-page/spread rendering templates, and both edition variants (parallel and english-only) MUST remain unchanged from spec 014 — **with one narrowly-scoped exception (FR-013): the colophon's machine-assist provenance line**, which must change to render an English source's OCR-transcription disclosure. No other template is touched.
- **FR-014**: An English-source folio MAY be explicitly marked as an intentionally-blank recto — a plate, illustration, cover, or blank leaf with no reading text — via a folio-provenance marker (`blank_recto: true`), analogous to the French path's `untranslatable` page. When a folio is so marked, the English-source path MUST TOLERATE an empty OCR result and render a blank reading recto over the folio's verso facsimile (reusing spec 014's existing blank-recto rendering — no template change). When a folio is NOT so marked, FR-007's empty-OCR fail-loud is unchanged: the marker is the ONLY opt-out, so a genuine OCR gap on an unmarked page is never silenced. The marker is an additive OPTIONAL folio-provenance field; a source with no blank folios is unaffected.
- **FR-013**: The colophon apparatus MUST support an English source that carries no machine-assisted-translation label. Concretely: (a) `ColophonMeta`'s machine-assist translation label MUST become nullable, and the colophon assembler MUST NOT fail loud on the *legitimate* absence of a translation label for an English source (it MUST still fail loud on a French source with no label — the spec-014 guarantee); (b) `ColophonMeta` MUST carry an OCR-transcription disclosure (recto is a machine OCR transcription of the English original, with OCR engine/status + low-fidelity caveat when present); (c) the colophon template MUST render the OCR-transcription line for English sources and the machine-assist line for French sources, and never both. Because the colophon is user-facing typography, this template change MUST be designed through `/frontend-design:frontend-design` (Constitution XI) — it is the sole sanctioned exception to FR-010's "templates unchanged".
- **FR-011**: The English-source path MUST be an additive branch within the existing archive-direct reader (not a separate top-level reader), reusing the shared folio-enumeration, image-fetch, and reproducibility machinery.
- **FR-012**: The feature MUST NOT touch the browser snapshot path (out of scope).

### Key Entities *(include if feature involves data)*

- **Source reading language**: the per-source signal (from folio provenance `language`) that selects the edition path — English (OCR-as-recto, no translation) vs. French (FR-OCR │ required EN-translation). Any other value is unsupported and fails loud.
- **English-source page**: a page whose reading recto is the English OCR text (corrected per-page OCR if present, else positional segment), paired with its verso facsimile master; carries an OCR-condition caveat when the archive records one; has no translation dimension.
- **English-source colophon**: the edition front/back matter that discloses the recto as a machine OCR transcription (with OCR engine/status and low-fidelity caveat when present), with no machine-assisted-translation line and a null machine-assist label, alongside the unchanged pinned-archive reference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An English-language source with image masters and English OCR but no translation artifacts builds to a complete facsimile-edition PDF (0 pages dropped, 0 translation artifacts required), where before the feature it failed at the translation gate.
- **SC-002**: 100% of an English source's rendered pages show the English OCR as the reading recto at the correct page position (verified page-for-page against the source's folio sequence).
- **SC-003**: French-language sources build to byte-for-byte identical (or provably equivalent) output as before the feature, and a French source with a genuinely missing translation still fails loud — 0 regressions in the translation safety net.
- **SC-004**: A source whose reading language is neither French nor English fails loud with a message naming the unsupported language — it is never silently mis-rendered.
- **SC-005**: Every English-source PDF colophon discloses the recto as a machine OCR transcription and contains no machine-assisted-translation line; where the archive records a low-fidelity OCR condition, that caveat is present on the affected pages.
- **SC-006**: The English documents already acquired (PB-P056 as the first end-to-end target; PB-P057–P059) each build to a facsimile-edition PDF.

## Assumptions

- The normalized archive already carries, for every source, a per-folio `language` value distinguishing English from French sources; the routing reads that existing signal (no new per-source configuration field is introduced).
- The `language` field's concrete vocabulary is verified against the real English sidecars (PB-P056–P059) during implementation; if the archive uses a language code rather than the full word, it is normalized at the routing seam. (Documented open question — non-blocking.)
- English sources carry their OCR in the same archive text form the French path already reads (a per-page corrected OCR file when present, else a positional segment of the source's OCR blob).
- The existing english-only reading layout (a single reading column over the verso facsimile) is the correct presentation for an English-source recto; the recto column header copy ("Transcription" vs. "Translation") is a template-copy refinement, not a structural requirement. (Documented open question — non-blocking.)
- Builds on shipped spec 014 (archive-direct-pdf): the archive-direct reader, the edition rendering templates, and the object-store image masters. The browser snapshot path is untouched.
- Engineering constraints (from the design record and project rules): fail loud with no fallbacks or mock data outside tests; `@/` imports; no `any` / `as` / `@ts-ignore`; source files kept within the 300–500 line guidance.
