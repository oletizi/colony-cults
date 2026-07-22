# Phase 1 Data Model: Source-Group Facsimile PDF

Entities are drawn from the existing corpus model; this feature adds no new
persistent schema beyond the materialized `issue.txt` provenance sidecar (which
reuses the existing companion-provenance shape).

## Source-group (e.g. PB-P060)

- **Fields**: `sourceId`, `kind: source-group`, `case`, `titles`, `rights`,
  `members` (resolved via member `partOf` edges).
- **Rules**: has no `repositoryRecords` and no archival object; never fetched as an
  object. The unit of the combined group edition. Building an empty group fails loud
  (FR-010, edge case).

## Member source (e.g. PB-P061)

- **Fields**: `sourceId`, `kind` (periodical), `partOf` (the group id), `case`,
  `language` (English), `titles`, one or more `repositoryRecords` each with
  `assets`.
- **Relationships**: `partOf` → source-group; owns page-image segment assets + one
  `ocr-text` asset.
- **Rules**: archive layout is derived (not static) and MUST match the on-disk slug
  (FR-001; fail loud on mismatch). Reading language resolved per source; English →
  english-only recto (FR-007).

## Page-image segment asset

- **Fields**: `role: page-master`, `sequence` (1..N ascending), `objectStoreKey`,
  `checksum`, `byteLength`, `mediaType` (image/gif).
- **Rules**: ordered by `sequence` for vertical stacking (FR-006); a missing/
  unresolvable object fails loud (FR-012).

## ocr-text asset

- **Fields**: `role: ocr-text`, `sequence: 0`, `objectStoreKey`, `checksum`,
  `sourceRepresentation: papers-past-text-tab`.
- **Rules**: the source of the materialized `issue.txt`; excluded from the image
  stack (sequence 0). Absent → fail loud (FR-012). Empty/whitespace text → treated
  as a genuine gap (fail loud) unless the leaf is explicitly image-only.

## Materialized issue.txt (+ issue.txt.yml)

- **Fields (issue.txt)**: the English OCR reading text.
- **Fields (issue.txt.yml provenance)**: source `object_store` key, `sha256`,
  `source_representation`, plus the existing companion-provenance fields.
- **Rules**: written into the member's archive dir; idempotent re-write (identical =
  no-op; conflicting = fail loud, FR-004). Not written for sources that already have
  an inline issue.txt (FR-005). Provenance mandatory (Principle III/XV).

## Member edition (in-memory)

- **Fields**: the composed single item — stacked-segment verso image set, english
  OCR reading recto, honest OCR-transcription colophon, pinned archive ref.
- **Rules**: reuses the spec 014 edition model + spec 015 english-only variant;
  itemId === sourceId (monograph convention).

## Group edition (in-memory → one PDF)

- **Fields**: ordered list of member editions (chronological by article date),
  edition-level colophon, pinned archive ref.
- **Rules**: one section per member; deterministic order (FR-009); one PDF (FR-008).

## Build outputs

- **Per-member PDF**: one per member (FR-011), written under `--out`.
- **Group-edition PDF**: one per source-group selector (FR-008/FR-011), under `--out`.
- **Batch result**: `built[]` / `failed[]` per source; a member failure is an
  attributable `failed` entry, siblings continue (FR-013, G-4).
