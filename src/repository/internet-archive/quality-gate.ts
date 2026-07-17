/**
 * The IA acquisition path's operator quality-gate SEAM + its fail-closed
 * enforcement (specs/013-archiveorg-acquisition-path, FR-008 / IA-INV-C).
 *
 * `acquire` never decides whether a staged source PDF is fit to proceed --
 * that judgment is always human-made (`QualityAssessment.assessedBy ===
 * 'operator'`). This module defines the seam by which `acquire` obtains that
 * judgment ({@link QualityGate}), the pure helper that enforces it
 * ({@link enforceQualityGate}), and a thin re-export that seeds the proposed
 * range from `scandata.xml` ({@link seedProposedRange}).
 *
 * The wiring of this gate into `acquire` itself (staging the PDF, calling
 * `poppler.info`, invoking `qualityGate.assess`, then calling
 * `enforceQualityGate` before any master-selection work) is T025 -- out of
 * scope here. This module only builds the seam + the two pure/injected
 * units, so they can be tested in isolation before `acquire` wires them in.
 *
 * @see specs/013-archiveorg-acquisition-path/contracts/internet-archive-adapter.md -- acquire step 3, FR-008
 * @see specs/013-archiveorg-acquisition-path/data-model.md -- § QualityAssessment
 * @see specs/013-archiveorg-acquisition-path/research.md -- D-8 (staging + fixity), D-11 (dryRun / fail-closed wiring)
 */

import type { LeafRange, QualityAssessment } from '@/model/quality-assessment';
import { proposeReadingRange, type ScandataLeaf } from '@/repository/internet-archive/scandata';

/**
 * Input `acquire` hands to the quality gate: everything the operator needs
 * to judge the staged file, plus a scandata-seeded {@link LeafRange}
 * proposal the operator confirms or overrides -- the seed never decides.
 */
export interface QualityGateInput {
  /** Path to the staged source PDF (under `stagingRoot`), for operator inspection. */
  pdfPath: string;
  /** sha256 (lowercase hex) of the staged PDF -- becomes `QualityAssessment.sourceFileChecksum`. */
  sourceFileChecksum: string;
  /** Expected page count, from the catalogue/extent. */
  expectedPageCount: number;
  /** Observed page count, from the staged PDF (`poppler.info`). */
  observedPageCount: number;
  /** Reading-range seed from `scandata.xml` (see {@link seedProposedRange}); operator confirms/overrides. */
  proposedRange: LeafRange;
}

/**
 * The seam by which the operator's scan-quality judgment is obtained. The
 * real CLI implementation prompts the operator and records the answer; test
 * doubles return a fixed {@link QualityAssessment}. `acquire` composes this
 * interface via constructor DI (`InternetArchiveAdapterDeps.qualityGate`)
 * and never itself decides soundness -- it only calls `assess` and then
 * enforces the result via {@link enforceQualityGate}.
 */
export interface QualityGate {
  assess(input: QualityGateInput): Promise<QualityAssessment>;
}

/**
 * Fail-closed enforcement of an operator {@link QualityAssessment}
 * (FR-008 / IA-INV-C). Two independent gates, either of which halts
 * acquisition with zero B2 bytes written and no status advance:
 *
 * 1. **Soundness**: only `status: 'sound'` may proceed. `'unsound'` throws --
 *    acquisition halts, nothing is uploaded, staging is retained (D-8).
 * 2. **Checksum re-verification**: the staged file's sha256 (`stagedChecksum`,
 *    recomputed by `acquire` immediately before acting) MUST equal the
 *    checksum the assessment was actually made against
 *    (`assessment.sourceFileChecksum`). A mismatch means the assessed file is
 *    not the staged file -- fail loud rather than act on a judgment that may
 *    no longer apply to the bytes on disk.
 *
 * Returns `void` (no throw) only when both gates pass.
 */
export function enforceQualityGate(assessment: QualityAssessment, stagedChecksum: string): void {
  if (assessment.status !== 'sound') {
    throw new Error(
      `enforceQualityGate: quality assessment status is '${assessment.status}', not 'sound' -- ` +
        'acquisition halts, nothing uploaded, staging retained (FR-008 / IA-INV-C).',
    );
  }

  if (assessment.sourceFileChecksum !== stagedChecksum) {
    throw new Error(
      'enforceQualityGate: staged file checksum does not match the checksum the quality ' +
        `assessment was made against (assessed sha256=${assessment.sourceFileChecksum}, ` +
        `staged sha256=${stagedChecksum}) -- the assessed file is not the staged file; ` +
        'refusing to act on it.',
    );
  }
}

/**
 * Seed the {@link QualityGateInput.proposedRange} from `scandata.xml`.
 *
 * Thin re-export of `@/repository/internet-archive/scandata`'s
 * `proposeReadingRange` -- kept as a distinct named entry point in this
 * module (rather than duplicated logic) so `acquire` and its tests can
 * import the quality-gate seam without reaching into the scandata parser
 * directly.
 *
 * The returned range is the span of `pageType: "Normal"` leaves; it
 * **excludes** leading/trailing front matter (`Cover`, `Title`, `Color
 * Card`, and similar non-content types), since none of those are ever
 * typed `"Normal"`. This is only a proposal -- the operator's
 * `QualityAssessment.approvedLeafRange` may legitimately be wider (e.g. to
 * include a plate or illustration interleaved among content leaves that
 * scandata typed something other than `"Normal"`). The seed never decides
 * that; it only proposes the outer bound of ordinary reading content.
 */
export function seedProposedRange(scanLeaves: readonly ScandataLeaf[]): LeafRange {
  return proposeReadingRange(scanLeaves);
}
