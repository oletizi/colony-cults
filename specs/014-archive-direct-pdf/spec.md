# Feature Specification: Archive-Direct PDF Rendering

**Feature Branch**: `feature/edition-publishing` (long-lived PDF-generation branch)

**Created**: 2026-07-17

**Status**: Draft

**Input**: User description: "Make pdf:build render facsimile-edition PDFs by reading
EXCLUSIVELY from our own normalized archive, dissolving the per-source-archive coupling.
Scope is PDF rendering only."

**Design record**: `docs/superpowers/specs/2026-07-17-archive-direct-pdf-design.md`

**Roadmap item**: `impl:feature/archive-direct-pdf`

## Clarifications

### Session 2026-07-17

- Q: Should the fix add archive-by-archive support (IA, then HathiTrust, …) to the existing
  loader, or read from our own normalized archive? → A: **Read exclusively from our own
  archive.** The acquisition adapters already normalize every source into one uniform shape;
  reading from it dissolves the per-source friction by construction rather than enumerating it.
- Q: Scope — also unify the browser and PDF loading paths? → A: **PDF rendering only.** The
  browser's snapshot path is untouched and out of scope.
- Q: How should page images be sourced? → A: **From `object_store` (B2) exclusively** — the
  master key + sha256 the archive already records; no source-archive ark/IIIF path. A missing
  master fails loud (an archive-completeness gap), never a silent fallback.
- Q: How should a page with no English translation be handled? → A: **Honor an explicit
  "untranslatable" marker.** A marked page renders facsimile + FR OCR with a blank EN column;
  an *unmarked* missing translation fails loud. (The concrete marker representation is being
  finalized by the translation team — see Assumptions; the requirement is representation-agnostic.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Render a source's edition from the archive, whatever archive it came from (Priority: P1)

An operator builds facsimile-edition PDFs for a source that was acquired from *any* holding
archive (Gallica, Internet Archive, a museum, …). The build reads the source directly from our
normalized archive — page images, OCR, translations, and ordering all from the recorded
provenance — and produces a correct facing-page edition PDF, identical in form to today's
Gallica editions.

**Why this priority**: This is the feature's reason for being. Today the build only renders
Gallica sources; every newly-acquired non-Gallica source is unbuildable. Reading from our own
uniform archive is what makes the build source-agnostic.

**Independent Test**: Build a source whose masters live in `object_store` and whose pages carry
OCR + translation; confirm a correct facing-page PDF is produced (verso facsimile, recto FR OCR
+ EN translation), with page images matching their recorded checksums — with no reference to the
source's origin archive anywhere in the build.

**Acceptance Scenarios**:

1. **Given** a source normalized into the archive (folios with `object_store` masters + per-page
   OCR + translation), **When** the operator runs the build for it, **Then** a facing-page
   edition PDF is produced with every page's facsimile, FR OCR, and EN translation, and the
   build never parses a source-archive catalog URL or ark.
2. **Given** a source from a non-Gallica archive (e.g. an `archive.org` origin), **When** it is
   built, **Then** it renders exactly as a Gallica source would — the origin archive does not
   change the outcome.

---

### User Story 2 - Page-range extracts render with correct page↔translation alignment (Priority: P2)

A source is a page-range *extract* of a larger book (e.g. pages 48–50), so its page images are
stored at absolute folio numbers (`f048–f050`) while its translations are numbered
extract-relative (`p001–p003`). The build aligns each page image with its own translation from
the source's own sequence, so the edition reads correctly.

**Why this priority**: Extracts are a first-class acquisition shape (the page-range adapter), and
the absolute-vs-relative mismatch is exactly what breaks the current Gallica-coupled build —
proving the defect is about numbering, not about which archive.

**Independent Test**: Build a page-range-extract source (folios `f048–f050`, translations
`p001–p003`); confirm folio `f048`'s facsimile pairs with translation `p001`, `f049` with
`p002`, `f050` with `p003`, in order, with no missing-page error.

**Acceptance Scenarios**:

1. **Given** an extract whose folios and translations use different numbering bases, **When** it
   is built, **Then** each page image is paired with its corresponding translation by position in
   the source's own folio sequence, and the edition's pages are in the correct order.

---

### User Story 3 - Untranslatable pages render gracefully; genuine gaps fail loud (Priority: P2)

Some pages legitimately have no translation (a plate, a blank, a title page). The archive marks
those pages as deliberately untranslatable. The build renders a marked page with its facsimile
and whatever text exists and a blank English column; but a page that is *missing* a translation
without being marked halts the build loudly, so a real translation gap is never silently shipped.

**Why this priority**: Without this, either legitimately-untranslatable pages block every build
(today's behavior), or missing translations ship silently. The explicit marker distinguishes the
two.

**Independent Test**: Build a source with (a) a page marked untranslatable and (b) — in a second
run — a page whose translation is absent and unmarked. Confirm (a) renders with a blank English
column and the rest of the edition intact, and (b) fails loud, naming the page.

**Acceptance Scenarios**:

1. **Given** a page marked untranslatable in the archive, **When** the source is built, **Then**
   the page renders (facsimile + any OCR) with a blank/"not translated" English column and the
   build succeeds.
2. **Given** a page with no translation and no untranslatable marker, **When** the source is
   built, **Then** the build fails loud, names the offending page, and produces no PDF for it.

---

### User Story 4 - Reproducible editions pinned to an archive commit (Priority: P3)

A published edition must be reproducible. The build reads a pinned archive commit and records
that exact commit in the edition's colophon, so anyone can regenerate the identical edition from
the same archive state.

**Why this priority**: Reproducibility is a standing corpus guarantee (the colophon already
records the archive pin). Sourcing the pin from the archive clone rather than a snapshot sidecar
must preserve it.

**Independent Test**: Build an edition; confirm the colophon records the archive commit the build
read, and that rebuilding from the same archive commit yields identical edition content.

**Acceptance Scenarios**:

1. **Given** a build run against a pinned archive commit, **When** the edition is produced,
   **Then** the colophon records that commit as the edition's archive provenance.

---

### Edge Cases

- **A page's master is absent from `object_store`** → the build fails loud naming the page (an
  archive-completeness gap); it does NOT fall back to a source-archive image service.
- **A page image's bytes do not match its recorded checksum** → fail loud; never render an
  unverified master.
- **A source has folios but no resolvable archive directory** → fail loud naming the source.
- **An `english-only` variant build** → renders the reading recto exactly as today; the
  archive-direct reader feeds the same edition model.
- **A page marked untranslatable that nonetheless has a translation present** → the marker is
  authoritative for the blank-EN decision; the presence/absence conflict is surfaced, not
  silently resolved (records disagreement rather than guessing).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The PDF build MUST render a source's facsimile edition by reading **exclusively**
  from our normalized archive — page images, OCR, translations, and page ordering all from the
  recorded provenance — and MUST NOT read the committed corpus snapshot.
- **FR-002**: The build MUST NOT parse, require, or depend on any source-archive catalog URL or
  ark (e.g. a Gallica ark) to render a source. Rendering MUST be independent of the origin
  archive.
- **FR-003**: The build MUST enumerate a source's pages from its own folio provenance (the folio
  sequence recorded in the archive), and MUST produce pages in that order.
