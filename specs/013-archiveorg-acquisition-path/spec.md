# Feature Specification: Internet Archive acquisition adapter

**Feature Branch**: `feature/corpus-gap-closure` (long-lived; spec dir `specs/013-archiveorg-acquisition-path` resolved via `.specify/feature.json`, not the branch name — mirrors 009–012)

**Created**: 2026-07-16

**Status**: Draft

**Input**: Design record `docs/superpowers/specs/2026-07-16-archiveorg-acquisition-path-design.md` (approved; design→spec gate 7/7). Originating backlog item **TASK-32**. Motivated by **SRCH-0013**, which verified the de Groote 1880 book is a real, digitised, public-domain corpus-growth target on the Internet Archive that the shipped pipeline cannot reach.

## Context

The corpus-gap-closure program (spec 009) can only *acquire* sources from repositories with a shipped **`RepositoryAdapter`** (`src/repository/adapter.ts`): today **Gallica** (`ark` copies, shipped fetcher) and the **New Italy Museum** (spec 011, `accession` copies). Works held elsewhere are measurable-but-unreachable.

SRCH-0013 (2026-07-16) proved this is a live gap: the **de Groote 1880 promotional book** — *"Nouvelle-France : Colonie libre de Port-Breton, Océanie"*, ~368 pp, a central Port-Breton affair imprint and a long-standing Phase-2 `ROADMAP.md` goal — is verified real, digitised, and public-domain on the Internet Archive (item `nouvellefrancec00groogoog`, a Google Books scan), but absent from Gallica. The operator expects the Internet Archive to hold substantially more affair material, so it warrants a **reusable first-class adapter**, not a one-off manual mirror.

This feature adds one adapter (the third repository) and one RepositoryRecord copy type (`ia-item`). It implements the **shipped** interface — `repository` / `resolve` / `collectRightsEvidence` / `acquire`; **there is no `search` adapter method**, discovery is a separate seam — and reuses the shipped `bib inventory | verify-member | promote | acquire | reconcile` verbs and the coverage audit unchanged. Its "output" is a more complete corpus in the uniform per-page-image archive shape.

## Clarifications

### Session 2026-07-16

- Q: Fidelity rule — when is the PDF degraded enough to fetch the JP2 set instead of exploding it? → A: Dimension-ratio rule — compare the PDF's extracted-image longest-edge pixels against `scandata.xml`'s recorded page dimensions; treat the PDF as degraded (→ fetch `_jp2.zip`) when materially smaller. The exact percentage threshold is tuned in `/speckit-plan` against the de Groote item.
- Q: Per-page extraction — the lossless-vs-rasterise test and the DPI? → A: A page with exactly one raster image object covering the page (via `pdfimages -list`) and no vector overlay → `pdfimages` lossless; otherwise `pdftoppm`-rasterise at the scan's native DPI (from `scandata`), falling back to 400 DPI.
- Q: Staging location + cleanup lifecycle? → A: Stage under the per-session archive clone (`COLONY_ARCHIVE_ROOT`) in a scratch subdir; delete on successful B2 upload; retain on a rejected quality gate for inspection.
- Q: Automated `advancedsearch` discovery — in this spec or later? → A: Out of scope for v1 — manual-backed (operator supplies the item id); the `advancedsearch` `DiscoveryMechanism` is captured for a later spec.
- Q: Distinguish `repository-source` (PDF) from `page-master` (images) — new field or `mediaType`? → A: Add an explicit `role` (+ `sequence`) field to `AcquiredAsset` — explicit and future-proof, not overloading `mediaType`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Acquire a public-domain Internet Archive book (Priority: P1)

The researcher acquires an approved, public-domain Internet Archive item (first consumer: the de Groote 1880 book) end-to-end. The item's PDF is fetched to staging, quality-gated, exploded into per-page image masters, and — with the source PDF preserved — uploaded to B2; `bib reconcile` advances the RepositoryRecord to `archived` and `bib coverage` reflects the new held work.

**Why this priority**: This is the whole point — it turns a verified-but-unreachable Internet Archive work into a held corpus member in the same shape as a Gallica source. Nothing else delivers corpus growth without it.

**Independent Test**: Acquire `nouvellefrancec00groogoog` (with a recorded public-domain `rightsAssessment`); its per-page masters + source PDF land in B2, its RepositoryRecord reconciles to `archived`, and `bib coverage` shows it as held.

