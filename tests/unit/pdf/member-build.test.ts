import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Source } from '@/model/source';
import type { RepositoryRecord } from '@/model/repository-record';
import type { TypstInput } from '@/pdf/render/typst-input';
import { buildMemberItem, type BuildMemberOptions } from '@/pdf/render/member-build';

import { writeMemberFixture } from './member-fixture';
import { fakeTypstRunner, makeFixtureFetch } from './typst-fake';

/**
 * Builds one member fixture and returns the parsed `TypstInput` Typst
 * actually received -- shared by the `showFrench` regression tests below so
 * each only has to vary `opts.showFrench`/`env`.
 */
async function buildMemberAndReadInput(
  sourceId: string,
  showFrenchOverride: Partial<Pick<BuildMemberOptions, 'showFrench' | 'env'>>,
): Promise<{ input: TypstInput; cleanup: () => void }> {
  const fixture = await writeMemberFixture({
    groupId: 'PB-G998',
    sourceId,
    case: 'port-breton',
    slug: `test-member-showfrench-${sourceId.toLowerCase()}`,
    pageCount: 1,
    articleDate: '2026-01-16',
    ocrText: 'English OCR text for the showFrench regression fixture.',
  });

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'member-build-showfrench-test-'));
  const { runner, calls } = fakeTypstRunner();

  const member: Source & { repositoryRecords: RepositoryRecord[] } = {
    ...fixture.memberSource,
    repositoryRecords: [fixture.repositoryRecord],
  };

  await buildMemberItem(member, {
    archiveRoot: fixture.archiveRoot,
    objectStore: fixture.objectStore,
    fetchFn: makeFixtureFetch(fixture.imageBytes),
    typst: runner,
    outDir: tempDir,
    provider: 'b2',
    env: { ...process.env, CORPUS_CDN_BASE: 'https://cdn.example.com' },
    ...showFrenchOverride,
  });

  const inputJson = await readFile(calls[0].inputPath, 'utf-8');
  const input: TypstInput = JSON.parse(inputJson);

  const cleanup = (): void => {
    fixture.cleanup();
    rmSync(tempDir, { recursive: true, force: true });
  };

  return { input, cleanup };
}

describe('buildMemberItem', () => {
  // ---------------------------------------------------------------------------
  // Regression (AUDIT-BARRAGE FINDING 1 / FR-007): a source-group member must
  // ALWAYS render english-only. `buildMemberItem` must never inherit the
  // parallel-FR|EN config default -- `composeMemberPage` hardcodes an
  // english-only recto (`ocrFrench: ''`, `machineAssist: null`), so a
  // `showFrench: true` render would show the PARALLEL-recto template with a
  // BLANK French column: a broken member PDF.
  // ---------------------------------------------------------------------------

  it('forces TypstInput.showFrench === false even when opts.showFrench is UNSET and config default is true (FINDING 1)', async () => {
    const { input, cleanup } = await buildMemberAndReadInput('PB-P908', {
      // `showFrench` intentionally omitted from the override -- exercises
      // `buildMemberItem`'s own `opts.showFrench ?? config.showFrench`
      // fallback, whose config default (`resolvePdfConfig`) is `true` when
      // `PDF_SHOW_FRENCH` is unset in `env`.
      env: { ...process.env, CORPUS_CDN_BASE: 'https://cdn.example.com', PDF_SHOW_FRENCH: undefined },
    });
    try {
      expect(input.showFrench).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('forces TypstInput.showFrench === false even when the caller explicitly passes showFrench: true (FINDING 1)', async () => {
    const { input, cleanup } = await buildMemberAndReadInput('PB-P909', {
      showFrench: true,
    });
    try {
      expect(input.showFrench).toBe(false);
    } finally {
      cleanup();
    }
  });
  it('assembles a source-group member into ONE page whose verso stacks N segment images in ascending order, recto faces the whole English OCR, and carries honest OCR-transcription colophon', async () => {
    // Create a member fixture with 3 page-master segments (N=3).
    const fixture = await writeMemberFixture({
      groupId: 'PB-G999',
      sourceId: 'PB-P901', // Non-colliding synthetic sourceId (not in SOURCE_LAYOUTS).
      case: 'port-breton',
      slug: 'test-member-clipping-2026-01-15',
      pageCount: 3,
      articleDate: '2026-01-15',
      ocrText: 'English OCR text for this newspaper clipping article.',
    });

    const tempDir = mkdtempSync('/tmp/member-build-test-');

    try {
      // Wire the member with repositoryRecords (T008 contract).
      const member: Source & { repositoryRecords: RepositoryRecord[] } = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      // Set up the fake Typst runner to capture CompileRequest(s).
      const { runner, calls } = fakeTypstRunner();

      // Build the member item.
      const result = await buildMemberItem(member, {
        archiveRoot: fixture.archiveRoot,
        objectStore: fixture.objectStore,
        fetchFn: makeFixtureFetch(fixture.imageBytes),
        typst: runner,
        outDir: tempDir,
        showFrench: false,
        provider: 'b2',
        env: { ...process.env, CORPUS_CDN_BASE: 'https://cdn.example.com' },
      });

      // Assertion 1: Exactly ONE Typst compile call (one page/item).
      expect(calls).toHaveLength(1);
      expect(result.outPath).toBe(calls[0].outPath);

      // Read and parse the serialized Typst input JSON from disk.
      const inputJson = await readFile(calls[0].inputPath, 'utf-8');
      const input: TypstInput = JSON.parse(inputJson);

      // Assertion 2: The Edition produces exactly ONE page.
      expect(input.pages).toHaveLength(1);

      const page = input.pages[0];

      // Assertion 3: The single page's verso.segments contains exactly 3 images
      // in ASCENDING segment order (f001, f002, f003 / sequence 1, 2, 3).
      expect(page.verso.segments).toBeDefined();
      expect(page.verso.segments).toHaveLength(3);

      // Assert the segment paths are in ascending order.
      const segmentPaths = page.verso.segments!.map((seg) => seg.imagePath);
      expect(segmentPaths[0]).toMatch(/f001/);
      expect(segmentPaths[1]).toMatch(/f002/);
      expect(segmentPaths[2]).toMatch(/f003/);

      // Assertion 4: The page's english recto text equals the fixture's OCR text
      // (the whole article OCR, materialized as issue.txt).
      expect(page.recto.english).toBe(Buffer.from(fixture.ocrTextBytes).toString('utf-8'));

      // Assertion 5: The colophon reflects an honest OCR-transcription
      // (no machine-translation claim). For English-source editions,
      // `ocrTranscription` is non-null and `translation` is null.
      expect(input.colophon.translation).toBeNull();
      expect(input.colophon.ocrTranscription).not.toBeNull();
      expect(input.colophon.ocrTranscription?.engineStatus).toBeTruthy();
      expect(input.colophon.ocrTranscription?.engineStatus.length).toBeGreaterThan(0);

      // Assertion 6: The ocr-text asset does NOT appear as a verso segment image.
      // verso.segments length must be exactly the page-master count (3), not 4.
      // (The ocr-text asset has sequence 0 and is excluded from the image stack.)
      expect(page.verso.segments!).toHaveLength(3);
      expect(page.verso.segments!.length).toBe(
        fixture.repositoryRecord.assets!.filter((a) => a.role === 'page-master').length
      );
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
