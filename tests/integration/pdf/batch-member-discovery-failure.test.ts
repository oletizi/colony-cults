/**
 * INTEGRATION test (T015, spec 017 US4): buildAll discovers members via T002
 * registration + archive presence AND records attributable failures when a
 * member cannot be built, while siblings continue (record-and-continue, FR-013/G-4).
 *
 * This test proves that:
 *
 * 1. **Discovery (T002)**: a source-group member registered via
 *    `ensureMemberLayoutRegistered` with an archive directory present appears
 *    in `buildAll`'s results as an attempted source (not silently skipped).
 *
 * 2. **Attributable failure (FR-013/G-4)**: a member failing on an
 *    unresolvable required input BEFORE any B2 I/O (e.g., no `ObjectStore`
 *    configured when one is needed) is recorded in the `failed[]` array with
 *    the member id + the error reason, NOT swallowed or thrown out of `buildAll`.
 *
 * 3. **Siblings continue (G-4)**: a healthy STANDALONE source in the same
 *    archive still builds to completion despite the member's failure, proving
 *    record-and-continue at the whole-corpus level.
 *
 * 4. **Summary semantics (FR-013/G-4)**: `buildAll` returns both `built[]` and
 *    `failed[]` entries; the caller (`scripts/build-pdf.ts`) drives a non-zero
 *    exit when failures are present (not tested here; that is the CLI layer).
 *
 * **Fixture design**: A shared archive root holds:
 *   - A real standalone source (`PB-P002`, registered monograph) built
 *     successfully via fake typst + fake image fetch.
 *   - A real source-group member (`PB-P061`, periodical with `partOf: PB-P060`)
 *     with flat archive folios but failing when `buildMemberItem` attempts to
 *     resolve the ObjectStore (no B2 credentials injected; the failure happens
 *     BEFORE any segment image fetch, matching the FR-013 requirement). The
 *     failure is attributed to the member itself, not to the batch as a whole.
 *
 * **Coverage note**: This test verifies discovery + attributable failure +
 * record-and-continue. A fully-healthy member built end-to-end (fetching
 * real ocr-text + rendering its segments into one PDF) is covered by T009
 * (archive-direct synthetic member) and T018 (against real B2); not here.
 *
 * No committed snapshot is read; the archive-direct build uses only the
 * discovered archive structure and bibliography SSOT.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import { buildAll } from '@/pdf/render/batch';

import { writeFixtureArchive } from '../../unit/pdf/archive-fixture';
import { writeMemberFixture } from '../../unit/pdf/member-fixture';
import { fakeTypstRunner, makeFixtureFetch } from '../../unit/pdf/typst-fake';

const CORPUS_CDN_BASE = 'https://cdn.test';

// Healthy standalone source (registered monograph, same case as the member).
const HEALTHY_SOURCE_ID = 'PB-P002';
const HEALTHY_CASE = 'port-breton';
const HEALTHY_SLUG = 'nouvelle-france-colonie-libre-port-breton';

// Real source-group member (spec 017 T002/T001: PB-P061 is a real member of
// PB-P060, verified in research.md). Will fail when attempting to resolve
// ObjectStore (no B2 credentials), BEFORE any segment image fetch. The failure
// is recorded as attributable to the member itself, not thrown out of buildAll.
const MEMBER_SOURCE_ID = 'PB-P061';
const MEMBER_GROUP_ID = 'PB-P060';
const MEMBER_CASE = 'port-breton';
const MEMBER_SLUG = 'conviction-of-marquis-de-rays';

describe(
  'batch build (T015, spec 017 US4): buildAll discovers members + records attributable failure (FR-013/G-4)',
  () => {
    const repoRoot = resolveRepoRoot();
    const outDir = path.join(
      repoRoot,
      'build',
      `pdf-batch-member-discovery-test-${process.pid}-${Date.now()}`,
    );

    afterAll(() => {
      rmSync(outDir, { recursive: true, force: true });
    });

    it('discovers both standalone and member sources; records member failure; sibling builds despite failure', async () => {
      // Create a healthy standalone source in a fresh archive root.
      const healthyFixture = await writeFixtureArchive({
        case: HEALTHY_CASE,
        slug: HEALTHY_SLUG,
        pageCount: 2,
      });

      // Reuse the healthy fixture's archive root and add the member to it.
      const memberFixture = await writeMemberFixture({
        groupId: MEMBER_GROUP_ID,
        sourceId: MEMBER_SOURCE_ID,
        case: MEMBER_CASE,
        slug: MEMBER_SLUG,
        pageCount: 3,
        articleDate: '1884-01-03',
        archiveRoot: healthyFixture.archiveRoot,
      });

      try {
        const { runner: typst } = fakeTypstRunner();
        const fetchFn = makeFixtureFetch(healthyFixture.imageBytes);

        // Call buildAll with the shared archive root. NO objectStore is
        // injected, so the member will fail when attempting to resolve
        // S3ObjectStore (no B2 credentials) -- a failure BEFORE any I/O.
        const results = await buildAll({
          archiveRoot: healthyFixture.archiveRoot,
          provider: 'b2',
          outDir,
          fetchFn,
          typst,
          env: { ...process.env, CORPUS_CDN_BASE },
        });

        // Discovery: both sources discovered in the shared archive root.
        // (Every other registered source is absent, so discovery narrows to
        // exactly these two after T002's ensureMemberLayoutRegistered.)
        const resultIds = results.map((r) => r.sourceId).sort();
        expect(resultIds).toEqual([HEALTHY_SOURCE_ID, MEMBER_SOURCE_ID].sort());

        // Healthy sibling: built successfully.
        const healthy = results.find((r) => r.sourceId === HEALTHY_SOURCE_ID);
        if (healthy === undefined) {
          throw new Error('test: no result for HEALTHY_SOURCE_ID');
        }
        expect(healthy.built).toHaveLength(1);
        expect(healthy.failed).toHaveLength(0);
        expect(healthy.built[0].itemId).toBe(HEALTHY_SOURCE_ID);
        expect(existsSync(healthy.built[0].outPath)).toBe(true);

        // Member: attributable failure, not thrown out of buildAll.
        // FR-013/G-4 proof: the member appears in results as a failed entry,
        // NAMED with the member id (not silently skipped or as a batch-level
        // throw), and includes a reason (ObjectStore resolution error).
        const member = results.find((r) => r.sourceId === MEMBER_SOURCE_ID);
        if (member === undefined) {
          throw new Error('test: no result for MEMBER_SOURCE_ID');
        }
        expect(member.built).toHaveLength(0);
        expect(member.failed).toHaveLength(1);
        expect(member.failed[0].itemId).toBe(MEMBER_SOURCE_ID);
        // The error should mention missing B2 config or missing env var.
        // Exact text varies by which env var is missing first, but the
        // failure is attributable (not a hidden skip or abort).
        expect(member.failed[0].error).toMatch(
          /resolveObjectStoreConfig|required environment variable/i,
        );

        // Summary: both discovered + one healthy, one failed (built 1, failed 1).
        const totalBuilt = results.reduce((n, r) => n + r.built.length, 0);
        const totalFailed = results.reduce((n, r) => n + r.failed.length, 0);
        expect(totalBuilt).toBe(1);
        expect(totalFailed).toBe(1);
      } finally {
        healthyFixture.cleanup();
        memberFixture.cleanup();
        rmSync(outDir, { recursive: true, force: true });
      }
    });
  },
);
