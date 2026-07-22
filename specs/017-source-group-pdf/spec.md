# Feature Specification: Source-Group Facsimile PDF (Papers Past NZ press)

**Feature Branch**: `feature/edition-publishing` (spec dir `specs/017-source-group-pdf`)

**Created**: 2026-07-21

**Status**: Draft

**Input**: Design record `docs/superpowers/specs/2026-07-21-source-group-pdf-design.md` (approved 2026-07-21). Render source-group members — the Papers Past NZ press coverage of the Marquis de Rays / Port Breton affair (group PB-P060, member articles PB-P061..PB-P092, English-language newspaper clippings) — as facsimile-edition PDFs, producing BOTH one PDF per member article and one combined group edition. Builds on spec 014 (archive-direct-pdf) and spec 015 (english-source-pdf). Scope: PDF rendering + the archive materialization it requires; the browser snapshot/public-export path is out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a facsimile PDF for one Papers Past member article (Priority: P1)

An operator runs the PDF build for a source-group member (e.g. PB-P061, "Conviction of Marquis de Rays", Hawera & Normanby Star, 1884). The member is an English newspaper clipping held in the normalized archive as flat page-image segment folios with the article's English OCR in a **detached** `ocr-text` asset (not inline). Today this member cannot be built: the build never registers a group member's archive layout, and even with the layout it finds no reading text and no issue structure. After this feature, the build resolves the member, obtains its English reading text, composes the article scan from its image segments, and produces a complete english-only facsimile PDF.

**Why this priority**: This is the reusable unit — without a buildable member there is no group edition and no per-article output. Delivering just this produces a real PDF for every already-acquired Papers Past article.

**Independent Test**: Point the build at a single member fixture (flat page-image segment folios + a detached ocr-text asset, no inline `issue.txt`) and confirm it produces a PDF whose verso is the stacked article scan and whose recto is the English OCR reading text. Verifiable end-to-end against PB-P061.

**Acceptance Scenarios**:

1. **Given** a source-group member with a registered bibliography record and an existing flat-folio archive directory, **When** the operator builds its PDF, **Then** the build resolves the member's archive layout (no "no archive layout registered" error) and completes.
2. **Given** a member whose English OCR lives only in a detached `ocr-text` asset, **When** the build assembles the member, **Then** the reading recto text is that OCR, obtained by materializing it into the archive as `issue.txt` (with provenance recording the source asset key, checksum, and representation) before the reader consumes it.
3. **Given** a member with N page-image segments (column strips of one clipping), **When** the build composes the member's page, **Then** the verso shows the segments stacked vertically in ascending segment order as one reconstructed clipping, facing the English reading recto.
4. **Given** a built member PDF, **When** the operator inspects it, **Then** the colophon honestly states OCR transcription (no machine-translation claim) and references the pinned archive commit.

---

### User Story 2 - Build the combined PB-P060 group edition (Priority: P1)

An operator runs the PDF build for the source-group itself (PB-P060). The build enumerates the group's acquired members, orders them chronologically by article date, renders each as a section (its heading + composed verso/recto spread), and emits ONE PDF representing the whole "NZ press coverage of the de Rays affair" collection, with a single edition-level colophon and pinned-archive reference.

**Why this priority**: The combined edition is the coherent, readable deliverable (a collection document rather than ~32 loose clippings); it is an explicit operator-requested output alongside the per-member PDFs.

**Independent Test**: Point the build at a source-group fixture with ≥2 members and confirm it produces a single PDF containing every member as a date-ordered section with one edition-level colophon. Verifiable end-to-end against PB-P060.

**Acceptance Scenarios**:

1. **Given** a source-group with ≥1 acquired member, **When** the operator builds the group, **Then** one PDF is produced containing each member as a section.
2. **Given** members with differing article dates, **When** the group edition is assembled, **Then** sections appear in ascending article-date order (ties broken by member id).
3. **Given** a source-group selector, **When** the build runs, **Then** it does not attempt to fetch the group itself as an archival object (a source-group has no archival object) — it enumerates members.

---

### User Story 3 - Existing builds are unchanged (Priority: P1)

An operator builds any pre-existing source — a French periodical (PB-P001), an English monograph (PB-P056), the English press leaves (PB-P057–P059). Behavior and output are exactly as before. Adding source-group/member support must be strictly additive.

**Why this priority**: A regression here would silently corrupt or fail the already-shipped editions. The feature is only acceptable if existing sources are byte-for-byte unaffected.

