# Feature Specification: Canonical Source Metadata Model

**Feature Branch**: `feature/canonical-source-metadata`

**Created**: 2026-07-09

**Status**: Draft

**Roadmap item**: `impl:feature/canonical-source-metadata`

**Design record**: [`docs/superpowers/specs/2026-07-08-canonical-source-metadata-design.md`](../../docs/superpowers/specs/2026-07-08-canonical-source-metadata-design.md)

**Input**: User description: "Canonical Source Metadata Model. Establish a single canonical metadata model for acquired sources … Source → Repository Record → [Issue] → Asset; work-level IDs on Source vs copy-level IDs on Repository Record; acquisition axis distinct from storage axis; Repository Record references an asset manifest; consolidate the five existing metadata representations into one SSOT. Scope: sources only."

## Clarifications

### Session 2026-07-09

- Q: SSOT authoring direction — authored, derived, or hybrid? → A: **Hybrid** — bibliographic Source records are hand-authored; Repository Records and their asset roll-ups are derived from the per-asset provenance the fetcher already writes.
- Q: Where does the SSOT live, and what stays where it is? → A: **Source SSOT in the public repo** (`bibliography/sources/PB-###.yml`); per-copy/per-asset provenance stays where the fetcher/archive already writes it (including the private archive); `sources.csv` + registers become generated views.
- Q: Controlled-vocabulary strictness and required fields? → A: **Closed vocab + minimal required core** — fixed allowed-value sets (rights aligned to Gallica `dc:rights` + SLQ), with a small required-field core and the rest optional.
- Q: What happens to the four legacy representations after the SSOT exists? → A: **Regenerate as committed views** — `sources.csv`, `acquisition-tracker.csv`, `acquisition-register.csv`, and the `PB-P00X.yml` stubs become generated-and-committed views of the SSOT (a regen command + integrity check); the SSOT is the only hand-edited source.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unify one work across multiple archives without losing provenance (Priority: P1)

A curator acquires the same intellectual work from more than one archive over time. Today the per-source record carries a **single** archive field, so re-acquiring a work from a second archive **overwrites and destroys** the record of the first. The curator needs each work to hold **one record per archive copy**, so that acquiring *La Nouvelle France* (`PB-P001`) from Gallica does not erase the fact that it also exists at the State Library of Queensland (SLQ).

**Why this priority**: This is the concrete, already-occurring data-loss bug that motivates the whole feature. It is the minimum viable slice: a model in which one work relates to many archive copies, with each copy's provenance preserved independently, delivers standalone value even before consolidation or validation tooling exist.

**Independent Test**: Record a work with two archive copies (SLQ and Gallica), then re-run the acquisition flow that previously overwrote the record. Verify both copies survive with their distinct catalog URLs, retrieval dates, and identifiers intact.

**Acceptance Scenarios**:

1. **Given** a work (`PB-P001`) already has a Repository Record for its SLQ copy, **When** the same work is acquired from Gallica, **Then** a second Repository Record is added and the SLQ Repository Record remains unchanged and retrievable.
2. **Given** a work with two Repository Records, **When** a user asks "which archives hold this work?", **Then** both archives are listed with their per-copy provenance.
3. **Given** the pre-existing data where PB-P001's SLQ record was lost, **When** the migration runs, **Then** the SLQ Repository Record is restored alongside the Gallica one.

---

### User Story 2 - Enforce work-level vs copy-level identifier placement (Priority: P2)

A cataloguer records identifiers for a source. Work/edition-level identifiers (ISBN, ISSN, OCLC) describe the intellectual work regardless of which archive holds it; copy-level identifiers (ARK, IIIF manifest, scan-DOI) describe one archive's specific digitization. The cataloguer needs the model to place each identifier at the correct level and to **reject** a copy-level identifier recorded at the work level (and vice versa), so the same identifier is never duplicated across copies or ambiguously attributed.

**Why this priority**: Correct identifier placement is what prevents the duplication the model exists to remove. It is second because it presupposes the two-level structure delivered by P1, but it is independently valuable: even with a single copy, keeping ARK off the work record prevents future ambiguity.

**Independent Test**: Author a Source with an ISBN and a Repository Record with an ARK. Attempt to place an ARK on the Source and an ISBN on the Repository Record; verify both misplacements are rejected with a clear message naming the offending identifier and the level it belongs on.

**Acceptance Scenarios**:

1. **Given** a Source record, **When** an ISBN/ISSN/OCLC is recorded on it, **Then** it is accepted.
2. **Given** a Source record, **When** an ARK/IIIF/scan-DOI is recorded on it, **Then** it is rejected as a copy-level identifier that does not belong on a work.
3. **Given** a Repository Record, **When** an ARK/IIIF/scan-DOI is recorded on it, **Then** it is accepted.
4. **Given** two Repository Records for the same work, **When** each holds its own ARK, **Then** neither ARK appears on the shared Source record.

