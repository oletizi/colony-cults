# Contract: InternetArchiveAdapter

**Feature**: `specs/013-archiveorg-acquisition-path`

Implements the authoritative `RepositoryAdapter` interface — see
[`../../011-museum-acquisition-path/contracts/repository-adapter.md`](../../011-museum-acquisition-path/contracts/repository-adapter.md)
and `src/repository/adapter.ts` (the shipped source of truth). This file specifies **only the
IA-specific behavior + invariants**; it does not restate the interface. Composition + constructor DI
(Principle VI), mirroring `NewItalyMuseumAdapter`.

```ts
readonly repository = 'internet-archive';

export interface InternetArchiveAdapterDeps {
  client: ArchiveHttpClient;      // { getText(url): Promise<string>; getBytes(url): Promise<Uint8Array> }
                                  //   structurally satisfied by @/gallica/http-client HttpClient (Principle XII)
  poppler: PopplerRunner;         // { imagesList(pdf); extractImage(pdf,page,out); rasterise(pdf,page,dpi,out); info(pdf) }
                                  //   real impl composes @/ocr/exec execCommand; tests inject a fake
  objectStore?: ObjectStore;      // optional — resolve/inventory need no B2; acquire requires it
  qualityGate: QualityGate;       // operator judgment surface (records QualityAssessment); injected so tests drive it
  stagingRoot: string;            // COLONY_ARCHIVE_ROOT scratch subdir
  now?: () => string;             // injected clock (ISO-8601)
}
```

## `resolve(locator, ctx)` — verify + deterministic file selection

- `locator.value` = the archive.org item id (operator-supplied; discovery is a separate seam, FR-014).
- Fetch `https://archive.org/metadata/<id>` via `client.getText`. Throw if the item does not exist or
  `metadata.mediatype !== 'texts'` (INV-A / FR-002). **Never fabricate an id.**
- Select files deterministically from `files[]` (FR-003 / INV-A / SC-006):
  - **PDF**: prefer the primary page-image PDF (`Image Container PDF` / `Text PDF`). Reject an OCR-only
    PDF when a page-image PDF exists; reject encrypted/restricted files. **Fail loud** on ≥2 equally-
    eligible page-image PDFs (no guessing).
  - **scandata**: the `Scandata` file (`<id>_scandata.xml`), when present (absent → range seed
    unavailable; operator selects the range manually — the seed never decides regardless).
  - **image set** (for the fidelity fallback): `<id>_jp2.zip` **or** `<id>_tif.zip` (the de Groote item
    exposes `_tif.zip`). Recorded but not fetched here.
- Return `ResolvedRepositoryItem` with `identifiers: [{ type: 'ia-item', value: id }]`,
  `title` = `metadata.title` (mechanical, non-empty), `sourceUrl` = `https://archive.org/details/<id>`,
  `assetLocators` = the selected file URLs, `metadata` grounded from the item metadata.

## `collectRightsEvidence(item)` — propose, never decide (FR-004)

- Return `RightsEvidence { rightsRaw: metadata['possible-copyright-status'], date: grounded(metadata.date),
  creator: grounded(metadata.creator), publicationStatus?, repositoryPolicy? }`.
- **Sets no `rightsStatus`.** Any repository/scanner notice (e.g. Google's "for non-commercial use") is
  preserved verbatim in `rightsRaw`/an evidence field and is **never declared legally void** (FR-006).

## `acquire(record, ctx)` — fail-closed, frugal, page-to-leaf

Ordered steps (any earlier gate failing writes nothing shared):

1. **Rights gate** (INV-B / FR-005 / SC-004): throw unless
   `record.rightsAssessment?.rightsStatus === 'public-domain'` — **before any image fetch**.
2. **Fetch PDF → staging** under `stagingRoot` via `client.getBytes` (one download; nothing shared).
   Record fixity (byteLength, sha256 via `@/archive/checksum`).
3. **Quality gate** (FR-008 / SC-002): obtain the operator `QualityAssessment` via `qualityGate`.
   Re-verify the staged PDF sha256 == `qualityAssessment.sourceFileChecksum` (throw on mismatch). Only
   `status: 'sound'` proceeds; `unsound` → **zero B2 bytes**, no status advance, staging retained.
3a. Compute `observedPageCount` via `poppler.info`; surface expected-vs-observed in the assessment.
4. **Select master source** (FR-009 / research D-4): fidelity probe — `poppler.imagesList` longest-edge
   pixels vs `scandata` recorded dimensions over a spread sample; median ratio `< 0.90` → fetch the
   image set (`_jp2.zip`/`_tif.zip`) via `client.getBytes` and use it; `≥ 0.90` → explode the PDF.
   Record which master source was used.
5. **Produce page-masters** (FR-010 / SC-005) under the strict page-to-leaf invariant: per approved
   logical page, `pdfimages`-lossless iff exactly one page-covering raster object and no overlay, else
   `pdftoppm` at native DPI (from scandata; fallback 400). Verify produced count == `approvedLeafRange`
   or **throw**. Attach `PageMethodProvenance` per master.
6. **Excluded leaves** (FR-011): omit from page-masters, keep in the source PDF, record `excludedLeaves`.
7. **Upload** to B2 (unless `ctx.dryRun`): N `page-master` assets + 1 `repository-source` PDF asset, at
   the `archive/internet-archive/<id>/…` key layout. Idempotency (INV-E): skip an asset already present
   by key + verified checksum; a recorded asset whose remote bytes changed → throw, write nothing for it.
   **`ctx.dryRun` withholds all B2 writes and retains staging** (Principle XII; fixes TASK-29 for IA).
8. On success (non-dry-run), delete staging. Return
   `AcquisitionResult { repositoryRecordId, assets, metadataSnapshot, complete, reconciliationRequired: true }`.

## Invariants (test targets — extend 009/011 INV-A..F)

- **IA-INV-A (no fabrication)**: `resolve` throws on unverifiable/non-`texts` item or ambiguous files; no
  item id or filename invented.
- **IA-INV-B (rights fail-closed)**: `acquire` throws before any fetch unless the record is operator-recorded
  `public-domain`; `collectRightsEvidence` never sets a status.
- **IA-INV-C (quality fail-closed)**: an `unsound` assessment yields zero B2 bytes and no status advance;
  `acquire` re-verifies the staged checksum before acting.
- **IA-INV-D (page-to-leaf)**: produced page-master count == approved leaf range or throw; each master
  records its extraction method + leaf/logicalPage.
- **IA-INV-E (frugal source)**: the image-set zip is fetched **only** when the fidelity rule fails; access
  is via the injected polite client, never ad-hoc curl; `dryRun` performs no B2 write and no re-fetch on
  the following real run.
- **IA-INV-F (preserve + record)**: exactly one `repository-source` PDF asset is preserved; excluded leaves
  are recorded and retained in it, never "discarded".
- **IA-INV-G (dispatch)**: the registry routes an `ia-item` record to this adapter and only this adapter
  (INV-D); an `ark`/`accession` acquire never builds it (no IA fetch cost paid).
- **Never `bib migrate`** (INV-F).
