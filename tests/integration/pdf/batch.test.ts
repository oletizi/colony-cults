/**
 * INTEGRATION test (T024, spec 007 US2): drives the batch build mechanism
 * (`@/pdf/render/batch`'s `buildSource`/`buildAll`) with an INJECTED fake
 * `TypstRunner` (writes a stub file -- no real `typst` binary) and a fake
 * `fetchFn` (no network) over a small multi-issue fixture, asserting:
 *
 *  - G-1 (one PDF per item): every SUCCESSFUL item gets exactly one written
 *    PDF, at a distinct path, with `typst compile` invoked once per item.
 *  - G-4 (attributable, record-and-continue): a deliberately-broken item (an
 *    empty-english page, mirroring the real PB-P001/1885-10-15 case) is
 *    recorded by id + reason in `failed` -- it does NOT abort or omit its
 *    healthy siblings, and `failed.length > 0` is exactly the signal
 *    `scripts/build-pdf.ts`'s `reportBatch` uses to set a non-zero exit code
 *    (never a silent "OK").
 *
 * `sourceMeta`/`pin` are NOT injectable on `BuildItemOptions` (see
 * `@/pdf/render/build`'s `buildItem`) -- they read the real bibliography SSOT
 * (`bibliography/sources/<sourceId>.yml`) and the real committed pin
 * (`site/data/archive-source.json`). So every fixture below uses a REAL
 * source id that has a bibliography record, with a FAKE `CorpusSnapshotReader`
 * (or, for the `buildAll` describe block, real-shaped snapshot files written
 * to a scratch dir) supplying the controlled issue/page data. `--provider
 * iiif` is used throughout so no `CORPUS_CDN_BASE`/sha256-master check is
 * required (image-fetch contract's documented b2/iiif verification
 * asymmetry) -- only the fake `fetchFn`'s bytes matter.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CorpusSnapshot, MachineAssistLabel, RawIssue, RawPage, RawSource } from '@/browser/model';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { writeSnapshotFile } from '@/browser/load/snapshot';
import type { CorpusSnapshotReader } from '@/pdf/load/edition';
import { buildAll, buildSource } from '@/pdf/render/batch';
import type { FetchFn, FetchResponse } from '@/pdf/images/fetch';
import type { CompileRequest, CompileResult, TypstRunner } from '@/pdf/render/typst-runner';

// ---------------------------------------------------------------------------
// Shared fakes: no real `typst` binary, no network.
// ---------------------------------------------------------------------------

/** A fake TypstRunner that writes a stub PDF file instead of shelling `typst`. */
function fakeTypstRunner(): { runner: TypstRunner; calls: CompileRequest[] } {
  const calls: CompileRequest[] = [];
  const runner: TypstRunner = {
    async compile(req: CompileRequest): Promise<CompileResult> {
      calls.push(req);
      writeFileSync(req.outPath, `stub pdf (test double) for ${req.outPath}\n`);
      return { outPath: req.outPath };
    },
  };
  return { runner, calls };
}

/** A fake HTTP GET that returns fixed bytes for any url -- no network I/O. */
const fakeFetchFn: FetchFn = async (): Promise<FetchResponse> => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new TextEncoder().encode('fake-image-bytes').buffer,
});

const MACHINE_ASSIST: MachineAssistLabel = {
  engine: 'claude-code-cli',
  model: 'claude-opus-4',
  retrieved: '2026-01-01',
};

function makePage(issueId: string, pageId: string, overrides: Partial<RawPage> = {}): RawPage {
  return {
    pageId,
    folioId: overrides.folioId ?? 'f001',
    ark: overrides.ark ?? `ark:/12148/${issueId}`,
    objectStoreKey:
      overrides.objectStoreKey === undefined
        ? `object_store/${issueId}/${pageId}.jpg`
        : overrides.objectStoreKey,
    // Image-master hash (folio sidecar sha256); required by the Edition builder.
    imageSha256: 'imageSha256' in overrides ? overrides.imageSha256 : `imgsha-${issueId}-${pageId}`,
    ocrFrench: overrides.ocrFrench ?? `french ocr ${pageId}`,
    correctedFrench: overrides.correctedFrench ?? null,
    english: overrides.english ?? `english translation ${pageId}`,
    ocrCondition: overrides.ocrCondition ?? null,
    provenance: overrides.provenance ?? {
      sourceId: 'test',
      ark: `ark:/12148/${issueId}`,
      date: '1900-01-01',
      rights: 'public-domain',
      page: pageId,
      sha256: `sha-${issueId}-${pageId}`,
      machineAssist: MACHINE_ASSIST,
    },
  };
}