---

### User Story 3 - Consolidate the five representations into one source of truth (Priority: P2)

The project currently carries five overlapping metadata representations (`bibliography/sources.csv`, `bibliography/acquisition-tracker.csv`, the archive's `acquisition-register.csv`, per-source `PB-P00X.yml` stubs, and the fetcher's per-asset provenance YAML). A maintainer editing metadata cannot tell which is authoritative and must update several by hand, so they drift. The maintainer needs **one** canonical representation (the SSOT) from which the other human-facing views are **derived/generated**, so a single edit propagates and the views never disagree.

**Why this priority**: Consolidation is the durable win — it removes the drift surface permanently — but it depends on the model shape from P1/P2 being settled first, so it is not the MVP. It is P2 (not P3) because the design puts it explicitly in scope.

**Independent Test**: Edit a field once in the SSOT, regenerate the derived views, and verify `sources.csv` (and the other derived views) reflect the change with no manual edit and no representation left disagreeing.

**Acceptance Scenarios**:

1. **Given** the SSOT is established, **When** a source's title changes in the SSOT, **Then** regenerating the derived views updates `sources.csv` (and other derived views) to match, with no hand-editing.
2. **Given** the five current representations, **When** migration completes, **Then** exactly one is authoritative and the others are either derived views or retired — no sixth representation is introduced.
3. **Given** a derived view, **When** it is regenerated, **Then** it is byte-reproducible from the SSOT (regeneration is deterministic).

---

### User Story 4 - Enumerate issues of a serial and roll up its assets (Priority: P3)

The first source is a 78-issue periodical. A curator needs a serial's Repository Record to **enumerate its issues** (reusing the existing census in `data/census/PB-###-*.json`) and each issue/copy to reference the **set of mirrored assets** (an asset manifest), rather than a single file or checksum, so periodicals are represented faithfully.

**Why this priority**: Serials are essential to the actual corpus but the single-work multi-archive model (P1) and identifier discipline (P2) are prerequisites. Monographs work without the Issue layer, so it is P3.

**Independent Test**: Load the census for the 78-issue periodical, attach it under the serial's Repository Record, and verify each issue is enumerated and its mirrored assets are referenced via the manifest (not a single checksum).

**Acceptance Scenarios**:

1. **Given** a serial Repository Record, **When** its issues are enumerated, **Then** the count and identity of issues match the census in `data/census/PB-###-*.json`.
2. **Given** a Repository Record (serial or monograph), **When** its mirrored files are referenced, **Then** they are referenced as an asset manifest / asset set, not a single `checksum`.
3. **Given** a monograph (no issues), **When** it is recorded, **Then** the Issue layer is absent and the Repository Record references its assets directly.

---

### User Story 5 - Validate referential integrity across the layers (Priority: P3)

A maintainer needs an automated check that every Asset links up to a Repository Record and every Repository Record links up to a Source, that no copy-level identifier has leaked onto a Source, and that controlled-vocabulary fields hold allowed values — so a broken or orphaned record is caught before it is committed.

**Why this priority**: Validation protects the invariants the earlier stories establish; it is only meaningful once those invariants exist, so it is last. It is still in scope because the design calls for referential-integrity + leak-detection tooling.

**Independent Test**: Introduce (a) an asset with no Repository Record, (b) a Repository Record with no Source, and (c) a copy-level identifier on a Source; run the validator and verify each is reported with a locating message.

**Acceptance Scenarios**:

1. **Given** an asset that references no Repository Record, **When** validation runs, **Then** the orphaned asset is reported.
2. **Given** a Repository Record that references no Source, **When** validation runs, **Then** the orphaned record is reported.
3. **Given** a Source carrying a copy-level identifier, **When** validation runs, **Then** the leak is reported and named.
4. **Given** a fully consistent dataset, **When** validation runs, **Then** it reports success with no findings.

---

### Edge Cases

- **Same work, same archive, re-fetched later**: a second retrieval of an already-recorded copy updates that copy's retrieval date/manifest rather than creating a duplicate Repository Record. (Distinguish "another archive" from "same archive, newer pull".)
- **Legacy asset with no object-store location**: assets predating the object-store feature carry `object_store: null` and fall back to a git-cache `local_path`; the model must represent both a mirrored-to-object-store asset and a legacy git-cached asset without loss.
- **Work acquired from an archive that later becomes unavailable**: a Repository Record whose source archive is dead still retains its provenance (catalog URL, retrieval date, identifiers) as a historical record.
- **Serial issue present in the census but not yet mirrored**: an enumerated issue with no acquired assets yet — represented as a known-but-unacquired issue, not an error.
- **Multiple titles, none authoritative**: a work with canonical, archive-supplied, alternate, and translated titles — all retained as data, none flagged as *the* title.
- **A source with zero Repository Records** (wanted/to-collect, not yet acquired from anywhere) — a valid Source with no copies yet.

