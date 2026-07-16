/**
 * Tests for {@link assessFidelity} / {@link FIDELITY_MIN_RATIO}
 * (`@/repository/internet-archive/fidelity`), the T044/T045/T046
 * dimension-ratio fidelity probe (specs/013-archiveorg-acquisition-path,
 * research § D-4 / FR-009).
 *
 * The probe measures the longest-edge ratio `r = pdfEdge / scanEdge` for a
 * spread sample of pages, takes the median, and decides EXPLODE (`source:
 * 'pdf'`) vs FETCH-IMAGE-SET (`source: 'image-set'`) against the 0.90
 * threshold. Every test injects a FAKE {@link PopplerRunner}; no real poppler
 * process runs. Realistic numbers mirror the de Groote fixture (scandata
 * longest edge ~2300px).
 */

import { describe, it, expect } from 'vitest';
import type { PageImageInfo, PopplerRunner } from '@/pdf/poppler/runner';
import type { ScandataLeaf } from '@/repository/internet-archive/scandata';
import {
  assessFidelity,
  FIDELITY_MIN_RATIO,
  type FidelityDecision,
} from '@/repository/internet-archive/fidelity';

/**
 * A fake {@link PopplerRunner} whose `imagesList` returns a fixed roster; the
 * other verbs throw because the fidelity probe must never call them (it reads
 * dimensions only, no extraction).
 */
function fakePoppler(images: readonly PageImageInfo[]): PopplerRunner {
  return {
    imagesList: async () => [...images],
    info: async () => {
      throw new Error('fakePoppler.info: fidelity probe must not call info');
    },
    extractImage: async () => {
      throw new Error('fakePoppler.extractImage: fidelity probe must not extract');
    },
    rasterise: async () => {
      throw new Error('fakePoppler.rasterise: fidelity probe must not rasterise');
    },
  };
}

/** One image XObject per page `p` in `[start, end]`, longest edge = `edgeFor(p)`. */
function imagesForRange(
  start: number,
  end: number,
  edgeFor: (page: number) => number,
): PageImageInfo[] {
  const out: PageImageInfo[] = [];
  for (let page = start; page <= end; page++) {
    const height = edgeFor(page);
    // Keep the image portrait (width < height) so max(width,height) === height
    // === the longest edge the probe compares against scandata.
    out.push({ page, num: 1, width: Math.round(height * 0.7), height, objectId: `${page}0` });
  }
  return out;
}

/** One scandata leaf per leaf `l` in `[start, end]`, recorded longest edge = `edgeFor(l)`. */
function leavesForRange(
  start: number,
  end: number,
  edgeFor: (leaf: number) => number,
): ScandataLeaf[] {
  const out: ScandataLeaf[] = [];
  for (let leafNum = start; leafNum <= end; leafNum++) {
    out.push({ leafNum, pageType: 'Normal', width: 1598, height: edgeFor(leafNum) });
  }
  return out;
}

describe('assessFidelity -- T044: PDF at parity with the scan (r ~= 1.0) explodes the PDF', () => {
  it('returns source "pdf" when the median ratio is >= 0.90', async () => {
    const range = { start: 4, end: 8 };
    // Recorded scan longest edges wobble around 2300px (as the real fixture does).
    const scanEdges = [2300, 2305, 2298, 2301, 2295];
    const scan = (leaf: number) => scanEdges[leaf - 4];
    const decision: FidelityDecision = await assessFidelity({
      pdfPath: '/staging/nouvellefrancec00groogoog.pdf',
      scanLeaves: leavesForRange(4, 8, scan),
      leafRange: range,
      // PDF image longest edge equals the scan longest edge => r == 1.0 per page.
      poppler: fakePoppler(imagesForRange(4, 8, scan)),
    });

    expect(decision.source).toBe('pdf');
    expect(decision.medianRatio).toBeCloseTo(1.0, 10);
    expect(decision.sampledPages).toBe(5);
  });
});

describe('assessFidelity -- T045: PDF materially downsampled (r ~= 0.6) fetches the image set', () => {
  it('returns source "image-set" when the median ratio is < 0.90', async () => {
    const scan = (leaf: number) => [2300, 2305, 2298, 2301, 2295][leaf - 4];
    // PDF images ~1400px longest edge against ~2300px scan => r ~= 0.61.
    const decision = await assessFidelity({
      pdfPath: '/staging/degraded.pdf',
      scanLeaves: leavesForRange(4, 8, scan),
      leafRange: { start: 4, end: 8 },
      poppler: fakePoppler(imagesForRange(4, 8, () => 1400)),
    });

    expect(decision.source).toBe('image-set');
    expect(decision.medianRatio).toBeGreaterThan(0.6);
    expect(decision.medianRatio).toBeLessThan(0.62);
    expect(decision.sampledPages).toBe(5);
  });
});

