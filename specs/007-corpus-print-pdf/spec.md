# Feature Specification: Corpus Print PDF

**Feature Branch**: `feature/corpus-print-pdf`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "Corpus Print PDF — a printable scholarly facsimile edition of each corpus item (roadmap item impl:feature/corpus-print-pdf). Produces a print-native artifact — the source scan and its parallel French/English text bound together with provenance, in a print-quality typographic layout — that never lets the propaganda pass for truth."

**Design record**: `docs/superpowers/specs/2026-07-11-corpus-print-pdf-design.md`

**Roadmap item**: `impl:feature/corpus-print-pdf`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Print-quality facsimile edition of one corpus item (Priority: P1)

A researcher wants to hold, cite, and shelve a single corpus item — a newspaper issue or a
monograph — as an offline document. They ask the tool to build that item and receive one
print-ready PDF: a facing-page scholarly facsimile edition where each left page reproduces the
source scan and the facing right page carries the parallel French OCR and English translation,
wrapped in front matter and a colophon that make the item's provenance and critical framing
unmistakable.

**Why this priority**: This is the whole point of the feature — turning an on-screen corpus item
into a citable, archival, offline document. A single correct item PDF is the minimum viable
product; everything else (batch, public export) scales or narrows it.

**Independent Test**: Build one item (e.g. a single *La Nouvelle France* issue) and confirm the
resulting PDF opens, shows every source page as a verso facsimile with its facing FR/EN recto,
carries a title page and a colophon with full provenance, and labels the OCR/translation as
machine-derived.

**Acceptance Scenarios**:

1. **Given** a corpus item present in the pinned snapshot with page scans and FR OCR, **When** the
   researcher builds that item, **Then** the tool produces one PDF containing a facing-page spread
   per source page (verso = facsimile scan, recto = FR OCR │ EN translation).
2. **Given** a built item PDF, **When** the researcher opens it, **Then** the first pages are a
   title page (source metadata: title, creator, date, rights, stable identifier) and the last page
   is a colophon (pinned archive commit, per-image key + checksum, machine-assisted-translation
   label, and the framing that the material is propaganda held as evidence).
3. **Given** an item whose scan is authoritative but whose OCR is noisy, **When** the researcher
   reads any text page, **Then** the facsimile scan is visibly the primary/authoritative element
   and the OCR and translation are visibly labeled as machine-derived, never presented as truth.
4. **Given** an item missing a required datum (e.g. a page with no scan handle), **When** the build
   runs, **Then** it aborts with a descriptive error naming the absent datum — it does not silently
   skip the page or substitute placeholder content.

---

### User Story 2 - Reproducible batch build of the v1 corpus (Priority: P2)

The operator wants to produce the full v1 corpus as a set of PDFs from a single pinned snapshot,
reproducibly, so the same input always yields the same editions and each build is auditable.

**Why this priority**: The value compounds when the whole shipped corpus is buildable in one pass,
but it depends on US1 (a correct single item) being solid first. Reproducibility from a pinned
snapshot is what makes the output a citable research artifact rather than a one-off.

**Independent Test**: Run a batch build over the v1 corpus (PB-P001's 78 issues + the PB-P008–011
monographs) against a pinned snapshot commit and confirm one PDF is produced per bibliographic
item, and that re-running against the same pin yields content-identical PDFs.

**Acceptance Scenarios**:

1. **Given** the pinned snapshot for the v1 corpus, **When** the operator runs a batch build,
   **Then** exactly one PDF is produced per bibliographic item (each issue → its own PDF; each
   monograph → one PDF).
2. **Given** a completed batch build, **When** the operator rebuilds from the same pinned snapshot
   commit, **Then** the resulting PDFs are content-identical (reproducible).
3. **Given** a batch build in progress, **When** any item fails a data-integrity check, **Then**
   that failure is surfaced loudly and attributable to the specific item, not swallowed.

---

### User Story 3 - Deliberate public-domain export for distribution (Priority: P3)

A public visitor should be able to receive a distributable edition, but only of material that is
lawfully redistributable. The operator produces a public export that is a deliberate public-domain
subset of the corpus, distinct from the internal-first full build that reads the private archive.

**Why this priority**: Public distribution is valuable but must not leak restricted material; it is
a deliberate, narrower export layered on top of the internal build, so it follows the core build.

