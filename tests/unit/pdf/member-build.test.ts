import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import type { Source } from '@/model/source';
import type { RepositoryRecord } from '@/model/repository-record';
import type { TypstInput } from '@/pdf/render/typst-input';
import { buildMemberItem, type BuildMemberOptions } from '@/pdf/render/member-build';

import { writeMemberFixture } from './member-fixture';
import { fakeTypstRunner, makeFixtureFetch } from './typst-fake';

describe('buildMemberItem', () => {
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
      expect(page.recto.english).toBe(fixture.ocrTextBytes.toString('utf-8'));

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
        fixture.repositoryRecord.assets.filter((a) => a.role === 'page-master').length
      );
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
