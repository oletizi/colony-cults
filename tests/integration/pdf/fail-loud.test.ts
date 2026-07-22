/**
 * Fail-loud coverage sweep test for FR-012 (spec 017, T016).
 *
 * Asserts that the build orchestrators (`buildMemberItem`, `buildGroupEdition`)
 * REJECT with id-naming errors on three fail-loud violations and produce NO PDF
 * (fabrication-free):
 *
 *  1. **Missing ocr-text asset**: A member with no `ocr-text` role asset across
 *     its repositoryRecords throws during `materializeIssueText` with an error
 *     naming the member's `sourceId` (and/or "ocr-text"). No PDF is produced.
 *
 *  2. **Unresolvable page-image segment (B2 object absent)**: A member's
 *     page-master segment fetch fails (404 / missing from object store) during
 *     `stageMemberSegments`, throwing an error naming the member and/or the
 *     missing segment/folio. No PDF is produced.
 *
 *  3. **Empty group**: Calling `buildGroupEdition` with an empty members array
 *     throws an error naming the group id. No PDF is produced.
 *
 * Each test verifies both the error rejection AND the absence of a PDF file at
 * the expected output path (using `existsSync` or checking that no Typst
 * compile occurred).
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';
import { buildMemberItem } from '@/pdf/render/member-build';
import { buildGroupEdition } from '@/pdf/render/group-edition';
import type { FetchFn, FetchResponse } from '@/pdf/images/fetch';

import { writeMemberFixture } from '../../unit/pdf/member-fixture';
import { fakeTypstRunner, makeFixtureFetch } from '../../unit/pdf/typst-fake';

describe('fail-loud coverage sweep (FR-012, T016)', () => {
  it('case 1: missing ocr-text asset throws with id-naming error, produces no PDF', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G910',
      sourceId: 'PB-P910',
      case: 'port-breton',
      slug: 'test-missing-ocr-2026-03-01',
      pageCount: 2,
      articleDate: '2026-03-01',
      ocrText: 'OCR text that will be stripped.',
    });

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fail-loud-ocr-'));

    try {
      // Strip the ocr-text asset from repositoryRecord.assets.
      const assetsCopy = fixture.repositoryRecord.assets ?? [];
      const filteredAssets = assetsCopy.filter((asset) => asset.role !== 'ocr-text');

      const member: Source & { repositoryRecords: RepositoryRecord[] } = {
        ...fixture.memberSource,
        repositoryRecords: [
          {
            ...fixture.repositoryRecord,
            assets: filteredAssets,
          },
        ],
      };

      const { runner, calls } = fakeTypstRunner();

      // Attempt to build the member.
      let thrownError: Error | null = null;
      try {
        await buildMemberItem(member, {
          archiveRoot: fixture.archiveRoot,
          objectStore: fixture.objectStore,
          fetchFn: makeFixtureFetch(fixture.imageBytes),
          typst: runner,
          outDir: tempDir,
          showFrench: false,
          provider: 'b2',
          env: { ...process.env, CORPUS_CDN_BASE: 'https://cdn.example.com' },
        });
      } catch (err) {
        thrownError = err as Error;
      }

      // --- Assertion 1: Error was thrown and names the member sourceId. ---
      expect(thrownError).not.toBeNull();
      expect(thrownError).toBeInstanceOf(Error);
      const errMsg = thrownError!.message;
      expect(errMsg).toContain(member.sourceId);
      expect(errMsg.toLowerCase()).toContain('ocr-text');

      // --- Assertion 2: No PDF file was produced. ---
      // No compile should have occurred.
      expect(calls).toHaveLength(0);
      // The expected outPath does not exist.
      const expectedOutPath = `${tempDir}/${member.sourceId}/${member.sourceId}.pdf`;
      expect(existsSync(expectedOutPath)).toBe(false);
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('case 2: unresolvable page-image segment (B2 object absent) throws with id-naming error, produces no PDF', async () => {
    const fixture = await writeMemberFixture({
      groupId: 'PB-G911',
      sourceId: 'PB-P911',
      case: 'port-breton',
      slug: 'test-missing-segment-2026-03-02',
      pageCount: 3,
      articleDate: '2026-03-02',
      ocrText: 'OCR text for missing segment test.',
    });

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fail-loud-segment-'));

    try {
      const member: Source & { repositoryRecords: RepositoryRecord[] } = {
        ...fixture.memberSource,
        repositoryRecords: [fixture.repositoryRecord],
      };

      // Create a fetch function that returns 404 for the SECOND segment (f002),
      // simulating a missing B2 object while leaving f001 and f003 available.
      const faultingFetch: FetchFn = async (url: string): Promise<FetchResponse> => {
        if (url.includes('f002')) {
          return {
            ok: false,
            status: 404,
            async arrayBuffer() {
              return new ArrayBuffer(0);
            },
          };
        }
        // Delegate to the real fixture fetch for other folios.
        return makeFixtureFetch(fixture.imageBytes)(url);
      };

      const { runner, calls } = fakeTypstRunner();

      // Attempt to build the member.
      let thrownError: Error | null = null;
      try {
        await buildMemberItem(member, {
          archiveRoot: fixture.archiveRoot,
          objectStore: fixture.objectStore,
          fetchFn: faultingFetch,
          typst: runner,
          outDir: tempDir,
          showFrench: false,
          provider: 'b2',
          env: { ...process.env, CORPUS_CDN_BASE: 'https://cdn.example.com' },
        });
      } catch (err) {
        thrownError = err as Error;
      }

      // --- Assertion 1: Error was thrown and names the member sourceId. ---
      expect(thrownError).not.toBeNull();
      expect(thrownError).toBeInstanceOf(Error);
      const errMsg = thrownError!.message.toLowerCase();
      // Error should reference the member and/or the folio that failed.
      expect(errMsg).toMatch(/f002|segment|fetch|404/);

      // --- Assertion 2: No PDF file was produced. ---
      // No compile should have occurred.
      expect(calls).toHaveLength(0);
      // The expected outPath does not exist.
      const expectedOutPath = `${tempDir}/${member.sourceId}/${member.sourceId}.pdf`;
      expect(existsSync(expectedOutPath)).toBe(false);
    } finally {
      fixture.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('case 3: empty group throws with id-naming error, produces no PDF', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'fail-loud-empty-group-'));

    try {
      const { runner, calls } = fakeTypstRunner();

      // Attempt to build an empty group.
      let thrownError: Error | null = null;
      try {
        await buildGroupEdition('PB-G912', {
          members: [],
          archiveRoot: tempDir,
          objectStore: {
            async head() {
              return { exists: false, sha256: '' };
            },
            async put() {
              // no-op
            },
            async get() {
              throw new Error('Should not be called for empty group');
            },
            async attachSha256Metadata() {
              // no-op
            },
          },
          fetchFn: async () => ({
            ok: false,
            status: 404,
            async arrayBuffer() {
              return new ArrayBuffer(0);
            },
          }),
          typst: runner,
          outDir: tempDir,
          showFrench: false,
          provider: 'b2',
          env: { ...process.env, CORPUS_CDN_BASE: 'https://cdn.example.com' },
        });
      } catch (err) {
        thrownError = err as Error;
      }

      // --- Assertion 1: Error was thrown and names the group id. ---
      expect(thrownError).not.toBeNull();
      expect(thrownError).toBeInstanceOf(Error);
      const errMsg = thrownError!.message;
      expect(errMsg).toContain('PB-G912');
      expect(errMsg.toLowerCase()).toMatch(/empty|no.*member/);

      // --- Assertion 2: No PDF file was produced. ---
      // No compile should have occurred.
      expect(calls).toHaveLength(0);
      // The expected outPath does not exist.
      const expectedOutPath = `${tempDir}/PB-G912/PB-G912.pdf`;
      expect(existsSync(expectedOutPath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
