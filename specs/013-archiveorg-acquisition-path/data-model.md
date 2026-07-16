# Phase 1 Data Model: Internet Archive acquisition adapter

**Feature**: `specs/013-archiveorg-acquisition-path` | **Date**: 2026-07-16

Grounded in the shipped models (`src/model/`, `src/repository/`, `src/bibliography/vocab.ts`). Only the
deltas this feature introduces are new; everything else is reuse. Field additions are **additive and
optional** (`?`) so existing records and the Gallica/museum paths are unaffected.

## Closed-vocabulary widenings (3)

| Vocabulary | File | Today | Add |
|---|---|---|---|
| `RepositoryName` | `src/repository/adapter.ts` | `'gallica' \| 'new-italy-museum'` | `\| 'internet-archive'` |
| `CopyLevelIdentifierType` | `src/model/identifiers.ts` | `'accession' \| 'ark' \| 'iiif-manifest' \| 'scan-doi'` | `\| 'ia-item'` |
| `IDENTIFIER_TYPE_REPOSITORY` | `src/repository/registry.ts` | `{ ark:'gallica', accession:'new-italy-museum' }` | `ia-item: 'internet-archive'` |

**Acquisition-status vocabulary is unchanged** — `['wanted','to-collect','collecting','collected','archived']`
(`src/bibliography/vocab.ts`); IA records traverse the same lifecycle and `reconcile` advances to `archived`.

## Entities

### Internet Archive item (external — the acquisition target)

Identity = the archive.org **item id** (e.g. `nouvellefrancec00groogoog`), stable across URL changes.
Fetched from the metadata API `https://archive.org/metadata/<id>`. Relevant fields (verified against the
captured de Groote response):

- `metadata.mediatype` (must be `texts`), `metadata.title`, `metadata.creator`, `metadata.date`/`year`,
  `metadata.possible-copyright-status`, `metadata.scanner`, `metadata.identifier`.
- `files[]`: each `{ name, format, source, size, md5, sha1, crc32, original?, filecount? }`. The adapter
  reads the file list to select: the primary page-image **PDF** (`format: "Image Container PDF"` /
  `"Text PDF"`), the **scandata** (`format: "Scandata"`, `<id>_scandata.xml`), and the full-resolution
  **image set** (`<id>_jp2.zip` `format: "Single Page Processed JP2 ZIP"` **or** `<id>_tif.zip`
  `format: "Single Page Processed TIFF ZIP"`). Encrypted/restricted and OCR-only PDFs are rejected.

### `ia-item` CopyIdentifier (reuse `CopyIdentifier`)

`{ type: 'ia-item', value: <item id> }` on `RepositoryRecord.identifiers`. Never fabricated — `resolve`
verifies the item exists and is `mediatype:texts` before emitting it (INV-A).

### `RepositoryRecord` — two new optional fields (`src/model/repository-record.ts`)

Existing relevant fields (reused unchanged): `identifiers?`, `rightsAssessment?`, `status`,
`assets?: AcquiredAsset[]`, `metadataSnapshot?: MetadataSnapshotRef`, `sourceUrl?`, `verification?`.

```ts
// EDIT: add two optional provenance fields (types live in src/model/quality-assessment.ts)
qualityAssessment?: QualityAssessment;   // FR-008
excludedLeaves?: ExcludedLeaf[];         // FR-011
```

### `QualityAssessment` (NEW — `src/model/quality-assessment.ts`)

Durable operator judgment, canonical provenance (not session state).

```ts
export interface QualityAssessment {
  status: 'sound' | 'unsound';
  assessedBy: 'operator';
  assessedAt: string;                 // ISO-8601
  sourceFileChecksum: string;         // sha256 of the staged PDF the judgment was made against
  expectedPageCount: number;          // from the catalogue/extent
  observedPageCount: number;          // from the staged PDF (pdfinfo)
  approvedLeafRange: LeafRange;       // { start: number; end: number } (1-based, inclusive)
  notes?: string;
}
export interface LeafRange { start: number; end: number; }
```

Rules: only `status: 'sound'` lets `acquire` proceed (FR-008 / SC-002). `acquire` re-verifies the staged
PDF's sha256 equals `sourceFileChecksum` before acting; mismatch → throw (FR-008 edge case). The
`approvedLeafRange` is **seeded** from `scandata.xml` `pageType` (Cover/Title/Normal/…) but the operator
confirms — a non-`Normal` leaf may still be included (seed never decides).

### `ExcludedLeaf` (NEW — `src/model/quality-assessment.ts`)

```ts
export interface ExcludedLeaf {
  leaf: number;                                       // 1-based leaf index in the source PDF
  classification: 'scanner-notice' | 'cover' | 'color-card' | 'blank' | 'other';
  reason: string;                                     // never "discarded" — the source PDF retains it
}
```

Excluded leaves are omitted from the `page-master` reading assets, **retained** in the preserved
`repository-source` PDF, and recorded here (FR-011).

### `AcquiredAsset` — role vocabulary refinement (`src/model/acquired-asset.ts`)

Fields `role?` and `sequence?` **already exist** (D-2). This feature establishes the canonical role
values and narrows the type so the distinction is checked:

```ts
// single source of truth: a const tuple → union + runtime guard (so the YAML
// loader can fail loud on an unknown stored role — Principle V)
export const ACQUIRED_ASSET_ROLES = [
  'front', 'reverse', 'page',           // existing sheet/page values (preserved)
  'primary',                            // existing — the single master the museum adapter writes (T007 fallout, corrected)
  'repository-source',                  // NEW — the preserved source PDF (exactly one per acquisition)
  'page-master',                        // NEW — one per approved logical page
] as const;
export type AcquiredAssetRole = (typeof ACQUIRED_ASSET_ROLES)[number];
export function isAcquiredAssetRole(v: string): v is AcquiredAssetRole { /* ... */ }

// role?: string  →  role?: AcquiredAssetRole
```

> **Correction (impl T007):** the plan originally omitted `'primary'` from the union; the shipped
> New Italy Museum adapter writes `role: 'primary'` on its master asset, so narrowing to the union
> broke it. `'primary'` is added (capturing the existing reality, Principle V/XIV), and the YAML
> loader (`@/bibliography/load-fields`) now validates the stored role against the guard and fails
> loud on an unknown value — the value-channel the narrowing opened.

Per acquisition: exactly one `repository-source` asset (mediaType `application/pdf`) + N `page-master`
assets (mediaType `image/jpeg`, `sequence` = logical page order). Downstream corpus tools consume only
`page-master` assets. Each master additionally carries **per-page method provenance** on its
`provenancePath` record (below).

### Per-page method provenance (recorded on each `page-master`'s provenance record)

```ts
export interface PageMethodProvenance {
  leaf: number;                        // source-PDF leaf index
  logicalPage: number;                 // reading order (== AcquiredAsset.sequence)
  method: 'pdfimages-lossless' | 'pdftoppm-rasterised';
  sourcePdfObject?: string;            // when pdfimages-lossless — the image object id
  resolutionDpi?: number;              // when pdftoppm-rasterised — the DPI used
}
```

Exactly one of `sourcePdfObject` / `resolutionDpi` is set per the method (fail loud otherwise).

### Metadata snapshot (reuse `src/sourcegroup/snapshot.ts`)

`writeSnapshot(baseDir, { sourceId, ark: <item id>, raw, retrievedAt, endpoint, normalizationVersion, stamp })`
→ persisted write-once under `bibliography/repository-responses/<sourceId>/<slug(item id)>-<stamp>.json`,
referenced from `RepositoryRecord.metadataSnapshot` (`MetadataSnapshotRef`). `endpoint` =
`https://archive.org/metadata/<id>`. A dedicated `IA_NORMALIZATION_VERSION` constant (starts at `1`),
paralleling `MUSEUM_NORMALIZATION_VERSION`.

## State transitions (unchanged lifecycle; IA-specific gates)

```text
inventory      → RepositoryRecord authored, status = 'wanted', identifiers = [{ia-item}], metadataSnapshot set
rights-assess  → operator authors rightsAssessment (public-domain | restricted | uncertain)
verify-member  → work-membership verified (existing verb)
promote        → status → to-collect (existing verb)
acquire        → GATE 1 (rights): throw unless rightsAssessment.rightsStatus === 'public-domain' (before any fetch)
                 fetch PDF → staging; record fixity
                 GATE 2 (quality): operator records QualityAssessment; only 'sound' proceeds; re-verify sourceFileChecksum
                 select master (fidelity probe) → explode PDF | fetch image-set + explode
                 produce page-masters (page-to-leaf invariant) + verify count == approvedLeafRange (else throw)
                 upload page-masters + repository-source PDF to B2  [SKIPPED when ctx.dryRun]
                 → AcquisitionResult { assets, metadataSnapshot, complete, reconciliationRequired: true }
reconcile      → status → archived; coverage reflects the held work
```

Idempotency (INV-E): re-`acquire` detects already-stored assets by object-store key + verified checksum
(no re-fetch, no duplicate object); a recorded asset whose remote bytes changed → throw, write nothing.

## Object-store key layout

Mirrors the museum layout (`archive/museum/new-italy-museum/<accession>/…`):

```text
archive/internet-archive/<item-id>/source/<sha256>.pdf              # repository-source
archive/internet-archive/<item-id>/pages/<logicalPage>-<sha256>.jpg # page-master (one per approved page)
```

## Validation rules (test targets)

- `resolve` throws on: non-existent item, non-`texts` mediatype, ambiguous equally-eligible PDFs,
  OCR-only-PDF-when-a-page-image-PDF-exists, encrypted/restricted file (FR-002/003 / INV-A / SC-006).
- `collectRightsEvidence` returns `rightsRaw` = `possible-copyright-status` + grounded date/creator, sets
  no `rightsStatus` (FR-004).
- `acquire` throws before any fetch unless `public-domain` (FR-005 / INV-B / SC-004).
- Quality gate `unsound` → zero B2 bytes, no status advance (FR-008 / SC-002).
- Fidelity: median ratio < 0.90 → image-set fetched + used; ≥ 0.90 → PDF exploded (FR-009 / SC-... research D-4).
- Page-to-leaf: single-page-covering-raster-object → `pdfimages-lossless`; else `pdftoppm` at native/400 DPI;
  produced count == approved range or throw (FR-010 / SC-005).
- `excludedLeaves` absent from page-masters, present in the retained PDF, recorded (FR-011 / SC-003).
- `dryRun` → no B2 write, staging retained, no re-fetch on the following real run (D-11; fixes TASK-29 for IA).