**Acceptance Scenarios**:

1. **Given** an Internet Archive item with a recorded `rightsAssessment.rightsStatus === 'public-domain'` and an approved page range, **When** the researcher acquires it, **Then** per-page image masters + the source PDF are stored in B2 with per-page provenance and the RepositoryRecord reconciles to `archived`.
2. **Given** the same item already acquired, **When** acquire is re-run, **Then** already-stored assets are detected by object-store key + checksum and not re-fetched (idempotent continuation).

---

### User Story 2 - Fail-closed quality gate before shared storage (Priority: P1)

The researcher examines the staged PDF and decides whether the scan is sound and which leaves are the legitimate work. A poor, incomplete, or wrong scan is refused with **nothing written to the shared object store**; a sound one proceeds with an approved leaf range recorded.

**Why this priority**: Frugality and archival integrity — the cheap PDF probe must be able to stop before anything touches B2, and the operator's page-range judgment must gate what becomes a master.

**Independent Test**: Mark a staged item `unsound`; assert zero bytes are written to B2 and the RepositoryRecord does not advance. Mark another `sound` with an approved range; assert only that range is produced.

**Acceptance Scenarios**:

1. **Given** a staged PDF the researcher judges unsound (illegible / incomplete / wrong work), **When** the gate is recorded, **Then** acquisition halts, nothing is uploaded to B2, and the source stays cataloged (not archived).
2. **Given** a staged PDF judged sound with an approved leaf range, **When** acquisition proceeds, **Then** only leaves within the approved range become page-master assets and the judgment is persisted as canonical provenance.
3. **Given** a recorded quality assessment, **When** acquisition acts on it, **Then** it first re-verifies the staged PDF's checksum matches the assessed file, failing loud on a mismatch.

---

### User Story 3 - Rights as proposed evidence, authored judgment (Priority: P2)

The adapter proposes rights **evidence** from Internet Archive metadata (the `possible-copyright-status` string, grounded creation date/creator); the researcher authors the canonical `rightsAssessment` on the RepositoryRecord; `acquire` refuses any record without a recorded public-domain judgment. Repository/scanner notices are preserved, never declared legally void by the adapter.

**Why this priority**: Copyright fail-closed (Constitution IV / FR-007). The Internet Archive states its copyright field is uploader-supplied and unwarranted, so it cannot itself decide rights — evidence supports the operator's judgment, it never creates it.

**Independent Test**: `collectRightsEvidence` on an item returns the raw IA status + grounded date/creator and no verdict; `acquire` on a record whose `rightsAssessment` is absent/`restricted`/`uncertain` throws before any fetch.

**Acceptance Scenarios**:

1. **Given** an Internet Archive item, **When** `collectRightsEvidence` runs, **Then** it returns the raw `possible-copyright-status` as evidence (plus grounded date/creator) and authors no rights judgment.
2. **Given** a record whose `rightsAssessment.rightsStatus` is not `public-domain`, **When** acquire is attempted, **Then** it fails closed before any image fetch and the source stays cataloged.
3. **Given** an item bearing a scanner notice (e.g. a "for non-commercial use" page), **When** rights evidence is collected, **Then** the notice is preserved verbatim as evidence and does not override an independently-authored public-domain determination for the underlying work.

---

### User Story 4 - Faithful per-page extraction with full provenance (Priority: P2)

The approved range is turned into per-page image masters under a strict page-to-leaf invariant, each carrying its extraction-method provenance; third-party leaves (scanner notice, cover, color card) are omitted from the reading masters, retained in the preserved source package, and recorded; the source PDF is kept as a `repository-source` asset.

**Why this priority**: Archival correctness — one output image must correspond to one logical page, the reproduction method must be recorded, and no source evidence is destroyed.

**Independent Test**: Explode an item whose pages are single embedded images → all page-masters record `pdfimages`-lossless; explode one with a multi-image/overlay page → that page records `pdftoppm`-rasterised at a recorded DPI; the produced count equals the approved range; excluded leaves appear in `excludedLeaves` and in the retained source PDF but not in the page-masters.

**Acceptance Scenarios**:

1. **Given** an approved page containing exactly one suitable page image, **When** it is extracted, **Then** it is extracted losslessly and records `method: pdfimages-lossless` with the source PDF object.
2. **Given** an approved page that is not a single suitable image, **When** it is produced, **Then** it is rasterised at a recorded DPI and records `method: pdftoppm-rasterised, resolutionDpi`.
3. **Given** a produced page-master set, **When** it is verified, **Then** its count equals the approved leaf range or acquisition fails loud.
4. **Given** excluded third-party leaves, **When** acquisition completes, **Then** they are absent from the page-master reading assets, present in the retained repository-source PDF, and recorded in `excludedLeaves` with classification + reason (never "discarded").

---

### User Story 5 - Robust source selection (fidelity + multi-file) (Priority: P3)

The master source is chosen from measured evidence rather than assumption: the PDF is exploded when it is demonstrably equivalent to the archive's page images, and the `_jp2.zip` is fetched only when the PDF is materially degraded. When an item exposes multiple PDFs or scan packages, resolution is deterministic or fails loud on ambiguity.

**Why this priority**: Correctness and frugality at the edges — most items are fine from the PDF (cheap), but the design must not silently mirror a degraded derivative, nor silently pick among several eligible files.

**Independent Test**: An item whose PDF images match the recorded scan dimensions → PDF is exploded (no JP2 fetch); an item whose PDF is downsampled → the `_jp2.zip` is fetched and used; an item with two equally-eligible page-image PDFs → resolution fails loud.

**Acceptance Scenarios**:

1. **Given** an item whose PDF-extracted images are equivalent to the recorded scan dimensions, **When** the master is selected, **Then** the PDF is exploded and no JP2 set is fetched.
2. **Given** an item whose PDF is measurably degraded, **When** the master is selected, **Then** the `_jp2.zip` is fetched and used, recorded as the master source.
3. **Given** an item exposing multiple equally-eligible PDFs/scan packages, **When** `resolve` runs, **Then** it fails loud rather than guessing; an OCR-only PDF is rejected when a page-image PDF exists; an encrypted/restricted file is rejected.

### Edge Cases