**Independent Test**: Run the public export and confirm the produced set contains only
public-domain items/pages, with restricted material excluded, and that each exported PDF still
carries its provenance colophon.

**Acceptance Scenarios**:

1. **Given** a corpus containing both public-domain and restricted items, **When** the operator
   runs the public export, **Then** only public-domain items/pages are included and restricted
   material is excluded.
2. **Given** the internal-first default, **When** no export is requested, **Then** the tool reads
   the private archive locally and produces internal editions without publishing anything.

---

### Edge Cases

- **Translation alignment mismatch**: an item has only issue-level EN translation while the recto
  wants per-page EN. The recto shows per-page FR OCR with the issue-level EN flowed or
  approximately aligned; per-page EN is used when available. The label always states the
  translation granularity so the reader is not misled about alignment.
- **Missing or unreadable page scan**: build aborts loudly naming the item and page (no placeholder,
  no skip).
- **Image provider unavailable**: when the primary provider (object-store masters) cannot serve an
  image, the alternate provider (source IIIF) is used per configuration; if neither can serve it,
  the build fails loud.
- **Very long newspaper run**: a source with many issues produces many per-issue PDFs, not one huge
  bound volume (the citable unit is the issue).
- **Font not licensed for embedding**: the build must not embed a font whose license forbids
  distribution embedding; this is caught before producing a distributable PDF.
- **Oversized image vs file-size budget**: page images are fetched at print resolution; the build
  balances fidelity against distributable file size (sized derivative vs full-size).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate one print-ready PDF per bibliographic item — each newspaper
  issue becomes its own PDF and each monograph becomes one PDF (a newspaper run is N issue PDFs,
  not one bound volume).
- **FR-002**: Each generated PDF MUST use a facing-page spread: the verso (left) reproduces the
  page's facsimile scan and the recto (right) carries the parallel French OCR and English
  translation in two columns.
- **FR-003**: The facsimile scan MUST be presented as the authoritative representation of the page;
  OCR and translation MUST be visibly labeled as machine-derived and MUST NOT be presented as the
  authoritative text.
- **FR-004**: Each PDF MUST include a title page carrying the item's source metadata: title,
  creator/author, date, rights status, and stable identifier (ARK/catalog URL).
- **FR-005**: Each PDF MUST include a colophon carrying reproducibility and framing provenance: the
  pinned archive commit, each embedded image's object-store key and sha256 checksum, the
  machine-assisted-translation label (engine + date, per the project translation policy), and the
  critical framing that the material is propaganda held as evidence.
- **FR-006**: System MUST source all corpus content (source → issue → page structure, French OCR,
  English translation, and image handles) from the corpus-browser normalized snapshot, pinned to a
  specific archive commit, and MUST NOT re-derive or re-normalize the corpus itself.
- **FR-007**: System MUST fetch each page image at print resolution at generation time and embed it
  in the PDF.
- **FR-008**: System MUST support a configurable image provider, with object-store masters as the
  primary source and the source IIIF endpoint as the alternate, matching the browser's configurable
  image source.
- **FR-009**: System MUST fail loud with a descriptive error on any missing or inconsistent corpus
  datum (e.g. a page without a scan, a referenced image that cannot be retrieved) and MUST NOT
  substitute mock/placeholder data or silently skip content.
- **FR-010**: System MUST expose a build command (a CLI/npm verb) sibling to the existing site
  build/snapshot verbs, able to build a single item and to build the corpus in batch.
- **FR-011**: System MUST accommodate both per-page and issue-level English translation: when
  per-page EN exists it is used per page; when only issue-level EN exists the recto shows per-page
  FR OCR with the issue-level EN flowed/approximately aligned, and the translation granularity is
  labeled.
- **FR-012**: System MUST default to internal-first operation (reading the private archive locally
  and publishing nothing); public distribution MUST be a deliberate public-domain subset export
  that excludes restricted material.
- **FR-013**: The print edition's visual and typographic design MUST follow the Prospectus/Dossier
  identity (print-adapted, reusing its design tokens) and MUST be produced through the
  frontend-design skill before any template markup/styling is authored (project Constitution XI).
- **FR-014**: Any font embedded in a distributable PDF MUST be licensed for embedding and
  redistribution.
