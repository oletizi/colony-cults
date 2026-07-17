/**
 * Tests for {@link extractPages} (`@/repository/internet-archive/extract`) --
 * the T038-T042 per-page extraction module for the Internet Archive
 * acquisition adapter (specs/013-archiveorg-acquisition-path, § acquire step 5,
 * IA-INV-D, FR-010 / SC-005).
 *
 * NO real poppler process is ever spawned: every test injects a FAKE
 * `PopplerRunner`. `imagesList` returns author-controlled `PageImageInfo` rows
 * (single page-covering image vs overlay/multi/inset), and `extractImage` /
 * `rasterise` record the exact `(pdfPath, page, dpi?, outPrefix)` they were
 * handed so the per-leaf routing can be asserted. The row shapes mirror the two
 * synthetic poppler fixtures (`__fixtures__/single-image-page.pdf`,
 * `.../overlay-page.pdf`) exercised by `src/pdf/poppler/runner.test.ts`.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageImageInfo, PopplerRunner } from '@/pdf/poppler/runner';
import type { ScandataLeaf } from '@/repository/internet-archive/scandata';
import { extractPages } from '@/repository/internet-archive/extract';

/** One recorded poppler production call, so the per-leaf routing can be asserted. */
interface RecordedCall {
  fn: 'extractImage' | 'rasterise';
  pdfPath: string;
  page: number;
  dpi?: number;
  outPrefix: string;
}

/**
 * A fake {@link PopplerRunner}: `imagesList` returns the supplied rows (the
 * module indexes them by page itself), `info` returns a fixed page count, and
 * `extractImage` / `rasterise` record their argv and resolve without touching
 * the filesystem. `imagesListCalls` counts invocations so "called once" holds.
 */
function fakePoppler(rows: PageImageInfo[]): {
  poppler: PopplerRunner;
  calls: RecordedCall[];
  imagesListCalls: () => number;
} {
  const calls: RecordedCall[] = [];
  let imagesListInvocations = 0;
  const poppler: PopplerRunner = {
    imagesList(): Promise<PageImageInfo[]> {
      imagesListInvocations += 1;
      return Promise.resolve(rows);
    },
    info(): Promise<{ pages: number }> {
      return Promise.resolve({ pages: rows.length });
    },
    extractImage(pdfPath: string, page: number, outPrefix: string): Promise<void> {
      calls.push({ fn: 'extractImage', pdfPath, page, outPrefix });
      return Promise.resolve();
    },
    rasterise(pdfPath: string, page: number, dpi: number, outPrefix: string): Promise<void> {
      calls.push({ fn: 'rasterise', pdfPath, page, dpi, outPrefix });
      return Promise.resolve();
    },
  };
  return { poppler, calls, imagesListCalls: () => imagesListInvocations };
}

/** A single page-covering image row (image ≈ scan-sized): the lossless path. */
function coveringRow(page: number, objectId: string): PageImageInfo {
  return { page, num: 0, width: 3000, height: 2400, objectId };
}

/** Scandata leaf carrying recorded dimensions (longest edge 3300 → native 300 DPI at 11in). */
function scanLeaf(leafNum: number, pageType = 'Normal'): ScandataLeaf {
  return { leafNum, pageType, width: 2550, height: 3300 };
}

const PDF = '/staging/nouvellefrancec00groogoog.pdf';
// A real writable dir: extractPages now mkdir's its outDir (the poppler writers
// need it to exist), so a fake path like "/staging/pages" no longer works.
const OUT = join(mkdtempSync(join(tmpdir(), 'ia-extract-test-')), 'pages');
afterEach(() => rmSync(OUT, { recursive: true, force: true }));

describe('extractPages -- T038: single page-covering image → pdfimages-lossless', () => {
  it('routes three single-covering leaves to lossless extraction with sourcePdfObject provenance', async () => {
    const rows = [coveringRow(4, '10'), coveringRow(5, '11'), coveringRow(6, '12')];
    const { poppler, calls, imagesListCalls } = fakePoppler(rows);

    const result = await extractPages({
      pdfPath: PDF,
      approvedRange: { start: 4, end: 6 },
      scanLeaves: [scanLeaf(4), scanLeaf(5), scanLeaf(6)],
      outDir: OUT,
      poppler,
    });

    expect(imagesListCalls()).toBe(1); // indexed once, not per-leaf
    expect(result.pages).toHaveLength(3);
    expect(result.excludedLeaves).toEqual([]);

    expect(result.pages.map((p) => [p.leaf, p.logicalPage])).toEqual([
      [4, 1],
      [5, 2],
      [6, 3],
    ]);
    for (const page of result.pages) {
      expect(page.provenance.method).toBe('pdfimages-lossless');
      expect(page.provenance.resolutionDpi).toBeUndefined();
      expect(typeof page.provenance.sourcePdfObject).toBe('string');
    }
    expect(result.pages[0].provenance.sourcePdfObject).toBe('10');
    expect(result.pages[2].provenance.sourcePdfObject).toBe('12');

    // Every leaf went through extractImage (lossless), at the matching page number; no rasterise.
    expect(calls.map((c) => [c.fn, c.page])).toEqual([
      ['extractImage', 4],
      ['extractImage', 5],
      ['extractImage', 6],
    ]);
    expect(calls.every((c) => c.pdfPath === PDF)).toBe(true);
    expect(calls[0].outPrefix).toBe(result.pages[0].outputPath);
  });
});

