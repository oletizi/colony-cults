/**
 * Integration test for {@link buildMemberItem} (spec 017, T009).
 *
 * T007 (`tests/unit/pdf/member-build.test.ts`) already covers the Typst-INPUT
 * structure in isolation. This test is deliberately end-to-end: it drives the
 * real orchestrator against a genuine temp-filesystem archive + build dir
 * (only the Typst compile and the image/object-store fetches are faked) and
 * asserts the SIDE EFFECTS a caller actually depends on:
 *
 *  1. Exactly ONE PDF file lands on disk at `result.outPath` (one Typst
 *     compile call, one collapsed page).
 *  2. `issue.txt` is materialized in the member's OWN archive directory, with
 *     an `issue.txt.yml` sidecar recording full provenance (object-store key,
 *     sha256, source representation) -- Constitution Principle XV: no orphan
 *     assets, no metadata left behind.
 *  3. The serialized Typst input Typst actually received carries the N staged
 *     segment images in ASCENDING folio order and the whole English OCR text
 *     as the single page's recto.
 *  4. The staged segment image files themselves exist on disk under the
 *     build's image directory (the fetch really ran, the bytes were really
 *     written).
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { sha256OfBytes } from '@/archive/checksum';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';
import { buildMemberItem } from '@/pdf/render/member-build';
import type { TypstInput } from '@/pdf/render/typst-input';

import { writeMemberFixture } from '../../unit/pdf/member-fixture';
import { fakeTypstRunner, makeFixtureFetch } from '../../unit/pdf/typst-fake';

/** The shape of the `issue.txt.yml` provenance sidecar `materializeIssueText` writes (see `@/archive/issue-text-materialize`'s `writeSidecar`). */
interface IssueTextSidecar {
  id: string;
  object_store: { key: string };
  sha256: string;
  source_representation?: string;
  materialized_at: string;
}

describe('buildMemberItem (integration)', () => {
  it('builds the member fixture end-to-end: exactly one PDF, stacked ascending segments, English recto text, and a materialized issue.txt with full provenance', async () => {
    // A non-colliding synthetic sourceId (not in the static SOURCE_LAYOUTS
    // registry), distinct from the T007 unit-test fixture's PB-P901.
    const fixture = await writeMemberFixture({
      groupId: 'PB-G902',
      sourceId: 'PB-P902',
      case: 'port-breton',
      slug: 'test-member-clipping-2026-02-20',
      pageCount: 3,
      articleDate: '2026-02-20',
      ocrText: 'Whole-article English OCR text for the end-to-end integration test.',
    });

    const tempDir = mkdtempSync(path.join('/tmp', 'member-build-integration-'));

    try {
      const member: Source & { repositoryRecords: RepositoryRecord[] } = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      const { runner, calls } = fakeTypstRunner();

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

      // --- 1. Exactly one PDF file on disk, from exactly one compile call. ---
      expect(calls).toHaveLength(1);
      expect(result.outPath).toBe(calls[0].outPath);
      expect(existsSync(result.outPath)).toBe(true);
      expect(statSync(result.outPath).isFile()).toBe(true);

      // --- 2. issue.txt materialized with full provenance. ---
      const issueTxtPath = path.join(fixture.sourceDir, 'issue.txt');
      const issueTxtContent = await readFile(issueTxtPath, 'utf-8');
      const expectedOcrText = Buffer.from(fixture.ocrTextBytes).toString('utf-8');
      expect(issueTxtContent).toBe(expectedOcrText);

      const sidecarPath = path.join(fixture.sourceDir, 'issue.txt.yml');
      expect(existsSync(sidecarPath)).toBe(true);
      const sidecarRaw = await readFile(sidecarPath, 'utf-8');
      const sidecar: IssueTextSidecar = parseYaml(sidecarRaw);

      expect(sidecar.object_store.key).toBe(fixture.ocrTextObjectStoreKey);
      expect(sidecar.sha256).toBe(sha256OfBytes(fixture.ocrTextBytes));
      expect(sidecar.sha256).toBe(fixture.ocrTextSha256);
      expect(sidecar.source_representation).toBe('papers-past-text-tab');

      // --- 3. Typst received the stacked segments (ascending) + English recto text. ---
      const inputJson = await readFile(calls[0].inputPath, 'utf-8');
      const input: TypstInput = JSON.parse(inputJson);

      expect(input.pages).toHaveLength(1);
      const page = input.pages[0];

      expect(page.verso.segments).toBeDefined();
      const segments = page.verso.segments!;
      expect(segments).toHaveLength(3);
      expect(segments[0].imagePath).toMatch(/f001/);
      expect(segments[1].imagePath).toMatch(/f002/);
      expect(segments[2].imagePath).toMatch(/f003/);

      expect(page.recto.english).toBe(issueTxtContent);

      // --- 4. The staged segment image files themselves exist on disk. ---
      const imageDir = path.join(tempDir, member.sourceId, `${member.sourceId}.images`);
      for (const segment of segments) {
        const stagedPath = path.join(imageDir, segment.imagePath);
        expect(existsSync(stagedPath)).toBe(true);
        expect(statSync(stagedPath).isFile()).toBe(true);
      }
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