- **FR-015**: v1 corpus coverage MUST include PB-P001 *La Nouvelle France* (78 issues) and the Port
  Breton monographs PB-P008–PB-P011, with the data layer generalized so any source in the snapshot
  can be built without item-specific code.
- **FR-016**: Each build MUST record enough provenance (in the colophon and/or build output) that a
  reader or auditor can reproduce it: the exact pinned snapshot commit and every embedded image
  identified by checksum.

### Key Entities *(include if feature involves data)*

- **Corpus Item**: the bibliographic unit that becomes one PDF — a newspaper issue or a monograph;
  carries source metadata (title, creator, date, rights, stable identifier) and an ordered set of
  pages.
- **Page**: a single leaf of an item; carries a facsimile scan reference, French OCR text, and
  (per-page or inherited issue-level) English translation.
- **Page Image**: the print-resolution scan for a page; identified by an object-store key and a
  sha256 checksum, retrievable from a primary (object-store) or alternate (IIIF) provider.
- **Translation Unit**: the English translation attached at page or issue granularity, labeled with
  its machine-assist engine and date and its alignment granularity.
- **Snapshot Pin**: the specific archive commit the build reads from — the reproducibility anchor.
- **PDF Edition**: the output artifact for one item — front matter (title page), the facing-page
  body, and the colophon.
- **Public Export Set**: the deliberate public-domain subset of editions cleared for public
  distribution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every item in the v1 corpus (PB-P001's 78 issues + PB-P008–011) produces a valid,
  openable PDF containing every one of that item's source pages, with zero missing pages.
- **SC-002**: 100% of images embedded in any PDF are traceable from that PDF's colophon (each by
  object-store key + sha256), and the colophon names the exact snapshot commit — so any build is
  reproducible from the artifact alone.
- **SC-003**: On every text page of every edition, a reader can distinguish the authoritative
  facsimile scan from the machine-derived OCR and translation (the machine-derived material is
  labeled on 100% of applicable pages).
- **SC-004**: Rebuilding any item from the same pinned snapshot commit yields a content-identical
  PDF (reproducible builds).
- **SC-005**: Any missing or inconsistent source datum aborts the affected build with a message
  naming the absent datum — zero silent skips or placeholder substitutions across a full corpus
  build.
- **SC-006**: The public export contains only public-domain items/pages — zero restricted items or
  pages leak into a public distribution set.

## Assumptions

- **Engine (design-fixed)**: the design selected a print-native document engine (Typst) for precise
  pagination, running-head, column, and hyphenation control; the template and fonts live in-repo and
  the engine is a documented build dependency. The engine choice is recorded in the design record;
  this spec states the capability requirements it must satisfy, and the engine detail is settled in
  planning.
- **Snapshot is the single source of truth**: the corpus-browser normalized snapshot already exists,
  is pinnable to an archive commit, and provides the source→issue→page structure with FR OCR, EN
  translation, and image handles. The PDF generator consumes it and does not re-derive the corpus.
- **Translation output shape**: the in-flight source-translation work may emit per-page or
  issue-level EN; the spec accommodates both (FR-011). Where only issue-level EN exists, alignment
  is approximate and labeled.
- **Image resolution vs file size**: page images are fetched at print resolution; the exact
  resolution and whether a sized derivative or full-size image is used is a planning-time tuning
  decision balancing fidelity against distributable file size.
- **Bound-volume option out of scope for v1**: per-source concatenation into a single bound volume
  is deferred (not foreclosed); v1 is per-item.
- **B2 read cost accepted for v1**: fetching masters at generation incurs an object-store Class-B
  read cost per build; read-cost mitigation (CDN read-caching per TASK-12, or a local image cache)
  is a separate optimization, not a precondition of v1.
- **Public-vs-private repository boundary**: the private archive holds mirrorable scans; the public
  repository never holds restricted reproductions. The public export honors this boundary
  (Constitution IV).

## Dependencies

- **Consumes (closed)**: `corpus-browser` (normalized snapshot + pinned-snapshot model),
  `canonical-source-metadata` (source metadata for front matter), `archive-object-store` (B2 image
  handles/keys + checksums).
- **Consumes (in-flight)**: `source-translation` (English translation output; per-page or
  issue-level shape).
- **Related backlog**: `TASK-12` (CDN read-caching) — a read-cost optimization that this feature's
  bulk builds motivate but do not require.