function makeIssue(issueId: string, sequence: number, pages: RawPage[]): RawIssue {
  return { issueId, date: '1900-01-01', sequence, pages };
}

// ---------------------------------------------------------------------------
// buildSource: G-1 + G-4 over one source's issues (the bare `<sourceId>` CLI
// selector's mechanism).
// ---------------------------------------------------------------------------

describe('batch build (T024, US2): buildSource -- G-1 one PDF per item, G-4 attributable record-and-continue', () => {
  // A real source id (bibliography/sources/PB-P001.yml + the real committed
  // pin both exist) so buildItem's non-injectable sourceMeta/pin reads
  // succeed; the ISSUES themselves are a controlled fake via snapshotReader.
  const SOURCE_ID = 'PB-P001';
  const HEALTHY_A = '1900-01-01_batch-test-a';
  const BROKEN = '1900-01-02_batch-test-broken';
  const HEALTHY_B = '1900-01-03_batch-test-b';

  const repoRoot = resolveRepoRoot();
  const outDir = path.join(repoRoot, 'build', `pdf-batch-test-${process.pid}-${Date.now()}`);

  function fakeSnapshotReader(): CorpusSnapshotReader {
    const source: RawSource = {
      sourceId: SOURCE_ID,
      title: 'Batch Test Source',
      kind: 'periodical',
      ark: 'ark:/12148/batch-test-source',
      rights: 'public-domain',
      issues: [
        makeIssue(HEALTHY_A, 1, [makePage(HEALTHY_A, 'p001')]),
        // Deliberately broken -- an empty-english page (FR-011/G-2, mirrors
        // the real PB-P001/1885-10-15_bpt6k56069168 incomplete issue).
        // Placed in the MIDDLE of the list to prove record-and-continue, not
        // just "stop before the first failure".
        makeIssue(BROKEN, 2, [makePage(BROKEN, 'p001', { english: '   ' })]),
        makeIssue(HEALTHY_B, 3, [makePage(HEALTHY_B, 'p001')]),
      ],
    };
    return {
      read(sourceId: string): CorpusSnapshot {
        if (sourceId !== SOURCE_ID) {
          throw new Error(`fake snapshot reader: no source ${sourceId}`);
        }
        return { sources: [source], skipped: [] };
      },
    };
  }

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('builds every healthy item, records the broken item attributably, and does not stop siblings', async () => {
    const { runner: typst, calls } = fakeTypstRunner();

    const result = await buildSource(SOURCE_ID, {
      provider: 'iiif',
      outDir,
      snapshotReader: fakeSnapshotReader(),
      fetchFn: fakeFetchFn,
      typst,
    });

    expect(result.sourceId).toBe(SOURCE_ID);

    // G-1: exactly one PDF per SUCCESSFUL item -- both healthy issues built,
    // each to a distinct, actually-written path, with `typst compile`
    // invoked exactly once per successful item (never for the broken one).
    expect(result.built.map((b) => b.itemId).sort()).toEqual([HEALTHY_A, HEALTHY_B].sort());
    expect(new Set(result.built.map((b) => b.outPath)).size).toBe(result.built.length);
    for (const item of result.built) {
      expect(existsSync(item.outPath)).toBe(true);
    }
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.outPath).sort()).toEqual(result.built.map((b) => b.outPath).sort());

    // G-4: the broken item is surfaced attributably (its own id + a reason
    // naming the actual defect), not swallowed -- and it did NOT prevent
    // HEALTHY_B (which comes after it) from building.
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].itemId).toBe(BROKEN);
    expect(result.failed[0].error).toMatch(/english/i);
    expect(result.failed[0].error).toMatch(new RegExp(BROKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    // This is exactly the signal `scripts/build-pdf.ts`'s `reportBatch` uses
    // to print "built N, failed M" and set `process.exitCode = 1` -- a batch
    // with any failure must never look like a silent "OK".
    expect(result.failed.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildAll: per-source attribution across the whole committed snapshot (the
// `--all` CLI selector's mechanism). Uses real-shaped (gzipped) snapshot
// files written to a scratch dir -- `buildAll`'s per-source snapshotReader
// is not independently injectable, only `env.PDF_SNAPSHOT_DIR` is.
// ---------------------------------------------------------------------------

describe('batch build: buildAll -- per-source attribution (G-1/G-4 across --all)', () => {
  // Real bibliography ids so sourceMeta reads succeed for both.
  const HEALTHY_SOURCE = 'PB-P002';
  const EMPTY_SOURCE = 'PB-P007';

  const repoRoot = resolveRepoRoot();
  const scratchDir = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-batch-all-'));
  const outDir = path.join(repoRoot, 'build', `pdf-batch-all-test-${process.pid}-${Date.now()}`);

  beforeAll(() => {
    const healthy: CorpusSnapshot = {
      sources: [
        {
          sourceId: HEALTHY_SOURCE,
          title: 'Batch-All Healthy Source',
          kind: 'periodical',
          ark: 'ark:/12148/batch-all-healthy',
          rights: 'public-domain',
          issues: [makeIssue('1900-02-01_all-healthy', 1, [makePage('1900-02-01_all-healthy', 'p001')])],
        },
      ],
      skipped: [],
    };
    // Zero issues -- a whole-source, batch-level failure (buildSource's own
    // "zero items to build" throw), NOT a per-item one -- exercises
    // `buildAll`'s try/catch around each `buildSource` call.
    const empty: CorpusSnapshot = {
      sources: [
        {
          sourceId: EMPTY_SOURCE,
          title: 'Batch-All Empty Source',
          kind: 'periodical',
          ark: 'ark:/12148/batch-all-empty',
          rights: 'public-domain',
          issues: [],
        },
      ],
      skipped: [],
    };
    writeSnapshotFile(scratchDir, HEALTHY_SOURCE, healthy);
    writeSnapshotFile(scratchDir, EMPTY_SOURCE, empty);
    writeFileSync(
      path.join(scratchDir, 'archive-source.json'),
      JSON.stringify({ ref: 'test-pin-ref-batch-all' }),
    );
  });

  afterAll(() => {
    rmSync(scratchDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it('builds every listed source and attributes a whole-source failure without stopping the rest', async () => {
    const { runner: typst } = fakeTypstRunner();

    const results = await buildAll({
      provider: 'iiif',
      outDir,
      fetchFn: fakeFetchFn,
      typst,
      env: { ...process.env, PDF_SNAPSHOT_DIR: scratchDir },
    });

    expect(results.map((r) => r.sourceId).sort()).toEqual([EMPTY_SOURCE, HEALTHY_SOURCE].sort());

    const healthy = results.find((r) => r.sourceId === HEALTHY_SOURCE);
    if (healthy === undefined) {
      throw new Error('test: no result for HEALTHY_SOURCE');
    }
    expect(healthy.built).toHaveLength(1);
    expect(healthy.failed).toHaveLength(0);
    expect(existsSync(healthy.built[0].outPath)).toBe(true);

    const empty = results.find((r) => r.sourceId === EMPTY_SOURCE);
    if (empty === undefined) {
      throw new Error('test: no result for EMPTY_SOURCE');
    }
    expect(empty.built).toHaveLength(0);
    expect(empty.failed).toHaveLength(1);
    expect(empty.failed[0].error).toMatch(/zero items/i);
    expect(empty.failed[0].error).toMatch(new RegExp(EMPTY_SOURCE));
  });
});
