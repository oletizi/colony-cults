/**
 * `assessFidelity` -- the dimension-ratio fidelity probe (FR-009, research
 * § D-4) that decides, from measured evidence, whether the archive's derived
 * PDF is faithful enough to EXPLODE, or is materially downsampled and the
 * full-resolution image set must be FETCHED instead.
 *
 * The rule (research § D-4, implemented exactly):
 *   - For a spread sample of approved pages, let `pdfEdge` be the longest-edge
 *     pixels of that page's extracted image (from `PopplerRunner.imagesList`:
 *     `max(width, height)` for the page's image) and `scanEdge` the recorded
 *     longest-edge for the same leaf from `scandata.xml`
 *     (`max(originalWidth, originalHeight)`). Ratio `r = pdfEdge / scanEdge`.
 *   - Take the MEDIAN `r` across the sample. Sample = `min(10, N)` pages spread
 *     evenly across the leaf range (Google PDFs downsample uniformly, so a
 *     spread sample is robust and cheap).
 *   - median `r < 0.90` -> PDF is materially degraded -> fetch the image set.
 *     median `r >= 0.90` -> explode the PDF.
 *
 * FAIL LOUD (Principle V, no fabrication): an invalid leaf range, or a sample
 * with no usable (pdf-image, scandata-dimension) overlap, throws a descriptive
 * Error rather than guessing a ratio. The probe reads dimensions only -- it
 * never extracts, rasterises, or downloads; it returns a decision the caller
 * acts on.
 *
 * @see specs/013-archiveorg-acquisition-path/research.md -- § D-4
 */

import type { PopplerRunner } from '@/pdf/poppler/runner';
import type { LeafRange } from '@/model/quality-assessment';
import type { ScandataLeaf } from '@/repository/internet-archive/scandata';

/**
 * The median longest-edge ratio at or above which the derived PDF is treated
 * as faithful and exploded; below it the PDF is materially degraded and the
 * full-resolution image set is fetched instead.
 *
 * A 10% linear shortfall is ~19% pixel-area loss -- a visible
 * legibility/deep-zoom/OCR drop. Set to 0.90 per research § D-4 (confirmed or
 * adjusted on the de Groote acquisition, SC-001, at first acquire).
 */
export const FIDELITY_MIN_RATIO = 0.9;

/** The maximum number of pages the probe samples across the leaf range (research § D-4). */
export const FIDELITY_SAMPLE_SIZE = 10;

/** The measured fidelity verdict for a staged repository PDF. */
export interface FidelityDecision {
  /** `'pdf'` -> explode the derived PDF; `'image-set'` -> fetch the full-resolution image set. */
  source: 'pdf' | 'image-set';
  /** The median longest-edge ratio `pdfEdge / scanEdge` across the usable sample. */
  medianRatio: number;
  /** The number of sampled pages that yielded a usable ratio (contributed to the median). */
  sampledPages: number;
}

/**
 * Choose the sampled leaf numbers: `min(FIDELITY_SAMPLE_SIZE, N)` leaves spread
 * evenly across `[range.start, range.end]` (1-based inclusive), always
 * including both endpoints. Because the spacing `(N-1)/(size-1)` is >= 1 when
 * `size <= N`, the rounded indices are strictly increasing -- no duplicates.
 */
function sampleLeafNumbers(range: LeafRange): number[] {
  const n = range.end - range.start + 1;
  const size = Math.min(FIDELITY_SAMPLE_SIZE, n);
  if (size === 1) {
    return [range.start];
  }
  const sampled: number[] = [];
  for (let k = 0; k < size; k++) {
    const offset = Math.round((k * (n - 1)) / (size - 1));
    sampled.push(range.start + offset);
  }
  return sampled;
}

/** The median of a non-empty list: middle value (odd count) or mean of the two middle values (even). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The largest defined dimension of a scandata leaf, or `undefined` when neither is recorded. */
function scandataLongestEdge(leaf: ScandataLeaf): number | undefined {
  if (leaf.width === undefined && leaf.height === undefined) {
    return undefined;
  }
  return Math.max(leaf.width ?? 0, leaf.height ?? 0);
}

/**
 * Assess whether the staged repository PDF is faithful enough to explode, or
 * must be replaced by the full-resolution image set (FR-009 / research § D-4).
 *
 * Page <-> leaf mapping assumption: PDF page number N corresponds to scandata
 * leaf number N (1-based, positional, in leaf order). This holds for the
 * "Image Container PDF" shape the archive produces for Google scans -- every
 * leaf yields exactly one PDF page, emitted in leaf order -- which is the only
 * shape this probe is applied to. A future non-positional item would need an
 * explicit page<->leaf map; that is out of scope here and would surface as a
 * "no usable overlap" throw rather than a silently wrong ratio.
 */
export async function assessFidelity(params: {
  /** Path to the staged PDF (already fetched to staging in acquire step 1). */
  pdfPath: string;
  /** Recorded scan dimensions per leaf, parsed from `scandata.xml`. */
  scanLeaves: readonly ScandataLeaf[];
  /** The operator-approved leaf range to sample within (1-based inclusive). */
  leafRange: LeafRange;
  /** Injected poppler wrapper; only `imagesList` is used (no extraction). */
  poppler: PopplerRunner;
}): Promise<FidelityDecision> {
  const { pdfPath, scanLeaves, leafRange, poppler } = params;

  if (
    !Number.isInteger(leafRange.start) ||
    !Number.isInteger(leafRange.end) ||
    leafRange.start < 1 ||
    leafRange.end < leafRange.start
  ) {
    throw new Error(
      `assessFidelity: invalid leafRange {start: ${leafRange.start}, end: ${leafRange.end}} -- ` +
        'expected 1-based integers with start <= end.',
    );
  }

  const images = await poppler.imagesList(pdfPath);

  // page -> the largest longest-edge among that page's image objects. An
  // Image Container PDF has one image per page; taking the max is robust to
  // pages that (unexpectedly) carry more than one image object.
  const pdfEdgeByPage = new Map<number, number>();
  for (const image of images) {
    const edge = Math.max(image.width, image.height);
    const previous = pdfEdgeByPage.get(image.page);
    if (previous === undefined || edge > previous) {
      pdfEdgeByPage.set(image.page, edge);
    }
  }

  // leaf number -> recorded scan longest-edge (only leaves that recorded one).
  const scanEdgeByLeaf = new Map<number, number>();
  for (const leaf of scanLeaves) {
    const edge = scandataLongestEdge(leaf);
    if (edge !== undefined && edge > 0) {
      scanEdgeByLeaf.set(leaf.leafNum, edge);
    }
  }

  const ratios: number[] = [];
  for (const leafNum of sampleLeafNumbers(leafRange)) {
    const pdfEdge = pdfEdgeByPage.get(leafNum); // page N <-> leaf N
    const scanEdge = scanEdgeByLeaf.get(leafNum);
    if (pdfEdge === undefined || scanEdge === undefined) {
      continue;
    }
    ratios.push(pdfEdge / scanEdge);
  }

  if (ratios.length === 0) {
    throw new Error(
      `assessFidelity: no usable overlap for "${pdfPath}" across leaf range ` +
        `${leafRange.start}-${leafRange.end} -- the sampled leaves had no matching PDF image ` +
        'and recorded scan dimension pair. Refusing to guess a fidelity ratio.',
    );
  }

  const medianRatio = median(ratios);
  return {
    source: medianRatio >= FIDELITY_MIN_RATIO ? 'pdf' : 'image-set',
    medianRatio,
    sampledPages: ratios.length,
  };
}