- **FR-004**: Page images MUST be sourced from each page's recorded `object_store` master (its
  key), and each fetched master MUST be verified against its recorded checksum before use.
- **FR-005**: A page whose master is absent from `object_store`, or whose fetched bytes fail the
  checksum check, MUST fail the build loudly, naming the page — with no fallback to a
  source-archive image service.
- **FR-006**: The build MUST pair each page image with its corresponding OCR and translation by
  the page's position in the source's own folio sequence, correctly handling page-range extracts
  whose folio numbering (absolute) differs from their translation numbering (extract-relative).
- **FR-007**: The build MUST recognize an explicit per-page "untranslatable" marker recorded in
  the archive. A marked page MUST render (facsimile + any OCR) with a blank/"not translated"
  English column and MUST NOT fail the build.
- **FR-008**: A page with no translation that is **not** marked untranslatable MUST fail the
  build loudly, naming the page — a genuine translation gap is never silently rendered.
- **FR-009**: The build MUST read a **pinned archive commit** and MUST record that commit as the
  edition's colophon archive provenance (reproducibility).
- **FR-010**: The build MUST support both edition variants — the `parallel` (FR OCR │ EN
  translation) study recto and the `english-only` reading recto — through the archive-direct
  reader, unchanged from today's output form.
- **FR-011**: The machine-assist translation label (engine + date) MUST carry through to the
  edition unchanged.
- **FR-012**: The build MUST fail loud with a descriptive error on any missing or inconsistent
  input (unresolvable source directory, missing master, checksum mismatch, unmarked missing
  translation, missing pin) and MUST NOT silently skip, substitute, or render partial/placeholder
  content.