**Independent Test**: Build an unchanged non-member source fixture and confirm identical output; confirm a genuinely missing required input (e.g. an absent translation for a French source) still fails loud as before.

**Acceptance Scenarios**:

1. **Given** a French-language source with complete OCR + translations, **When** the operator builds it, **Then** output is identical to pre-feature behavior.
2. **Given** an English monograph (PB-P057) already buildable via its inline `issue.txt`, **When** the operator builds it, **Then** output is unchanged and no materialization step alters its archive directory.

---

### User Story 4 - Batch discovery includes buildable members with attributable failure (Priority: P2)

An operator runs a whole-corpus batch build. Buildable source-group members are discovered and built alongside standalone sources; a member that cannot be built (e.g. an unresolvable asset) is reported by id in the batch summary and does not abort its siblings.

**Why this priority**: Members were previously invisible to batch discovery (silently skipped). Making them discoverable — with the existing record-and-continue attribution — lets the corpus batch cover the Papers Past vein without one bad member killing the run.

**Independent Test**: Run the batch over a fixture archive containing standalone sources and members, with one member deliberately broken; confirm the healthy members build, the broken one is listed as a named failure, and the batch exits non-zero.

**Acceptance Scenarios**:

1. **Given** an archive with buildable members, **When** the operator runs the batch build, **Then** each buildable member is discovered and built.
2. **Given** one member with an unresolvable required input, **When** the batch runs, **Then** that member is recorded as an attributable failure (id + reason), its siblings still build, and the run's summary reports "built N, failed M" with a non-zero exit when M > 0.

---

### Edge Cases

- **Source-group with zero acquired members**: building the group fails loud naming the empty group (nothing to assemble), rather than emitting an empty PDF.
- **Member missing its `ocr-text` asset**: the member build aborts with an attributable error naming the member and the missing reading text — no fabricated/blank reading recto.
- **Member with a missing or unresolvable page-image segment (B2 object absent)**: aborts that member with an attributable error; in a batch, siblings continue.
- **Member whose derived archive slug does not match the on-disk directory**: fails loud (layout mismatch) rather than silently building the wrong directory.
- **Re-running the build after `issue.txt` already materialized**: idempotent — an identical re-materialization is a no-op; a conflicting one fails loud rather than clobbering.
- **A member that is itself English but has an empty/whitespace `ocr-text`**: treated as a genuine gap (fail loud), consistent with the empty-OCR safety net; a legitimately image-only leaf is marked (blank recto) rather than silently blank.
- **Non-English member under a group** (should not occur for PB-P060, but the mechanism is general): the reading language is resolved per the source; a member requiring translation follows the French path's rules, not the english-only path.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The PDF build MUST resolve a source-group member's archive layout when building that member directly, registering it via the existing member-layout derivation bridge (the same mechanism the acquire/ocr/translate commands use) rather than requiring a hand-authored static registry entry.
- **FR-002**: Whole-corpus batch discovery MUST register member layouts before its discoverability filter so that buildable members are discovered (not silently skipped).
- **FR-003**: The build MUST obtain a member's English reading text by materializing its detached `ocr-text` asset into the member's archive directory as `issue.txt`, accompanied by a provenance sidecar recording the source asset's object-store key, checksum, and source representation.
- **FR-004**: Materialization MUST be idempotent — re-materializing identical content is a no-op; a conflicting re-materialization MUST fail loud rather than overwrite operator/archive state.
- **FR-005**: The build MUST NOT alter the archive directory of a source that already carries an inline `issue.txt` (existing monographs are untouched).
- **FR-006**: A member MUST render as a single facsimile item whose verso stacks the member's page-image segments vertically in ascending segment order, composing one reconstructed clipping image, without depending on an external image-processing tool.
- **FR-007**: A member's reading recto MUST be its English OCR text rendered via the shipped english-only reading layout (no French-OCR │ English-translation split, no translation requirement), with an honest OCR-transcription colophon.
- **FR-008**: The build MUST accept a source-group selector and produce one combined group-edition PDF that enumerates the group's members, renders each as a section, and includes a single edition-level colophon and pinned-archive reference.
- **FR-009**: The group edition MUST order member sections chronologically by article date, with ties broken deterministically by member id.
- **FR-010**: The build MUST NOT attempt to fetch a source-group as an archival object (a source-group has no archival object); building a group means enumerating and rendering its members.
- **FR-011**: The build MUST produce BOTH per-member PDFs (one per member article) and the combined group-edition PDF.
- **FR-012**: Every required input that is missing or unresolvable (member layout underivable, `ocr-text` asset absent, page-image segment/B2 object unresolvable, empty group) MUST fail loud with an attributable, id-naming error and MUST NOT fabricate reading text or images.
- **FR-013**: In a batch build, a per-member failure MUST be caught and recorded (id + reason) without aborting sibling builds, and the run MUST report "built N, failed M" and exit non-zero when M > 0.
- **FR-014**: Reproducibility MUST be preserved — the combined and per-member editions record the pinned archive commit in their colophon, consistent with the archive-direct build.
- **FR-015**: Cross-masthead syndication de-duplication (collapsing the same cable reprinted across mastheads) is explicitly OUT OF SCOPE; the build renders the acquired members as-is.