describe('extractPages -- T039: overlay / multi / inset page → pdftoppm-rasterised', () => {
  it('rasterises a multi-image leaf at native DPI (from scandata) and a zero-image leaf at the 400 fallback', async () => {
    // leaf 4: one covering image → lossless.
    // leaf 5: TWO image rows (overlay / composite) → rasterise; scandata present → native DPI.
    // leaf 6: ZERO image rows (vector/text-only render) → rasterise; NO scandata → 400 fallback.
    const rows: PageImageInfo[] = [
      coveringRow(4, '10'),
      { page: 5, num: 0, width: 1200, height: 1600, objectId: '20' },
      { page: 5, num: 1, width: 400, height: 300, objectId: '21' },
    ];
    const { poppler, calls } = fakePoppler(rows);

    const result = await extractPages({
      pdfPath: PDF,
      approvedRange: { start: 4, end: 6 },
      scanLeaves: [scanLeaf(4), scanLeaf(5)], // leaf 6 deliberately absent → fallback DPI
      outDir: OUT,
      poppler,
    });

    expect(result.pages).toHaveLength(3);

    const [p4, p5, p6] = result.pages;
    expect(p4.provenance.method).toBe('pdfimages-lossless');
    expect(p4.provenance.sourcePdfObject).toBe('10');

    expect(p5.provenance.method).toBe('pdftoppm-rasterised');
    expect(p5.provenance.sourcePdfObject).toBeUndefined();
    expect(p5.provenance.resolutionDpi).toBe(300); // 3300px longest edge / 11in

    expect(p6.provenance.method).toBe('pdftoppm-rasterised');
    expect(p6.provenance.resolutionDpi).toBe(400); // no scandata → documented fallback

    expect(calls.map((c) => [c.fn, c.page, c.dpi])).toEqual([
      ['extractImage', 4, undefined],
      ['rasterise', 5, 300],
      ['rasterise', 6, 400],
    ]);
  });

  it('rasterises a SINGLE but non-page-covering (small inset) image rather than extracting it losslessly', async () => {
    // One image row, but tiny relative to the scandata dimensions (an inset /
    // stamp, not the page) → must NOT be taken as the page master.
    const rows: PageImageInfo[] = [{ page: 7, num: 0, width: 200, height: 260, objectId: '30' }];
    const { poppler, calls } = fakePoppler(rows);

    const result = await extractPages({
      pdfPath: PDF,
      approvedRange: { start: 7, end: 7 },
      scanLeaves: [scanLeaf(7)], // 2550 x 3300 → the 200x260 image covers < 10%
      outDir: OUT,
      poppler,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].provenance.method).toBe('pdftoppm-rasterised');
    expect(result.pages[0].provenance.resolutionDpi).toBe(300);
    expect(calls).toEqual([
      { fn: 'rasterise', pdfPath: PDF, page: 7, dpi: 300, outPrefix: result.pages[0].outputPath },
    ]);
  });
});

describe('extractPages -- rasterise DPI comes from the embedded image resolution, not scandata page size', () => {
  it('rasterises at the largest embedded-image x-ppi (native scan resolution), overriding a misleading scandata page size', async () => {
    // The real de Groote case: a page holds a 600-DPI bitonal scan (3180x5114)
    // PLUS a small color image -> two rows -> rasterise. The scandata page size
    // for that leaf (here a deliberately-misleading small 1010x1438) would derive
    // ~131 DPI and DOWNSAMPLE the 600-DPI scan ~5x. The x-ppi from pdfimages must
    // win so the master is rendered at the scan's true resolution.
    const rows: PageImageInfo[] = [
      { page: 4, num: 0, width: 3180, height: 5114, objectId: '19', xPpi: 600 },
      { page: 4, num: 1, width: 414, height: 566, objectId: '20', xPpi: 150 },
    ];
    const { poppler, calls } = fakePoppler(rows);

    const result = await extractPages({
      pdfPath: PDF,
      approvedRange: { start: 4, end: 4 },
      scanLeaves: [{ leafNum: 4, pageType: 'Normal', width: 1010, height: 1438 }],
      outDir: OUT,
      poppler,
    });

    expect(result.pages[0].provenance.method).toBe('pdftoppm-rasterised');
    expect(result.pages[0].provenance.resolutionDpi).toBe(600); // max x-ppi, NOT 131 from scandata
    expect(calls.map((c) => [c.fn, c.page, c.dpi])).toEqual([['rasterise', 4, 600]]);
  });

  it('falls back to the scandata-derived DPI when no image reports an x-ppi', async () => {
    const rows: PageImageInfo[] = [
      { page: 4, num: 0, width: 3180, height: 5114, objectId: '19' }, // no xPpi
      { page: 4, num: 1, width: 414, height: 566, objectId: '20' },
    ];
    const { poppler } = fakePoppler(rows);
    const result = await extractPages({
      pdfPath: PDF,
      approvedRange: { start: 4, end: 4 },
      scanLeaves: [scanLeaf(4)], // longest edge 3300 → 300 DPI
      outDir: OUT,
      poppler,
    });
    expect(result.pages[0].provenance.resolutionDpi).toBe(300);
  });
});