- **FR-013**: The archive-direct reader MUST produce the same edition view-model the existing
  renderer consumes, so no change is required downstream of the reader (the renderer, template,
  colophon assembly, and variant handling are reused as-is).

### Key Entities *(include if feature involves data)*

- **Archive Source (as read for rendering)**: a source resolved to its archive directory, with an
  ordered sequence of pages; each page carries its master-image location (`object_store` key +
  checksum), its OCR text, its translation (or an untranslatable marker), and its position in the
  source's own sequence.
- **Untranslatable Marker**: an explicit archive record that a given page is deliberately
  untranslatable, distinguishing it from an accidental translation gap. (Representation finalized
  by the translation pipeline; consumed representation-agnostically.)
- **Archive Pin**: the pinned archive commit the build reads and records in the colophon for
  reproducibility.
- **Edition (existing view-model, reused)**: the pages + title-page + colophon model the Typst
  renderer already consumes; produced by the new reader unchanged in shape.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of sources normalized into the archive (masters in `object_store` + per-page
  OCR/translation) are renderable by the build, regardless of which archive they were acquired
  from — including sources from archives that cannot be rendered today.
- **SC-002**: A page-range-extract source renders with every page image correctly paired to its
  translation (0 misalignments, 0 spurious missing-page errors).
- **SC-003**: 100% of rendered page images are verified against their recorded checksums before
  use; a checksum mismatch or missing master aborts the build (0 unverified masters rendered).
- **SC-004**: A page marked untranslatable renders with a blank English column and does not block
  the build; an unmarked missing translation aborts the build 100% of the time.
- **SC-005**: Every produced edition records, in its colophon, the exact archive commit it was
  built from, and rebuilding from that commit yields identical edition content.
- **SC-006**: The build produces a correct end-to-end facsimile-edition PDF for PB-P055
  (`archive.org` origin, fully translated) and PB-P054 (Gallica page-range extract) — the two
  sources that are unbuildable today.

## Assumptions

- **Read exclusively from our archive** (decided): the build reads a pinned archive clone
  (`CORPUS_ARCHIVE_PATH`) and no longer the committed snapshot; the browser snapshot path is out
  of scope. If the archive clone is unavailable, the build fails loud (no snapshot fallback for
  PDF rendering).
- **Images from `object_store` (B2) only** (decided): the source-archive ark/IIIF path is retired
  for archive-direct rendering; a not-yet-mirrored master is an archive gap to fix, not a fallback
  to invoke.
- **Untranslatable marker representation** (open — being finalized by the translation team): the
  concrete on-archive representation (a sentinel translation file, a folio-sidecar flag, or a
  per-page provenance field) is pending. The requirement (FR-007/FR-008) is representation-
  agnostic; the reader consumes whatever the translation pipeline emits. This is the one
  documented open item and does not block authoring; it is resolved before the reader's
  untranslatable-marker task is implemented.
- **Reproducibility pin** (default): the build records the archive commit it read into the colophon
  `archiveRef`; whether the commit is taken from `CORPUS_ARCHIVE_PATH` at HEAD or from a pinned
  worktree is a plan-time mechanism, not a scope question.
- **Both variants + machine-assist labelling** carry through unchanged from the shipped
  `corpus-print-pdf` edition model; this feature changes only where the edition's inputs come
  from, not how they are rendered.
- **Source → archive-directory resolution** (default): the reader resolves a `sourceId` to its
  archive directory from the recorded provenance (e.g. the folio `local_path` / `object_store` key
  prefix); the exact mechanism is a plan-time detail.

## Dependencies

- **Consumes (shipped)**: `corpus-print-pdf` (the Typst edition renderer + colophon + variant
  handling — reused unchanged downstream of the new reader); `archive-object-store` (the B2
  masters + `object_store` provenance the reader reads); and the acquisition adapters that
  normalize sources into the archive (`gallica-fetcher`, `source-group-acquisition`,
  `museum-acquisition-path`, `page-range-acquisition`, `archiveorg-acquisition-path`).
- **Coordinates with**: the translation pipeline, which finalizes the explicit untranslatable-page
  marker representation the reader consumes (FR-007/FR-008).
- **Out of scope**: the corpus-browser site and its committed snapshot loader (`src/browser/load`)
  — untouched; a future browser+PDF loader unification, if ever wanted, is a separate item.
