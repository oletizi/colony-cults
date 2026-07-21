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
 * Scope note (T002b, plan-gap fix): a member's derived `SourceLayout.kind` is
 * now `'monograph'` (a RESOLUTION STRATEGY, not a copy of the member's
 * bibliographic `Source.kind: 'periodical'`) -- `deriveSourceLayout`
 * (`@/archive/location`) derives `monograph` for any source with `partOf`
 * set, since a member is filed FLAT on disk (T001 finding: "though stored
 * flat, without date+ark subdirs, like a monograph") regardless of its
 * bibliographic kind. So `resolveArchiveSource` now dispatches to
 * `resolveMonograph`, which matches this fixture's flat shape -- resolution
 * succeeds structurally and per-item build is ATTEMPTED. It still fails,
 * but on a LATER, unrelated step: this fixture's member carries its OCR text
 * as a DETACHED `ocr-text` asset (no inline `issue.txt`), and this minimal
 * test injects no `ObjectStore`/`typst` to fetch/render it -- that wiring
 * belongs to later tasks (T005/T008). This test asserts ONLY the T002/T002b
 * concerns: the member's layout registers as `monograph` (so neither "no
 * archive layout registered" nor the old flat/periodical "no issue
 * directories found" mismatch recurs) and it is discoverable -- never that
 * the member's build completes end to end.
 */

import { rmSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import { isSourceLayoutRegistered, sourceLayout } from '@/archive/location';
import { buildAll, buildSource } from '@/pdf/render/batch';

import { writeMemberFixture } from '../../unit/pdf/member-fixture';

// A real source-group member (bibliography/sources/PB-P061.yml), part of the
// real source-group PB-P060 -- verified against the pinned archive clone in
// T001 (specs/017-source-group-pdf/research.md).
const MEMBER_SOURCE_ID = 'PB-P061';
const MEMBER_GROUP_ID = 'PB-P060';
const MEMBER_CASE = 'port-breton';
const MEMBER_SLUG = 'conviction-of-marquis-de-rays';

describe('batch build (T002/T002b, spec 017): member-layout registration + monograph-kind (flat) resolution', () => {
  const repoRoot = resolveRepoRoot();
  const outDir = path.join(
    repoRoot,
    'build',
    `pdf-member-discovery-test-${process.pid}-${Date.now()}`,
  );

  it('buildSource registers the member as monograph-kind and resolves its flat directory -- no longer "no archive layout registered" or "no issue directories found"', async () => {
    const fixture = await writeMemberFixture({
      groupId: MEMBER_GROUP_ID,
      sourceId: MEMBER_SOURCE_ID,
      case: MEMBER_CASE,
      slug: MEMBER_SLUG,
      pageCount: 3,
      articleDate: '1884-01-03',
    });

    try {
      // T002/T002b assertion: registration happened, AS monograph-kind (the
      // flat on-disk shape's correct resolution strategy) -- so resolution
      // never hits "no archive layout registered" (T002) nor the old
      // flat/periodical "no issue directories found" mismatch (T002b).
      const result = await buildSource(MEMBER_SOURCE_ID, { archiveRoot: fixture.archiveRoot });
      expect(isSourceLayoutRegistered(MEMBER_SOURCE_ID)).toBe(true);
      expect(sourceLayout(MEMBER_SOURCE_ID).kind).toBe('monograph');

      // The member's single flat item is now ATTEMPTED (buildSource no
      // longer throws a batch-level error for it) and fails only on a LATER,
      // out-of-scope step: this fixture's member carries a detached
      // `ocr-text` asset with no inline `issue.txt`, and this minimal test
      // injects no ObjectStore/typst to fetch/render it (T005/T008's concern,
      // not this fix's).
      expect(result.built).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].itemId).toBe(MEMBER_SOURCE_ID);
      expect(result.failed[0].error).not.toMatch(/no archive layout registered/i);
      expect(result.failed[0].error).not.toMatch(/no issue directories found/i);
    } finally {
      fixture.cleanup();
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('buildAll discovers the member via discoverBuildableSourceIds -- registered as monograph-kind + has an archive dir', async () => {
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
      // Same scope note as above: discovered + registered as monograph-kind,
      // resolution succeeds structurally, and the per-item failure is now
      // attributed to the item itself (itemId === sourceId, the monograph
      // convention) rather than a whole-source `(source ...)` marker --
      // resolveArchiveSource no longer throws a batch-level error for a
      // flat member.
      expect(memberResult.built).toHaveLength(0);
      expect(memberResult.failed).toHaveLength(1);
      expect(memberResult.failed[0].itemId).toBe(MEMBER_SOURCE_ID);
      expect(memberResult.failed[0].error).not.toMatch(/no archive layout registered/i);
      expect(memberResult.failed[0].error).not.toMatch(/no issue directories found/i);
    } finally {
      fixture.cleanup();
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
