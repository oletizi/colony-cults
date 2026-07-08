import type { Asset } from '@/model/asset';
import type { Rights } from '@/model/rights';

/**
 * Per-asset JSON sidecar written next to the asset
 * (`<asset>.provenance.json`).
 *
 * See specs/001-gallica-fetcher/data-model.md § Provenance record.
 */
export interface Provenance {
  /** The described asset. */
  asset: Asset;
  /** Retrieval timestamp (ISO). */
  retrievedAt: string;
  /** Owning source ID, e.g. `PB-P001`. */
  sourceId: string;
  /** Owning issue ark. */
  issueArk: string;
  /** OCR outcome for the asset. */
  ocrStatus: 'none' | 'searchable' | 'failed';
  /** Includes `rawResponse` (raw OAIRecord) — FR-005. */
  rights: Rights;
  /** Producing tool, e.g. `gallica-fetcher@<version>`. */
  tool: string;
}