## Requirements *(mandatory)*

### Functional Requirements

**Model structure**

- **FR-001**: The model MUST represent a four-level hierarchy: **Source** (intellectual work) → **Repository Record** (one archive's copy) → **Issue** (optional; for serials) → **Asset** (one mirrored file).
- **FR-002**: A Source MUST be able to relate to **multiple** Repository Records, each preserving its own provenance independently; adding a Repository Record MUST NOT mutate or remove any existing Repository Record for the same Source.
- **FR-003**: A Source MUST retain a stable internal identifier (`PB-###`) and MUST record titles as data (canonical / archive-supplied / alternate / translated) with **none** designated authoritative.
- **FR-004**: A Repository Record MUST identify which **source archive** it came from (e.g., Gallica, SLQ, Internet Archive, HathiTrust, Trove) and MUST record that copy's rights, catalog/source URL, retrieval date, and acquisition status.
- **FR-005**: The Issue layer MUST be optional and present only for serials; a monograph MUST be representable with no Issue layer, its Repository Record referencing assets directly.
- **FR-006**: A Repository Record (and, for serials, an Issue) MUST reference its mirrored files as an **asset manifest / asset set**, NOT as a single `checksum` field.

**Identifier placement**

- **FR-007**: Work/edition-level identifiers (ISBN, ISSN, OCLC) MUST be recordable **only** on a Source.
- **FR-008**: Copy-level identifiers (ARK, IIIF manifest, scan-DOI) MUST be recordable **only** on a Repository Record.
- **FR-009**: The system MUST reject a copy-level identifier placed on a Source and a work-level identifier placed on a Repository Record, naming the offending identifier and the level it belongs on.

**Acquisition vs storage axes**

- **FR-010**: The model MUST keep the **acquisition axis** (`source_archive`, `original_url`, `catalog_url` — where a copy was acquired from) distinct from the **storage axis** (where the project's mirror of that copy's assets lives).
- **FR-011**: The storage axis MUST represent an object-store location (`{provider, bucket, key, endpoint}`) when present, a git-cache `local_path` fallback, and a `null` object-store for legacy assets — reusing the existing per-asset provenance established by the archive-object-store feature, without redefining it.
- **FR-012**: The canonical model MUST **layer over** the existing per-asset provenance (the fetcher/object-store ground truth) as an aggregation/index layer; it MUST NOT replace or duplicate the per-file provenance that remains authoritative at the asset level.

**Single source of truth & consolidation**

- **FR-013**: Exactly **one** representation MUST be declared the canonical source of truth (SSOT) for source metadata. The SSOT for the **bibliographic Source** MUST live in the **public** repo as `bibliography/sources/PB-###.yml`. Per-copy/per-asset provenance MUST remain where the fetcher/archive already writes it (including the private archive) and is not relocated by this feature.
- **FR-013a**: Authoring direction MUST be **hybrid**: bibliographic **Source** records are hand-authored; **Repository Records** and their **asset roll-ups** are **derived** from the per-asset provenance the fetcher already writes. The system MUST NOT require hand-authoring of Repository Records or asset lists that can be derived from existing provenance.
- **FR-014**: The four legacy human-facing representations (`bibliography/sources.csv`, `bibliography/acquisition-tracker.csv`, the archive's `acquisition-register.csv`, the per-source `PB-P00X.yml` stubs) MUST become **generated-and-committed views** of the SSOT: a regeneration command produces them and an integrity check confirms they match the SSOT. They MUST NOT be hand-edited, and the feature MUST NOT introduce a sixth independent representation.
- **FR-015**: Regeneration of a derived view from the SSOT MUST be deterministic (the same SSOT yields byte-identical views), so a committed view that drifts from the SSOT is detectable by re-running the regeneration and comparing.
- **FR-016**: A migration MUST fold the existing five representations into the model and MUST **restore the lost SLQ Repository Record for `PB-P001`**.

**Validation**

- **FR-017**: The system MUST provide a referential-integrity check verifying every Asset links to a Repository Record and every Repository Record links to a Source, reporting any orphan with a locating message.
- **FR-018**: The system MUST detect and report a copy-level identifier that has leaked onto a Source.
- **FR-019**: Controlled-vocabulary fields (at minimum `status`, `rights`, `provider`, `ocr_status`) MUST be validated against a **closed** allowed-value set; `rights` values MUST be reconcilable with the archives' own vocabularies (e.g., Gallica `dc:rights`, SLQ). A **minimal required-field core** (at least `id`, a canonical/primary title, and — where a copy exists — `source_archive` and `status`) MUST be enforced; all other fields are optional so partially-catalogued (`wanted` / `to-collect`) sources remain valid. The exact allowed-value sets and the final required-field list are settled during `/speckit-plan` and recorded in the data model.

**Scope boundary**

- **FR-020**: The feature MUST cover **sources only**. People, organizations, ships, places, events, citations, and graph relationships are explicitly out of scope (the separate Phase 3 evidence model).

### Key Entities

- **Source**: The intellectual work. Stable `PB-###` id; work-level identifiers (ISBN/ISSN/OCLC); titles-as-data (canonical/archive/alternate/translated, none authoritative). Relates to one or more Repository Records.
- **Repository Record**: One source archive's copy of a Source. Copy-level identifiers (ARK/IIIF/scan-DOI); rights; catalog/source URL; retrieval date; acquisition status; a reference to an asset manifest; the acquisition axis (`source_archive`, URLs) and a link to the storage axis. Belongs to exactly one Source; a Source may have many.
- **Issue**: For serials only, an enumerated unit of a Repository Record (a periodical issue), reusing the existing census. References its own asset set.
- **Asset**: One mirrored file (page image / OCR text / translation) with its own `sha256` and per-asset provenance (acquisition + storage axes), already emitted by the shipped fetcher + object-store feature. Belongs to a Repository Record (directly, or via an Issue for serials).
- **Source of Truth (SSOT)**: The one canonical representation of source metadata from which derived views are generated.
- **Derived View**: A generated, non-authoritative projection of the SSOT (e.g., `sources.csv`), reproducible deterministically.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A work held at two archives retains **both** copies' provenance through a re-acquisition that previously destroyed one — zero records lost (the PB-P001 SLQ/Gallica case passes).
- **SC-002**: 100% of copy-level identifiers placed on a Source, and work-level identifiers placed on a Repository Record, are rejected with a message naming the identifier and its correct level.
- **SC-003**: Editing one field in the SSOT and regenerating requires **zero** manual edits to any derived view, and no two representations disagree afterward.
- **SC-004**: After migration, exactly **one** representation is authoritative and the count of independent metadata representations drops from five to one-plus-derived-views (no sixth added).
- **SC-005**: The migration restores the previously-lost SLQ Repository Record for PB-P001 (it is present and complete after migration).
- **SC-006**: The 78-issue periodical is represented with all issues enumerated matching the census, and each copy references an asset manifest rather than a single checksum.
- **SC-007**: The referential-integrity + identifier-leak validator reports every seeded orphan and every seeded leak, and reports success on a consistent dataset (no false positives).
- **SC-008**: A committed derived view that is hand-edited away from the SSOT is detected: re-running the deterministic regeneration and comparing flags the drift (no silent divergence between the SSOT and its committed views).

## Assumptions

- **A-001 (SSOT direction)**: **Resolved** (see Clarifications 2026-07-09) — hybrid: authored bibliographic Source, derived Repository Records + asset roll-ups. See FR-013a.
- **A-002 (File layout)**: **Resolved** (see Clarifications 2026-07-09) — Source SSOT at public `bibliography/sources/PB-###.yml`; per-copy/per-asset provenance stays where it is written today. See FR-013. The precise regeneration wiring for each derived view is a `/speckit-plan` detail.
- **A-003 (Census linkage)**: The Issue layer references the existing census artifacts at `data/census/PB-###-*.json` rather than re-deriving issue lists. The exact reference mechanism is a planning detail. *(Design open question 4 — deferred to `/speckit-plan`.)*
- **A-004 (Object-store reuse)**: The storage axis reuses the archive-object-store feature's per-asset `object_store` provenance block as-is (`specs/003-archive-object-store/data-model.md`); this feature depends on that model and does not redefine it.
- **A-005 (Migration is one-way)**: **Resolved** (see Clarifications 2026-07-09) — the legacy representations become generated-and-committed views of the SSOT (regen command + integrity check), not hand-edited and not bidirectionally synced; the migration is a one-time fold. Restoring PB-P001's SLQ record is part of that fold. See FR-014.
- **A-006 (Dependency)**: This feature depends on `impl:feature/archive-object-store`, whose per-asset object-store provenance is the storage-axis foundation. A roadmap `depends-on` edge is to be added once that work is on `main`.
- **A-007 (Identifier vocabularies)**: ISBN/ISSN/OCLC are treated as work-level; ARK/IIIF-manifest/scan-DOI as copy-level, per the design. Additional identifier types encountered later are classified into the same two levels rather than a third.

## Dependencies

- **archive-object-store** (`impl:feature/archive-object-store`, spec `003`): provides the per-asset `object_store` provenance block that is this model's storage axis. This feature layers over it and must not redefine it.
- **Existing census** (`data/census/PB-###-*.json`): the issue enumeration the serial Repository Record reuses.
- **Existing per-asset provenance** (`src/archive/provenance.ts`, `ProvenanceFields`): remains the authoritative per-file ground truth this model indexes.
