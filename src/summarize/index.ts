/**
 * summarize module: LLM-powered two-depth summaries (thorough + concise)
 * for issues and sources.
 *
 * Mirrors the shipped OCR and translation pipelines: reads best-available
 * acquired text (English OCR; French OCR + translation), calls the
 * SummarizationRunner (shelled `claude` CLI adapter), writes both artifacts
 * + provenance sidecars via storeAsset (Constitution XV weld), supports
 * idempotency keyed to input-layer hashes, and generates per-source rollups.
 *
 * Phase 1 implementation adds module skeleton + CLI registration.
 * Phase 2+ adds engine seam, provenance extension, and per-story logic.
 */

export type {
  StructuredSummaryFields,
  SummaryResult,
  SummarizationRunner,
  SummarizerName,
} from './types';
export type { SummarizerBundle } from './factory';
export { createSummarizer } from './factory';
export type { SummaryConfig } from './config';
export {
  DEFAULT_SUMMARY_MODEL,
  resolveSummaryModel,
  resolveSummarizerName,
} from './config';
export { createClaudeSummarizer } from './runner-claude';
