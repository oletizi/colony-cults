/**
 * The English-path edition-level OCR-transcription disclosure (spec 015,
 * FR-009/FR-013) -- extracted from `@/pdf/load/archive-edition` (AUDIT-19) to
 * keep that file under the project's 500-line cap once its provenance-read
 * consolidation was folded in. Purely derived from ALREADY-READ folio
 * provenance (never reads a sidecar itself); the caller
 * (`ArchiveEditionReader.build()`) is responsible for reading each folio's
 * provenance sidecar ONCE and threading the array in here.
 */

import type { ProvenanceFields } from '@/archive/provenance';
import type { OcrTranscription } from '@/pdf/model';

/**
 * The OCR pipeline's fixed engine (`@/ocr/preflight` requires `tesseract`;
 * the archive's provenance schema has no per-page OCR-engine field -- every
 * OCR-text artifact in this archive was produced by this one pipeline tool).
 */
const OCR_ENGINE = 'tesseract 5';

/** A non-empty trimmed value, or throw naming the field + context. */
function requireNonEmpty(value: string, label: string, context: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${context}: ${label} is empty -- ${label} is required.`);
  }
  return value;
}

/**
 * One folio's OCR-condition severity, worst-first: a `failed` `ocr_status`
 * outranks any sub-`high` quality tier, which in turn outranks a clean
 * (`high`-tier or unscored) folio. Higher `severity` is worse.
 */
interface OcrSeverity {
  severity: 0 | 1 | 2 | 3;
  /** The caveat text this folio alone would contribute, or `null` if clean. */
  caveat: string | null;
}

/**
 * Rank one folio's provenance on the OCR-condition severity scale (AUDIT-
 * 20260719-01): `failed` (3) worst, then `quality.tier` `low` (2) / `medium`
 * (1), then clean (`high`-tier or unscored quality, 0) -- no caveat.
 */
function ocrSeverityOf(provenance: ProvenanceFields): OcrSeverity {
  if (provenance.ocr_status === 'failed') {
    return { severity: 3, caveat: 'status: failed' };
  }
  const tier = provenance.ocr_quality?.tier;
  if (tier === 'low') {
    return { severity: 2, caveat: 'quality: low' };
  }
  if (tier === 'medium') {
    return { severity: 1, caveat: 'quality: medium' };
  }
  return { severity: 0, caveat: null };
}

/**
 * The two derived, all-folios-aware pieces of the edition-level OCR-
 * transcription disclosure (spec 015 FR-009/FR-013): the WORST OCR condition
 * across every folio (the caveat) and a REPRESENTATIVE folio's `ocr_status`
 * (the engine-status component). Computed together off ONE shared read of
 * every folio's provenance sidecar (see {@link deriveOcrDisclosureAggregate}).
 */
export interface OcrDisclosureAggregate {
  worstCaveat: string | null;
  representativeStatus: string;
}

/**
 * Derive both all-folios-aware pieces of the OCR-transcription disclosure
 * from `provenances` -- every one of the unit's folios' provenance sidecars,
 * already read ONCE by the caller (AUDIT-19, `ArchiveEditionReader.build()`
 * via `resolveLeadAndAggregateProvenances`) and threaded in here rather than
 * re-read:
 *
 *  - `worstCaveat` (spec 015 FR-009; fixes AUDIT-20260719-01, HIGH; fixes
 *    AUDIT-20260719-13, HIGH): the WORST OCR condition across ALL of the
 *    unit's NON-`blank_recto` folios, not just the lead folio -- a lead
 *    folio that is clean must NOT suppress a disclosure that a LATER folio
 *    is sub-`high` or `ocr_status: failed` (Constitution I/III, evidence
 *    honesty). `blank_recto`-marked folios are SKIPPED here, exactly as they
 *    already are for `representativeStatus` below: an intentionally-blank
 *    cover/plate carries no English OCR, so whatever `ocr_status`/
 *    `ocr_quality` its sidecar happens to record (a plausible `failed` or
 *    `low` when the pipeline still runs OCR over a blank page) must never
 *    leak into the edition-level caveat as though it described the real OCR
 *    content -- the AUDIT-09 fix guarded only `representativeStatus`,
 *    leaving this sibling channel to poison the colophon's oxblood caveat
 *    with a blank plate's meaningless status. Both aggregations now apply
 *    the SAME `blank_recto !== true` filter -- one consistent rule.
 *  - `representativeStatus` (fixes AUDIT-20260719-09, HIGH): the FIRST
 *    folio's `ocr_status` that is NOT `blank_recto`-marked. T015's
 *    blank/plate opt-out (FR-014) lets an English edition's lead folio
 *    legitimately be an intentionally-blank cover/plate, whose OWN
 *    `ocr_status` (e.g. `none`) is unrepresentative of the edition even
 *    though later folios carry the real English OCR -- the lead folio's raw
 *    status must never leak into the edition-level disclosure as though it
 *    were representative. Fails loud (naming the context), WITHOUT
 *    fabricating a status, only in the degenerate case where every folio in
 *    the unit is `blank_recto`-marked (no folio has a usable status to
 *    disclose).
 *
 * Derives off already-read provenance (not the per-page
 * `ArchivePageContent.ocrCondition` apparatus-note string, whose free-text
 * format does not preserve the severity ordering needed to pick a worst).
 * The caller's shared read already fails loud, naming the sidecar path (via
 * `readProvenance`), on any folio whose sidecar is missing or malformed --
 * no folio is silently skipped from the aggregation.
 */
export function deriveOcrDisclosureAggregate(
  provenances: readonly ProvenanceFields[],
  context: string,
): OcrDisclosureAggregate {
  let worst: OcrSeverity = { severity: 0, caveat: null };
  for (const provenance of provenances) {
    // Skip blank_recto-marked folios (AUDIT-20260719-13): an intentionally-
    // blank cover/plate's own ocr_status/ocr_quality must never leak into the
    // edition-level caveat -- same filter as `representativeStatus` below.
    if (provenance.blank_recto === true) {
      continue;
    }
    const candidate = ocrSeverityOf(provenance);
    if (candidate.severity > worst.severity) {
      worst = candidate;
    }
  }

  const representative = provenances.find((provenance) => provenance.blank_recto !== true);
  if (representative === undefined) {
    throw new Error(
      `${context}: every folio is blank_recto-marked -- no folio has a usable ` +
        `OCR status to disclose as the edition's engineStatus.`,
    );
  }

  return {
    worstCaveat: worst.caveat,
    representativeStatus: requireNonEmpty(representative.ocr_status, 'ocr_status', context),
  };
}

/**
 * Build the English-path OCR-transcription disclosure (spec 015, FR-013):
 * `engineStatus` composes the pipeline's fixed OCR engine with a
 * REPRESENTATIVE (non-`blank_recto`) folio's recorded `ocr_status` (e.g.
 * `tesseract 5 (searchable)`) -- NEVER the raw lead folio's status alone,
 * which can be an intentionally-blank cover/plate's unrepresentative status
 * (AUDIT-20260719-09). `caveat` is the pre-computed worst-across-all-folios
 * condition (AUDIT-20260719-01). Both pieces come from the same
 * {@link deriveOcrDisclosureAggregate} read.
 */
export function buildOcrTranscription(aggregate: OcrDisclosureAggregate): OcrTranscription {
  return {
    engineStatus: `${OCR_ENGINE} (${aggregate.representativeStatus})`,
    caveat: aggregate.worstCaveat,
  };
}
