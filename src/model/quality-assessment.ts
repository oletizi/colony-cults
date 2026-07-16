/**
 * Durable operator judgment recorded against a staged source file, canonical
 * provenance (not session state). Only `status: 'sound'` lets `acquire`
 * proceed (FR-008 / SC-002); `acquire` re-verifies the staged file's sha256
 * equals `sourceFileChecksum` before acting — a mismatch throws (FR-008 edge
 * case).
 *
 * See specs/013-archiveorg-acquisition-path/data-model.md § QualityAssessment.
 */
export interface QualityAssessment {
  /** Whether the staged source file is fit to proceed; only `'sound'` unblocks `acquire`. */
  status: 'sound' | 'unsound';
  /** Judgment is always human-made; no automated classifier assesses quality. */
  assessedBy: 'operator';
  /** ISO-8601 timestamp of the judgment. */
  assessedAt: string;
  /** sha256 (lowercase hex) of the staged PDF the judgment was made against. */
  sourceFileChecksum: string;
  /** Expected page count, from the catalogue/extent. */
  expectedPageCount: number;
  /** Observed page count, from the staged PDF (pdfinfo). */
  observedPageCount: number;
  /** The leaf range the operator approved for extraction (1-based, inclusive). */
  approvedLeafRange: LeafRange;
  /** Free-text operator notes. */
  notes?: string;
}

/** 1-based, inclusive leaf range within a source PDF. */
export interface LeafRange {
  start: number;
  end: number;
}

/**
 * A leaf excluded from the `page-master` reading assets. Excluded leaves are
 * **retained** in the preserved `repository-source` PDF — `reason` describes
 * why the leaf is excluded from the reading assets, never that it was
 * discarded, since the source PDF still holds it (FR-011).
 *
 * See specs/013-archiveorg-acquisition-path/data-model.md § ExcludedLeaf.
 */
export interface ExcludedLeaf {
  /** 1-based leaf index in the source PDF. */
  leaf: number;
  /** Why the leaf is excluded from the reading assets. */
  classification: 'scanner-notice' | 'cover' | 'color-card' | 'blank' | 'other';
  /** Explanation; never "discarded" — the source PDF retains the leaf. */
  reason: string;
}

/**
 * Per-page method provenance, recorded on each `page-master` asset's
 * provenance record. Exactly one of `sourcePdfObject` / `resolutionDpi` is
 * set, keyed by `method`: `pdfimages-lossless` carries `sourcePdfObject` (the
 * extracted image object id), `pdftoppm-rasterised` carries `resolutionDpi`
 * (the DPI used to rasterise the page).
 *
 * See specs/013-archiveorg-acquisition-path/data-model.md § Per-page method provenance.
 */
export interface PageMethodProvenance {
  /** Source-PDF leaf index. */
  leaf: number;
  /** Reading order (== `AcquiredAsset.sequence`). */
  logicalPage: number;
  /** How the page-master image was produced from the source PDF. */
  method: 'pdfimages-lossless' | 'pdftoppm-rasterised';
  /** Set when `method` is `pdfimages-lossless`: the extracted image object id. */
  sourcePdfObject?: string;
  /** Set when `method` is `pdftoppm-rasterised`: the DPI used to rasterise the page. */
  resolutionDpi?: number;
}