describe('assessFidelity -- boundary at exactly FIDELITY_MIN_RATIO', () => {
  it('exposes the 0.90 threshold as a named constant', () => {
    expect(FIDELITY_MIN_RATIO).toBe(0.9);
  });

  it('treats median r === 0.90 as "pdf" (the threshold is inclusive: >= explodes)', async () => {
    // scanEdge 2300, pdfEdge 2070 => 2070/2300 === 0.9 exactly, for every page.
    const decision = await assessFidelity({
      pdfPath: '/staging/boundary.pdf',
      scanLeaves: leavesForRange(4, 8, () => 2300),
      leafRange: { start: 4, end: 8 },
      poppler: fakePoppler(imagesForRange(4, 8, () => 2070)),
    });

    expect(decision.medianRatio).toBeCloseTo(0.9, 10);
    expect(decision.source).toBe('pdf');
  });

  it('treats a median just below 0.90 as "image-set"', async () => {
    // pdfEdge 2065 / scanEdge 2300 = 0.8978... < 0.90 => degraded.
    const decision = await assessFidelity({
      pdfPath: '/staging/just-under.pdf',
      scanLeaves: leavesForRange(4, 8, () => 2300),
      leafRange: { start: 4, end: 8 },
      poppler: fakePoppler(imagesForRange(4, 8, () => 2065)),
    });

    expect(decision.medianRatio).toBeLessThan(0.9);
    expect(decision.source).toBe('image-set');
  });
});

describe('assessFidelity -- sampling: min(10, N) spread pages, page N <-> leaf N', () => {
  it('samples at most 10 pages even when the range is larger', async () => {
    const range = { start: 1, end: 25 }; // N = 25
    const decision = await assessFidelity({
      pdfPath: '/staging/big.pdf',
      scanLeaves: leavesForRange(1, 25, () => 2300),
      leafRange: range,
      poppler: fakePoppler(imagesForRange(1, 25, () => 2300)),
    });

    expect(decision.sampledPages).toBe(10);
    expect(decision.source).toBe('pdf');
  });

  it('samples every page when N <= 10', async () => {
    const decision = await assessFidelity({
      pdfPath: '/staging/small.pdf',
      scanLeaves: leavesForRange(4, 6, () => 2300),
      leafRange: { start: 4, end: 6 },
      poppler: fakePoppler(imagesForRange(4, 6, () => 2300)),
    });

    expect(decision.sampledPages).toBe(3);
  });

  it('computes the median (not the mean) -- one outlier page does not flip the decision', async () => {
    // 5 pages: four at r=1.0, one deeply degraded outlier. Mean would be ~0.8,
    // median stays 1.0 => "pdf".
    const scan = () => 2300;
    const pdf = (page: number) => (page === 6 ? 200 : 2300);
    const decision = await assessFidelity({
      pdfPath: '/staging/one-bad-page.pdf',
      scanLeaves: leavesForRange(4, 8, scan),
      leafRange: { start: 4, end: 8 },
      poppler: fakePoppler(imagesForRange(4, 8, pdf)),
    });

    expect(decision.medianRatio).toBeCloseTo(1.0, 10);
    expect(decision.source).toBe('pdf');
  });
});

describe('assessFidelity -- fail loud (Principle V) on no usable overlap', () => {
  it('throws when the sampled leaves carry no recorded scandata dimensions', async () => {
    // Leaves exist but have neither width nor height => no scanEdge to compare.
    const scanLeaves: ScandataLeaf[] = [
      { leafNum: 4, pageType: 'Normal' },
      { leafNum: 5, pageType: 'Normal' },
      { leafNum: 6, pageType: 'Normal' },
    ];
    await expect(
      assessFidelity({
        pdfPath: '/staging/no-dims.pdf',
        scanLeaves,
        leafRange: { start: 4, end: 6 },
        poppler: fakePoppler(imagesForRange(4, 6, () => 2300)),
      }),
    ).rejects.toThrow(/no usable/i);
  });

  it('throws when the PDF exposes no images', async () => {
    await expect(
      assessFidelity({
        pdfPath: '/staging/no-images.pdf',
        scanLeaves: leavesForRange(4, 6, () => 2300),
        leafRange: { start: 4, end: 6 },
        poppler: fakePoppler([]),
      }),
    ).rejects.toThrow(/no usable/i);
  });

  it('throws on an inverted leaf range', async () => {
    await expect(
      assessFidelity({
        pdfPath: '/staging/bad-range.pdf',
        scanLeaves: leavesForRange(4, 6, () => 2300),
        leafRange: { start: 8, end: 4 },
        poppler: fakePoppler(imagesForRange(4, 6, () => 2300)),
      }),
    ).rejects.toThrow(/leafRange/i);
  });
});
