/**
 * Unit test (T016, spec 008-edition-publishing): `@/pdf/publish/resolve`'s
 * `resolvePublishTargets` -- resolves the source + variant + built-PDF dir
 * and enumerates the issue PDFs to publish, against an INJECTED fake
 * `CorpusSnapshotReader` (mirrors the fixture style in
 * `tests/integration/pdf/batch.test.ts`) and a temp `build/pdf/<src>/`
 * fixture with some `<issueId>.pdf` files present and one deliberately
 * missing.
 *
 * Asserts:
 *  - Every present issue resolves with the correct `pdfPath`.
 *  - The missing issue is surfaced attributably (G-7) in `missing`, never
 *    silently dropped -- both its `issueId` and `expectedPath` are correct.
 *  - An unknown `sourceId` fails loud, naming the id (mirrors `buildItem`/
 *    `buildSource`'s unknown-source guard).
 *  - A monograph resolves its single unit under `itemId === sourceId`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CorpusSnapshot, RawIssue, RawPage, RawSource } from '@/browser/model';
import type { CorpusSnapshotReader } from '@/pdf/load/edition';
import { resolvePublishTargets } from '@/pdf/publish/resolve';

const SOURCE_ID = 'PB-RESOLVE-TEST';
const MONOGRAPH_ID = 'PB-RESOLVE-MONO';
const PRESENT_A = '1900-01-01_present-a';
const MISSING_ISSUE = '1900-01-02_missing-b';
const PRESENT_C = '1900-01-03_present-c';

function makeIssue(issueId: string, sequence: number): RawIssue {
  return { issueId, date: '1900-01-01', sequence, pages: [] as RawPage[] };
}

function fakeSnapshotReader(sources: RawSource[]): CorpusSnapshotReader {
  return {
    read(sourceId: string): CorpusSnapshot {
      const source = sources.find((candidate) => candidate.sourceId === sourceId);
      if (source === undefined) {
        throw new Error(`fake snapshot reader: no source ${sourceId}`);
      }
      return { sources: [source], skipped: [] };
    },
  };
}

const PERIODICAL_SOURCE: RawSource = {
  sourceId: SOURCE_ID,
  title: 'Resolve Test Source',
  kind: 'periodical',
  language: 'French',
  ark: 'ark:/12148/resolve-test-source',
  rights: 'public-domain',
  issues: [
    makeIssue(PRESENT_A, 1),
    makeIssue(MISSING_ISSUE, 2),
    makeIssue(PRESENT_C, 3),
  ],
};

const MONOGRAPH_SOURCE: RawSource = {
  sourceId: MONOGRAPH_ID,
  title: 'Resolve Test Monograph',
  kind: 'monograph',
  language: 'French',
  ark: 'ark:/12148/resolve-test-monograph',
  rights: 'public-domain',
  issues: [makeIssue(MONOGRAPH_ID, 1)],
};

describe('resolvePublishTargets (T016): resolve source + variant + built-PDF dir', () => {
  let outDir: string;

  afterEach(() => {
    if (outDir !== undefined) {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('resolves present issues with the correct pdfPath and surfaces the missing one attributably (G-7)', async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-resolve-test-'));
    const sourceOutDir = path.join(outDir, SOURCE_ID);
    mkdirSync(sourceOutDir, { recursive: true });
    writeFileSync(path.join(sourceOutDir, `${PRESENT_A}.pdf`), 'stub pdf a\n');
    writeFileSync(path.join(sourceOutDir, `${PRESENT_C}.pdf`), 'stub pdf c\n');
    // MISSING_ISSUE's PDF is deliberately NOT written.

    const result = await resolvePublishTargets({
      sourceId: SOURCE_ID,
      variant: 'english-only',
      outDir,
      snapshotReader: fakeSnapshotReader([PERIODICAL_SOURCE]),
    });

    expect(result.sourceId).toBe(SOURCE_ID);
    expect(result.variant).toBe('english-only');

    expect(result.issues.map((i) => i.issueId).sort()).toEqual([PRESENT_A, PRESENT_C].sort());
    const byId = new Map(result.issues.map((i) => [i.issueId, i.pdfPath]));
    expect(byId.get(PRESENT_A)).toBe(path.join(sourceOutDir, `${PRESENT_A}.pdf`));
    expect(byId.get(PRESENT_C)).toBe(path.join(sourceOutDir, `${PRESENT_C}.pdf`));

    // G-7: the missing PDF is surfaced attributably, not dropped, with the
    // correct issueId + the exact expected (but absent) path.
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].issueId).toBe(MISSING_ISSUE);
    expect(result.missing[0].expectedPath).toBe(path.join(sourceOutDir, `${MISSING_ISSUE}.pdf`));
  });

  it('resolves a monograph source under itemId === sourceId', async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-resolve-test-mono-'));
    const sourceOutDir = path.join(outDir, MONOGRAPH_ID);
    mkdirSync(sourceOutDir, { recursive: true });
    writeFileSync(path.join(sourceOutDir, `${MONOGRAPH_ID}.pdf`), 'stub mono pdf\n');

    const result = await resolvePublishTargets({
      sourceId: MONOGRAPH_ID,
      variant: 'parallel',
      outDir,
      snapshotReader: fakeSnapshotReader([MONOGRAPH_SOURCE]),
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].issueId).toBe(MONOGRAPH_ID);
    expect(result.issues[0].pdfPath).toBe(path.join(sourceOutDir, `${MONOGRAPH_ID}.pdf`));
    expect(result.missing).toHaveLength(0);
  });

  it('surfaces every enumerated issue as missing when the source out dir does not exist at all', async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-resolve-test-empty-'));
    // Deliberately do NOT create <outDir>/<SOURCE_ID>/ -- nothing was built.

    const result = await resolvePublishTargets({
      sourceId: SOURCE_ID,
      variant: 'english-only',
      outDir,
      snapshotReader: fakeSnapshotReader([PERIODICAL_SOURCE]),
    });

    expect(result.issues).toHaveLength(0);
    expect(result.missing.map((m) => m.issueId).sort()).toEqual(
      [PRESENT_A, MISSING_ISSUE, PRESENT_C].sort(),
    );
  });

  it('fails loud, naming the id, when the snapshot reader has no matching source (resolve.ts selectSource)', async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-resolve-test-unknown-'));
    // A reader that resolves successfully for the requested id but returns a
    // snapshot whose `sources` array does not actually contain it -- this
    // exercises resolve.ts's OWN `selectSource` guard (distinct from the
    // fake reader's own "no source" throw exercised implicitly elsewhere).
    const mismatchedReader: CorpusSnapshotReader = {
      read(): CorpusSnapshot {
        return { sources: [PERIODICAL_SOURCE], skipped: [] };
      },
    };

    await expect(
      resolvePublishTargets({
        sourceId: 'PB-DOES-NOT-EXIST',
        variant: 'english-only',
        outDir,
        snapshotReader: mismatchedReader,
      }),
    ).rejects.toThrow(/resolvePublishTargets: unknown source "PB-DOES-NOT-EXIST"/);
  });
});
