/**
 * `extractPages` -- turn an operator-approved leaf range of a source PDF into
 * per-page image masters under the STRICT page-to-leaf invariant
 * (specs/013-archiveorg-acquisition-path § acquire step 5, IA-INV-D, FR-010 /
 * SC-005).
 *
 * For each leaf in the approved range the module inspects that leaf's page in a
 * single `pdfimages -list` reading (via the injected {@link PopplerRunner}) and
 * routes it:
 *
 *   - **`pdfimages`-lossless** IFF the page has EXACTLY ONE raster image object
 *     AND that object covers the page (its pixel dimensions are ≈ the recorded
 *     scan dimensions for the leaf -- see {@link coversPage}). The extracted
 *     image object id is recorded as `sourcePdfObject`.
 *   - **`pdftoppm`-rasterise** otherwise (zero images, multiple images, or a
 *     single image that does not cover the page / an overlay is present), at the
 *     scan's native DPI derived from the recorded scan dimensions, or the
 *     documented 400-DPI fallback when no dimensions are available. The DPI is
 *     recorded as `resolutionDpi`.
 *
 * COUNT INVARIANT (fail loud, SC-005): the produced page-master count MUST equal
 * the number of leaves in the approved range. A leaf inside the range that is
 * also flagged as an excluded type is a contradiction (it can be neither a
 * reading master nor an in-range hole) -- it is not emitted, which trips this
 * invariant and throws rather than storing a partial / misaligned set.
 *
 * Excluded leaves (leaves in `excludedLeafTypes` OUTSIDE the approved range, e.g.
 * Cover / Color Card / scanner notices) are omitted from the page-masters,
 * RETAINED in the preserved source PDF, and recorded in `excludedLeaves` with a
 * classification + reason that NEVER says "discarded" (FR-011 / IA-INV-F).
 *
 * Fail-loud, no fabrication (Principle V): an invalid range throws; the count
 * invariant throws; no default/partial result is ever returned. Poppler is
 * injected (Principle VI) so tests drive a fake -- this module never spawns a
 * process itself.
 */

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { PageImageInfo, PopplerRunner } from '@/pdf/poppler/runner';
import type {
  ExcludedLeaf,
  LeafRange,
  PageMethodProvenance,
} from '@/model/quality-assessment';
import type { ScandataLeaf } from '@/repository/internet-archive/scandata';

/** One produced page-master, with its source leaf, reading order, and provenance. */
export interface ExtractedPage {
  /** 1-based source-PDF leaf this master was produced from. */
  leaf: number;
  /** Reading order within the approved range (1..N == `AcquiredAsset.sequence`). */
  logicalPage: number;
  /** The output prefix handed to poppler; poppler appends its own suffix/extension. */
  outputPath: string;
  /** How the master was produced + the single method-keyed provenance field. */
  provenance: PageMethodProvenance;
}

/** The outcome of extracting an approved range: the reading masters + the recorded exclusions. */
export interface ExtractionResult {
  /** One master per leaf in the approved range, in reading order. */
  pages: ExtractedPage[];
  /** Out-of-range leaves excluded from the reading masters but retained in the source PDF. */
  excludedLeaves: ExcludedLeaf[];
}

/** Inputs to {@link extractPages}. */
export interface ExtractParams {
  /** Path to the staged source PDF. */
  pdfPath: string;
  /** 1-based inclusive leaves that become reading masters. */
  approvedRange: LeafRange;
  /** Leaf → scandata `pageType` for leaves to exclude (Cover / Color Card / notice / …). */
  excludedLeafTypes?: ReadonlyMap<number, string>;
  /** Scandata leaves, for native-DPI derivation + coverage reference (dims optional per leaf). */
  scanLeaves?: readonly ScandataLeaf[];
  /** Directory the per-page output prefixes are rooted under. */
  outDir: string;
  /** Injected poppler wrapper (tests inject a fake; the real impl composes `execCommand`). */
  poppler: PopplerRunner;
}

/**
 * Fallback rasterise resolution when no scan dimensions are available for a leaf
 * (research D-5). A defensible mid-range book-scan DPI.
 */
const DEFAULT_RASTER_DPI = 400;

/**
 * Nominal physical longest edge (inches) assumed when deriving a native DPI from
 * the recorded scan pixel dimensions: `dpi ≈ longestEdgePx / this`. This module
 * is deliberately given only the scandata dimensions (not the PDF's physical
 * page box), so the derivation is an approximation -- a book leaf's longest edge
 * clusters around this value; the exact page box is consulted at acquire time.
 */