### Key Entities *(include if feature involves data)*

- **Source-group (PB-P060)**: a research-defined collection; has members (via `partOf` edges), no `repositoryRecords`, never fetchable. The unit of the combined edition.
- **Member source (PB-P061..PB-P092)**: an English newspaper-clipping source belonging to a group; carries its own repository record, page-image segment assets, and one `ocr-text` asset.
- **`ocr-text` asset**: the detached English OCR of a member article (role `ocr-text`, source representation `papers-past-text-tab`), stored in the object store; the source of the materialized `issue.txt`.
- **Page-image segment**: one region strip (`page-master`, ascending sequence) of a member's single clipping; multiple segments compose one verso image.
- **Materialized `issue.txt` (+ provenance sidecar)**: the reader-consumable reading text written into a member's archive directory from its `ocr-text` asset.
- **Member edition**: a single-item facsimile edition (stacked-segment verso │ English OCR recto) — the per-member PDF and the group edition's section unit.
- **Group edition**: the combined, date-ordered PDF assembled from all of a group's member editions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of PB-P060's acquired members render to a per-member facsimile PDF whose verso is the reconstructed clipping scan and whose recto is the English OCR reading text.
- **SC-002**: Building the PB-P060 selector yields exactly one combined PDF containing every acquired member as a section, in ascending article-date order.
- **SC-003**: Every previously-buildable source (French periodical, English monograph, English press leaves) produces output identical to its pre-feature build (no regression), and no pre-existing archive directory is modified by the build.
- **SC-004**: In a batch build with a deliberately broken member, the run reports the broken member by id, builds every healthy member and standalone source, and exits non-zero — no silent success and no aborted siblings.
- **SC-005**: A member missing a required input (ocr-text asset or a page-image segment) is reported by id with the specific missing input, and no PDF with fabricated or blank reading content is produced for it.

## Assumptions

- **Group selector surface**: a source-group id passed as the build selector (e.g. `PB-P060`) triggers the combined group edition — the build detects `kind: source-group` and assembles — rather than requiring a separate `--group` flag. (Design open question; reasonable default; confirmable in `/speckit-clarify`.)
- **Segment ordering** within a member follows the page-image assets' ascending `sequence`; the `ocr-text` asset (sequence 0) is excluded from the image stack.
- **Group-edition colophon scope**: one edition-level colophon plus a per-section source-attribution line (masthead + date), rather than a full per-article colophon.
- **`issue.txt` materializer home**: implemented as a reusable materializer callable from the build path (and available to a future re-acquire), rather than duplicated logic; exact placement decided at plan time.
- **Segment image format**: members' segments are `image/gif`; the reading layout embeds them at print resolution. If GIF fidelity is inadequate, conversion happens on fetch (an implementation detail, not a scope change).
- **Public/site export**: the combined and per-member editions are internal/print artifacts written under the build output root only (internal-first, no publish/upload step); inclusion in the public site export is out of scope for this feature.
- **Per-member PDFs are wanted** as durable outputs (operator decision: "both"), not merely as an intermediate for the group edition.
- **Reuse**: the archive-direct reader, edition model, Typst template, english-only reading variant, OCR-transcription colophon, `blank_recto` marker, and the `ensureMemberLayoutRegistered` bridge are reused; the feature adds routing + materialization + segment-stacking + group-assembly, not new rendering machinery.
- **Environment**: building requires a resolvable archive root (`COLONY_ARCHIVE_ROOT`/`--archive-root`), object-store (B2) access for asset bytes, and the Typst binary — the same prerequisites as the existing archive-direct build.