describe('extractPages -- produces into a CLEAN output dir (no stale-master collision on re-run)', () => {
  it('removes stale masters left in outDir by an earlier run before extracting', async () => {
    const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
    mkdirSync(OUT, { recursive: true });
    const stale = join(OUT, 'page-0001-999.png'); // a leftover from an earlier, differently-ranged run
    writeFileSync(stale, new Uint8Array([1, 2, 3]));
    expect(existsSync(stale)).toBe(true);

    const rows = [coveringRow(4, '10')];
    const { poppler } = fakePoppler(rows);
    await extractPages({ pdfPath: PDF, approvedRange: { start: 4, end: 4 }, scanLeaves: [scanLeaf(4)], outDir: OUT, poppler });

    expect(existsSync(stale)).toBe(false); // cleared before extraction
  });
});

describe('extractPages -- T040: produced count != approved range → throws', () => {
  it('throws (fail loud, SC-005) when an approved leaf is also flagged excluded and would be skipped', async () => {
    // approvedRange 4..8 == 5 leaves expected; but leaf 6 is (mis)flagged as an
    // excluded type INSIDE the range → it is skipped from page-masters →
    // produced (4) != expected (5) → the strict page-to-leaf invariant throws.
    const rows = [
      coveringRow(4, '10'),
      coveringRow(5, '11'),
      coveringRow(6, '12'),
      coveringRow(7, '13'),
      coveringRow(8, '14'),
    ];
    const { poppler, calls } = fakePoppler(rows);

    await expect(
      extractPages({
        pdfPath: PDF,
        approvedRange: { start: 4, end: 8 },
        excludedLeafTypes: new Map<number, string>([[6, 'Color Card']]),
        scanLeaves: [4, 5, 6, 7, 8].map((n) => scanLeaf(n)),
        outDir: OUT,
        poppler,
      }),
    ).rejects.toThrow(/page-to-leaf/i);

    // The misaligned set must NOT be silently emitted: leaf 6 never extracted.
    expect(calls.some((c) => c.page === 6)).toBe(false);
  });

  it('throws on an inverted range (end < start)', async () => {
    const { poppler } = fakePoppler([coveringRow(4, '10')]);
    await expect(
      extractPages({
        pdfPath: PDF,
        approvedRange: { start: 8, end: 4 },
        outDir: OUT,
        poppler,
      }),
    ).rejects.toThrow(/range/i);
  });
});

describe('extractPages -- T041: excluded third-party leaves absent from pages, recorded in excludedLeaves', () => {
  it('omits out-of-range excluded leaves from pages and records them with classification + a non-"discarded" reason', async () => {
    const rows = [4, 5, 6, 7, 8].map((n) => coveringRow(n, String(n)));
    const { poppler } = fakePoppler(rows);

    const result = await extractPages({
      pdfPath: PDF,
      approvedRange: { start: 4, end: 8 },
      excludedLeafTypes: new Map<number, string>([
        [1, 'Cover'],
        [2, 'Color Card'],
        [3, 'Google Notice'],
        [9, 'Plate'],
      ]),
      scanLeaves: [4, 5, 6, 7, 8].map((n) => scanLeaf(n)),
      outDir: OUT,
      poppler,
    });

    // The 5 approved content leaves are the only page-masters.
    expect(result.pages.map((p) => p.leaf)).toEqual([4, 5, 6, 7, 8]);
    const excludedLeafNums = new Set([1, 2, 3, 9]);
    expect(result.pages.some((p) => excludedLeafNums.has(p.leaf))).toBe(false);

    expect(result.excludedLeaves).toEqual([
      {
        leaf: 1,
        classification: 'cover',
        reason: expect.stringContaining('source PDF'),
      },
      {
        leaf: 2,
        classification: 'color-card',
        reason: expect.stringContaining('source PDF'),
      },
      {
        leaf: 3,
        classification: 'scanner-notice',
        reason: expect.stringContaining('source PDF'),
      },
      {
        leaf: 9,
        classification: 'other',
        reason: expect.stringContaining('source PDF'),
      },
    ]);
    for (const excluded of result.excludedLeaves) {
      expect(excluded.reason.toLowerCase()).not.toContain('discarded');
    }
  });
});