const ASSUMED_PAGE_LONGEST_EDGE_INCHES = 11;

/**
 * Minimum fraction of the recorded scan dimensions a single image must span (in
 * BOTH width and height) to count as "covering the page". A downsampled
 * full-page scan image sits well above this (the fidelity floor is 0.90); a
 * small inset / stamp / overlay sits well below it. 0.5 is the safe midpoint.
 */
const COVERAGE_MIN_RATIO = 0.5;

/** The per-leaf routing decision: exactly one method, carrying exactly one provenance field. */
type PageDecision =
  | { method: 'pdfimages-lossless'; sourcePdfObject: string }
  | { method: 'pdftoppm-rasterised'; resolutionDpi: number };

/** Longest recorded scan edge for a leaf, or `undefined` when no dimension is recorded. */
function scanLongestEdge(dims: ScandataLeaf | undefined): number | undefined {
  if (dims === undefined) {
    return undefined;
  }
  const edges = [dims.width, dims.height].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  );
  return edges.length === 0 ? undefined : Math.max(...edges);
}

/**
 * Native rasterise DPI for a page. PREFERS the actual embedded-image resolution
 * that poppler reports (`pdfimages -list`'s `x-ppi`, the largest across the
 * page's images) -- so a Google-style page whose 600-DPI scan is stored as one
 * image is rasterised at ~600 DPI, not downsampled. This is the authoritative
 * source because it is measured from the image bytes themselves; the recorded
 * `scandata` page size is only a fallback (it can disagree with the embedded
 * image, as the de Groote item's leaf 4 does). Falls back to the scandata-
 * derived DPI, then to {@link DEFAULT_RASTER_DPI}, when no ppi is reported.
 */
function deriveNativeDpi(rows: readonly PageImageInfo[], dims: ScandataLeaf | undefined): number {
  const ppis = rows
    .map((row) => row.xPpi)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  if (ppis.length > 0) {
    return Math.max(...ppis);
  }
  const longest = scanLongestEdge(dims);
  if (longest === undefined) {
    return DEFAULT_RASTER_DPI;
  }
  const dpi = Math.round(longest / ASSUMED_PAGE_LONGEST_EDGE_INCHES);
  return dpi > 0 ? dpi : DEFAULT_RASTER_DPI;
}

/**
 * Whether a single image row covers the page: its width AND height are each at
 * least {@link COVERAGE_MIN_RATIO} of the recorded scan width / height. When no
 * scan dimensions are recorded there is no counter-evidence, so a lone image is
 * presumed to be the full-page image.
 */
function coversPage(image: PageImageInfo, dims: ScandataLeaf | undefined): boolean {
  if (dims === undefined || dims.width === undefined || dims.height === undefined) {
    return true;
  }
  const widthRatio = image.width / dims.width;
  const heightRatio = image.height / dims.height;
  return Math.min(widthRatio, heightRatio) >= COVERAGE_MIN_RATIO;
}

/**
 * Route a leaf: lossless IFF exactly one page-covering image object, else
 * rasterise at the leaf's native (or fallback) DPI.
 */
function decideMethod(rows: PageImageInfo[], dims: ScandataLeaf | undefined): PageDecision {
  if (rows.length === 1 && coversPage(rows[0], dims)) {
    return { method: 'pdfimages-lossless', sourcePdfObject: rows[0].objectId };
  }
  return { method: 'pdftoppm-rasterised', resolutionDpi: deriveNativeDpi(rows, dims) };
}

/** Map a scandata `pageType` to the closed {@link ExcludedLeaf} classification vocabulary. */
function classify(pageType: string): ExcludedLeaf['classification'] {
  const normalized = pageType.trim().toLowerCase();
  if (normalized === 'cover') {
    return 'cover';
  }
  if (normalized === 'color card') {
    return 'color-card';
  }
  if (normalized === 'blank') {
    return 'blank';
  }
  if (normalized.includes('notice') || normalized.includes('scanner')) {
    return 'scanner-notice';
  }
  return 'other';
}

/** Deterministic output prefix for a logical page under `outDir`. */
function outputPrefix(outDir: string, logicalPage: number): string {
  return join(outDir, `page-${String(logicalPage).padStart(4, '0')}`);
}