- The chosen PDF's page count does not match the catalogue's expected extent → surfaced in the quality gate (expected vs observed), operator judgment; never silently accepted.
- `scandata.xml` is absent → the page-range seed is unavailable; the operator selects the range manually (the seed never decides on its own regardless).
- A leaf marked non-`Normal` in `scandata.xml` (Cover/Title) is nonetheless part of the historical work → the operator can include it; pageType seeds, it does not decide.
- A remote asset's bytes change between staging and upload (checksum mismatch) → fail loud, write nothing for that asset.
- The item is in copyright / rights uncertain → `acquire` refuses; the work is cataloged as known-but-restricted, not mirrored.
- The same intellectual work is held both here and on Gallica → counted once (single-work-once); the Internet Archive copy is a separate RepositoryRecord.
- `bib migrate` invoked by habit → must be avoided (rebuilds SSOT from stale inputs).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The feature MUST implement the shipped `RepositoryAdapter` interface (`repository` / `resolve` / `collectRightsEvidence` / `acquire`) in `src/repository/internet-archive/`, register it in the `RepositoryAdapterRegistry`, add a new RepositoryRecord copy type **`ia-item`** (identifier = Internet Archive item id), and dispatch from `bib acquire` by copy type — modelled on the shipped New Italy Museum adapter (spec 011). Discovery is NOT an adapter method.
- **FR-002**: `resolve` MUST verify the item exists and is a text via the Internet Archive item metadata API; it MUST fail loud on an unverifiable locator and MUST NOT invent an identifier (FR-008 / Principle V).
- **FR-003**: `resolve` MUST select the source file deterministically when an item exposes several candidates — prefer the canonical/primary page-image PDF; reject an OCR-only PDF when a page-image PDF exists; reject encrypted/restricted files; **fail loud on ambiguous equally-eligible candidates** — and record the selected filename + a metadata snapshot.
- **FR-004**: `collectRightsEvidence` MUST propose evidence only — the Internet Archive `possible-copyright-status` as `rightsRaw`, plus grounded `date`/`creator` — and MUST NOT author a rights judgment.
- **FR-005**: The operator authors the canonical `rightsAssessment` (`rightsStatus` + basis + jurisdiction) on the RepositoryRecord; `acquire` MUST fail closed unless `rightsAssessment.rightsStatus === 'public-domain'`, asserted before any image fetch (011 INV-B / FR-007 / Constitution IV).
- **FR-006**: Repository/scanner notices MUST be preserved verbatim as rights evidence and any non-copyright restriction evaluated and recorded; the adapter MUST NOT declare a notice legally void. An independently-authored public-domain determination for the underlying work stands (a faithful reproduction of a public-domain work is not re-copyrightable).
- **FR-007**: `acquire` MUST fetch the chosen PDF to a **staging subdir under the per-session archive clone (`COLONY_ARCHIVE_ROOT`)** and record its fixity (byte length, sha256) + Internet Archive file metadata; NO bytes reach the shared object store before the quality gate approves. Staged artifacts (the PDF + exploded images) MUST be deleted on a successful B2 upload and retained on a rejected quality gate for inspection.
- **FR-008**: `acquire` MUST enforce a fail-closed **quality gate** whose operator judgment is persisted as canonical provenance (`qualityAssessment`: status, assessedBy/At, source-file checksum, expected vs observed page count, approved leaf range, notes). `scandata.xml` `pageType` MUST only **seed** a proposed approved range that the operator confirms; a non-`Normal` leaf can still be included. Only a `sound` assessment proceeds; `acquire` MUST re-verify the staged PDF checksum matches the assessed file before acting.
- **FR-009**: The master source MUST be selected from measured evidence via a **dimension-ratio rule** — compare the PDF's extracted-image longest-edge pixels against `scandata.xml`'s recorded page dimensions; explode the PDF when its images are not materially smaller; fetch the archive's full-resolution page-image set — the `_jp2.zip` **or, for Google-scanned items such as the de Groote book, the `_tif.zip`** (reconciled at plan time, research D-3, when the captured metadata showed the item exposes `_tif.zip` not `_jp2.zip`) — and use it only when the PDF is materially smaller (threshold fixed during `/speckit-plan`: median dimension-ratio < 0.90, confirmed at first acquire).
- **FR-010**: Page-masters MUST be produced under a strict **page-to-leaf invariant** — per approved logical page, extract losslessly (`pdfimages`) only when the page contains **exactly one raster image object covering the page and no vector overlay** (determined via `pdfimages -list`), else rasterise that page (`pdftoppm`) at the scan's native DPI (from `scandata.xml`, falling back to 400 DPI); the produced count MUST be verified against the approved leaf range (fail loud on mismatch); each master MUST record its per-page method provenance (`method`, `sourcePdfObject` or `resolutionDpi`, `leaf`, `logicalPage`).
- **FR-011**: Excluded third-party leaves (scanner notice, cover, color card) MUST be omitted from the page-master reading assets, retained in the preserved source package, and recorded in `excludedLeaves` (classification + reason) — never "discarded".
- **FR-012**: The repository-supplied PDF MUST be preserved as a `repository-source` `AcquiredAsset` alongside the `page-master` assets, distinguished by an **explicit `role` field (`repository-source` | `page-master`) plus a `sequence` field for page order** (not overloaded onto `mediaType`); downstream corpus tools consume only the `page-master` assets. *(Reconciled at plan time, research D-2: `AcquiredAsset.role` and `.sequence` already exist on the shipped model; the work is to establish the `repository-source`/`page-master` role vocabulary and narrow the field's type to a union — not to add new fields.)*
- **FR-013**: `acquire` MUST upload assets to B2 and return an `AcquisitionResult` that feeds `bib reconcile` (RepositoryRecord → `archived`); it MUST record `metadataSnapshots` (retrievedAt, endpoint, checksum) on the record and set `originalUrl` to the item details page.
- **FR-014**: Discovery is manual-backed in v1 — the operator supplies the Internet Archive item locator (the item id) to `resolve`. An automated `advancedsearch` `DiscoveryMechanism` is OUT OF SCOPE for v1 and captured for a later spec.
- **FR-015**: The feature MUST reuse the shipped `bib inventory | verify-member | promote | reconcile` verbs and the coverage audit unchanged, MUST NOT use `bib migrate`, and MUST count a single intellectual work once (Internet Archive copies are separate RepositoryRecords).
- **FR-016**: All code MUST be fail-loud with no fabrication/no fallbacks (Principle V), typed with `@/` imports, no `any`, files ≤ 300–500 lines, and developed test-first (Principle VII / VIII).

### Key Entities *(include if feature involves data)*

- **Internet Archive item**: the acquisition target — identity is the item id (`nouvellefrancec00groogoog`); exposes files (one or more PDFs, `_jp2.zip`, `scandata.xml`), item metadata (title/creator/date/`possible-copyright-status`), and a details page.
- **`ia-item` CopyIdentifier**: new copy-identity type on RepositoryRecord (the item id), durable across URL changes.
- **RightsEvidence** (proposed) vs **RightsAssessment** (authored): the adapter proposes evidence; the operator authors the judgment on the record; `acquire` gates on it.
- **qualityAssessment**: durable operator judgment — status, assessed-by/at, source-file checksum, expected/observed pages, approved leaf range, notes.
- **AcquiredAsset roles**: an explicit `role` field (`repository-source` for the preserved PDF, `page-master` for the per-page images) plus a `sequence` field for page order, added to `AcquiredAsset`.
- **excludedLeaves**: recorded third-party inserts (leaf, classification, reason).
- **Per-page method provenance**: leaf, logicalPage, method (`pdfimages-lossless` | `pdftoppm-rasterised`), sourcePdfObject or resolutionDpi.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The de Groote 1880 book (`nouvellefrancec00groogoog`) is acquired end-to-end — per-page image masters + the preserved source PDF are in B2, the RepositoryRecord is `archived`, and it appears as a held work in `bib coverage`.
- **SC-002**: An item whose scan is judged unsound results in **zero bytes written to the shared object store** and no RepositoryRecord advance.
- **SC-003**: Every acquired Internet Archive item's RepositoryRecord carries a durable `qualityAssessment`, per-page method provenance, an `excludedLeaves` record, and a preserved `repository-source` PDF asset.
- **SC-004**: An item without a recorded `rightsAssessment.rightsStatus === 'public-domain'` cannot be acquired — `acquire` refuses before any image fetch.
- **SC-005**: The produced page-master count equals the approved leaf range for every acquisition; a mismatch fails loud rather than storing a partial/misaligned set.
- **SC-006**: An item exposing multiple equally-eligible PDFs/scan packages fails loud in `resolve` rather than silently guessing.
- **SC-007**: The archive shape of an acquired Internet Archive work is indistinguishable to downstream tools (reading view, coverage, provenance) from a Gallica work — per-page image masters with per-page provenance.

## Assumptions

- Reuses the shipped `RepositoryAdapter` + registry (`src/repository/adapter.ts`), the New Italy Museum adapter as prior art (spec 011), the metadata-snapshot store (`src/sourcegroup/snapshot.ts`), the `bib` pipeline verbs, and the shipped injected exec runner (`src/ocr/exec.ts`) + poppler (`pdfimages`/`pdftoppm`/`pdfinfo`, declared by `src/ocr/preflight.ts`). *(Reconciled at plan time, research D-6: `src/pdf/` is a PDF **builder** (typst/render/publish), not an exploder — the per-page **extraction** machinery is built new for this feature, composed on the shipped `execCommand` runner; poppler the binary is present, the extraction wrapper is not.)*
- **Discovery is manual-backed in v1**: the operator supplies the item id (SRCH-0013 proved a hand-run archive.org search works). An automated `advancedsearch` `DiscoveryMechanism` is deferred to a later spec.
- Public-domain determination is per item and per jurisdiction, operator-authored; faithful reproductions of public-domain works are not re-copyrightable (the *Bridgeman* principle, a U.S. holding — not universal, so non-copyright restrictions are still assessed).
- The Internet Archive `possible-copyright-status` is uploader-supplied and unwarranted — evidence only.
- **The design record's five open questions were resolved in `/speckit-clarify`** (see Clarifications, Session 2026-07-16): the dimension-ratio fidelity rule (exact % tuned in `/speckit-plan`); the one-raster-image-object per-page test with `pdftoppm` fallback at native/400 DPI; staging under `COLONY_ARCHIVE_ROOT` (clean on success, retain on rejection); automated `advancedsearch` discovery out of scope for v1; and an explicit `role`+`sequence` field on `AcquiredAsset`.
- Work happens in a per-session archive clone; B2 is the only shared asset store.
