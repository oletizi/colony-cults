/**
 * INTEGRATION test (T002, spec 017 source-group-pdf): proves
 * `ensureMemberLayoutRegistered` (`@/archive/member-layout`) is wired into
 * `@/pdf/render/batch`'s `buildSource` (before `resolveArchiveSource`) and
 * `discoverBuildableSourceIds` (before its `hasArchiveDir` filter, reached
 * here via the exported `buildAll`) -- so a source-group MEMBER (never
 * hand-added to the static `SOURCE_LAYOUTS` registry) resolves its archive
 * layout and becomes `--all`-discoverable.
 *
 * Uses the REAL bibliography (`PB-P061`, a real member of the real
 * source-group `PB-P060`, `case: port-breton`, verified in T001/research.md)
 * so `ensureMemberLayoutRegistered`'s `loadAllSources` lookup finds a genuine
 * member -- but a FRESH FIXTURE `archiveRoot` (`writeMemberFixture`, T003),
 * so nothing here touches the real private archive/B2.
 *
 * Scope note (per spec 017 tasks.md: "Reader (`archive-source.ts`)
 * unchanged"): a member's derived `SourceLayout.kind` is `'periodical'`
 * (mirrors `Source.kind`), so `resolveArchiveSource` dispatches to
 * `resolvePeriodical`, which expects dated `<date>_<ark>` issue
 * subdirectories -- but a member's real on-disk shape (and this fixture) is
 * FLAT segment folios (T001 finding: "though stored flat, without date+ark
 * subdirs, like a monograph"). So after T002's wiring, resolution reaches
 * PAST registration and fails on a LATER, different error ("no issue
 * directories found") -- reconciling that flat/periodical mismatch (and
 * materializing `issue.txt`) is out of scope here and belongs to later tasks
 * (T005/T008). This test asserts ONLY the T002 concern: the member's layout
 * registers (so the "no archive layout registered" failure is gone) and it
 * is discoverable -- never that the member's build completes.
 */

import { rmSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import { isSourceLayoutRegistered } from '@/archive/location';
import { buildAll, buildSource } from '@/pdf/render/batch';

import { writeMemberFixture } from '../../unit/pdf/member-fixture';

// A real source-group member (bibliography/sources/PB-P061.yml), part of the
// real source-group PB-P060 -- verified against the pinned archive clone in
// T001 (specs/017-source-group-pdf/research.md).
const MEMBER_SOURCE_ID = 'PB-P061';
const MEMBER_GROUP_ID = 'PB-P060';
const MEMBER_CASE = 'port-breton';
const MEMBER_SLUG = 'conviction-of-marquis-de-rays';

/** Capture a rejected promise's Error without letting the assertion escape the try/catch. */
async function captureRejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('captureRejection: promise did not reject');
}

describe('batch build (T002, spec 017): member-layout registration wiring', () => {
  const repoRoot = resolveRepoRoot();
  const outDir = path.join(
    repoRoot,
    'build',
    `pdf-member-discovery-test-${process.pid}-${Date.now()}`,
  );

  it('buildSource registers the member layout before resolveArchiveSource -- no longer "no archive layout registered"', async () => {
    const fixture = await writeMemberFixture({
      groupId: MEMBER_GROUP_ID,
      sourceId: MEMBER_SOURCE_ID,
      case: MEMBER_CASE,
      slug: MEMBER_SLUG,
      pageCount: 3,
      articleDate: '1884-01-03',
    });

    try {
      const error = await captureRejection(
        buildSource(MEMBER_SOURCE_ID, { archiveRoot: fixture.archiveRoot }),
      );

      // The T002 assertion: registration happened, so the source is no
      // longer "unregistered" -- resolution gets past that check (and fails
      // LATER, on the flat/periodical mismatch noted above, which is out of
      // this task's scope).
      expect(error.message).not.toMatch(/no archive layout registered/i);
      expect(isSourceLayoutRegistered(MEMBER_SOURCE_ID)).toBe(true);
    } finally {
      fixture.cleanup();
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('buildAll discovers the member via discoverBuildableSourceIds -- registered + has an archive dir', async () => {
    const fixture = await writeMemberFixture({
      groupId: MEMBER_GROUP_ID,
      sourceId: MEMBER_SOURCE_ID,
      case: MEMBER_CASE,
      slug: MEMBER_SLUG,
      pageCount: 3,
      articleDate: '1884-01-03',
    });

    try {
      // Only the member's directory exists under this fresh fixture root --
      // every other bibliography-listed source is absent here, so discovery
      // (over the REAL bibliography) narrows to exactly this one member once
      // its layout is registered.
      const results = await buildAll({ archiveRoot: fixture.archiveRoot, outDir });

      expect(results.map((r) => r.sourceId)).toEqual([MEMBER_SOURCE_ID]);

      const memberResult = results[0];
      expect(memberResult.built).toHaveLength(0);
      expect(memberResult.failed).toHaveLength(1);
      expect(memberResult.failed[0].itemId).toBe(`(source ${MEMBER_SOURCE_ID})`);
      // Same scope note as above: discovered + registered, but resolution
      // fails later on the flat/periodical mismatch -- never on "unregistered".
      expect(memberResult.failed[0].error).not.toMatch(/no archive layout registered/i);
    } finally {
      fixture.cleanup();
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