/**
 * Produce per-page reading masters for `approvedRange` under the strict
 * page-to-leaf invariant. See the module header for the routing + count rules.
 */
export async function extractPages(params: ExtractParams): Promise<ExtractionResult> {
  const { pdfPath, approvedRange, excludedLeafTypes, scanLeaves, outDir, poppler } = params;
  const { start, end } = approvedRange;

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new Error(
      `extractPages: invalid approved leaf range {start:${start}, end:${end}} -- ` +
        'expected 1-based integers with start <= end.',
    );
  }

  // Produce into a CLEAN output directory. The poppler writers append their own
  // suffix (`page-0001-000.png`), so a stale master left from an earlier run at a
  // DIFFERENT approved range (whose leaf->logicalPage mapping differs) would leave
  // a second `page-0001-*.png` and make the caller's produced-file resolution
  // ambiguous. Masters are cheap, deterministic re-derivations of the cached PDF,
  // so clearing + recreating outDir each run is correct (it does NOT re-download).
  // The poppler writers also do not create outDir themselves (a missing dir makes
  // them exit "Could not write image"), so the mkdir is required regardless.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // Index scandata dims by leaf number for coverage + native-DPI lookup.
  const dimsByLeaf = new Map<number, ScandataLeaf>();
  for (const leaf of scanLeaves ?? []) {
    dimsByLeaf.set(leaf.leafNum, leaf);
  }

  // One `pdfimages -list` reading for the whole document; index rows by page.
  const rowsByPage = new Map<number, PageImageInfo[]>();
  for (const row of await poppler.imagesList(pdfPath)) {
    const existing = rowsByPage.get(row.page);
    if (existing === undefined) {
      rowsByPage.set(row.page, [row]);
    } else {
      existing.push(row);
    }
  }

  const expectedCount = end - start + 1;
  const pages: ExtractedPage[] = [];
  const skippedInRange: number[] = [];

  let logicalPage = 0;
  for (let leaf = start; leaf <= end; leaf += 1) {
    // A leaf flagged as an excluded type MUST NOT appear in the masters
    // (FR-011). Inside the approved range that is a contradiction -- record it
    // as skipped so the count invariant below fails loud.
    if (excludedLeafTypes?.has(leaf)) {
      skippedInRange.push(leaf);
      continue;
    }

    logicalPage += 1;
    const dims = dimsByLeaf.get(leaf);
    const rows = rowsByPage.get(leaf) ?? [];
    const decision = decideMethod(rows, dims);
    const prefix = outputPrefix(outDir, logicalPage);

    const provenance: PageMethodProvenance =
      decision.method === 'pdfimages-lossless'
        ? {
            leaf,
            logicalPage,
            method: 'pdfimages-lossless',
            sourcePdfObject: decision.sourcePdfObject,
          }
        : {
            leaf,
            logicalPage,
            method: 'pdftoppm-rasterised',
            resolutionDpi: decision.resolutionDpi,
          };

    if (decision.method === 'pdfimages-lossless') {
      await poppler.extractImage(pdfPath, leaf, prefix);
    } else {
      await poppler.rasterise(pdfPath, leaf, decision.resolutionDpi, prefix);
    }

    pages.push({ leaf, logicalPage, outputPath: prefix, provenance });
  }

  if (pages.length !== expectedCount) {
    throw new Error(
      `extractPages: page-to-leaf invariant violated -- approved range ` +
        `{start:${start}, end:${end}} demands ${expectedCount} page-master(s) but produced ` +
        `${pages.length}. Leaves inside the range flagged as excluded types cannot be reading ` +
        `masters: [${skippedInRange.join(', ')}]. Refusing to store a misaligned set (SC-005).`,
    );
  }

  // Excluded leaves = flagged types OUTSIDE the approved range (retained in the
  // preserved source PDF, never discarded -- FR-011 / IA-INV-F).
  const excludedLeaves: ExcludedLeaf[] = [];
  for (const [leaf, pageType] of excludedLeafTypes ?? new Map<number, string>()) {
    if (leaf < start || leaf > end) {
      excludedLeaves.push({
        leaf,
        classification: classify(pageType),
        reason:
          `Excluded from the reading masters (leaf ${leaf}, pageType "${pageType}"); ` +
          'retained in the preserved repository-source PDF.',
      });
    }
  }
  excludedLeaves.sort((a, b) => a.leaf - b.leaf);

  return { pages, excludedLeaves };
}
