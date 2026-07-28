/**
 * T001 (spec 018-corpus-config-seam): the characterization gate for the 9
 * legacy Port Breton Sources' archive layouts.
 *
 * `SOURCE_LAYOUTS` in `@/archive/location` is a static, hand-authored map.
 * T013 retires it in favor of a generic derivation (`deriveSourceLayout`)
 * plus validated per-Source overrides. This test is the ONLY thing proving
 * that refactor is byte-identical for the 9 legacy sources -- it protects
 * SC-001 ("all 9 legacy archive locations byte-identical") and INV-4 ("All 9
 * legacy archive paths byte-identical (generic or validated override)").
 *
 * The fixture (`tests/fixtures/archive/legacy-source-layouts.json`) was
 * captured from the CURRENT (pre-T013) behavior of every exported function in
 * `@/archive/location` whose output depends on a source's resolved layout:
 *
 *   - `sourceLayout`               -- the raw {case, type, slug, kind}
 *   - `isSourceLayoutRegistered`   -- whether a layout resolves at all
 *   - `sourceRootDir`              -- the source's own directory
 *   - `monographDir`               -- the flat monograph directory (or the
 *                                     "not a monograph" throw for PB-P001)
 *   - `issueDir`                   -- the dated issue directory
 *   - `findIssueDir`               -- reverse lookup by ark (always throws
 *                                     here: the fixture's archive root does
 *                                     not exist on disk, so the assertion is
 *                                     on the derived, layout-dependent path
 *                                     embedded in the error message)
 *   - `resolveFetchedDir`          -- per-document reverse lookup (same
 *                                     reasoning as `findIssueDir`)
 *
 * Deliberately EXCLUDED:
 *   - `registerSourceLayout` -- a mutator of the runtime overlay, not a
 *     layout-dependent reader; T013 explicitly retains it unchanged.
 *   - `deriveSourceLayout` -- takes a full `Source` object, not a sourceId;
 *     it does not consume `SOURCE_LAYOUTS` at all, so it has no "current
 *     legacy behavior" to characterize here (it IS the replacement
 *     mechanism T013 wires in).
 *   - `resolveArchiveRoot` / `assertInsideArchive` -- do not take a sourceId
 *     and do not depend on `SOURCE_LAYOUTS`.
 *
 * `findIssueDir`/`resolveFetchedDir` also touch the filesystem (existsSync/
 * readdirSync), so a truly "pure" byte-identical comparison of their success
 * path is not possible without a real archive checkout. Using a fixed,
 * guaranteed-absent `archiveRoot` ("/fixture-archive-root") makes their
 * throw path fully deterministic while still exercising -- and pinning --
 * the layout-derived path that is spliced into the error message.
 *
 * EXTENDED (T024, regression fix): the fixture/gate also covers the 3
 * source-group CONTAINER ids (`PB-P004`, `PB-P006`, `PB-P060`). None of the 9
 * legacy ids above is a container, which is exactly how a regression slipped
 * past this gate -- `deriveArchiveLayoutPolicy` briefly precomputed a generic
 * layout for every in-scope Source with no filter on `Source.kind`, so the
 * three containers (which have no archive location of their own -- only
 * their members do) resolved a phantom layout instead of throwing. Every
 * function under test here must still THROW `sourceLayout: no archive layout
 * registered for source "<id>"` for all three, exactly as it did before the
 * corpus-config-seam feature touched `SOURCE_LAYOUTS`, and
 * `isSourceLayoutRegistered` must still return `false`. The existing 9 legacy
 * entries and their expected values are UNCHANGED by this extension -- they
 * still pin FR-010 byte-identity exactly as originally captured.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  sourceLayout,
  isSourceLayoutRegistered,
  sourceRootDir,
  monographDir,
  issueDir,
  findIssueDir,
  resolveFetchedDir,
  type SourceLayout,
} from '@/archive/location';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

interface FixtureSourceEntry {
  sourceId: string;
  sourceLayout: Outcome<SourceLayout>;
  isSourceLayoutRegistered: boolean;
  sourceRootDir: Outcome<string>;
  monographDir: Outcome<string>;
  issueDir: Outcome<string>;
  findIssueDir: Outcome<string>;
  resolveFetchedDir: Outcome<string>;
}

interface Fixture {
  description: string;
  fixtureInputs: {
    archiveRoot: string;
    issueArk: string;
    issueDate: string;
  };
  sources: FixtureSourceEntry[];
}

const FIXTURE: Fixture = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'fixtures', 'archive', 'legacy-source-layouts.json'),
    'utf-8',
  ),
) as Fixture;

const LEGACY_SOURCE_IDS = [
  'PB-P001',
  'PB-P002',
  'PB-P003',
  'PB-P054',
  'PB-P055',
  'PB-P056',
  'PB-P057',
  'PB-P058',
  'PB-P059',
] as const;

/**
 * The 3 `kind: source-group` CONTAINER ids (T024): they must resolve NO
 * layout at all (see the module doc comment's "EXTENDED" note).
 */
const GROUP_CONTAINER_SOURCE_IDS = ['PB-P004', 'PB-P006', 'PB-P060'] as const;

const ALL_FIXTURE_SOURCE_IDS = [...LEGACY_SOURCE_IDS, ...GROUP_CONTAINER_SOURCE_IDS];

function capture<T>(fn: () => T): Outcome<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

describe('archive/location characterization gate (T001, spec 018-corpus-config-seam)', () => {
  it('the fixture covers exactly the 9 legacy source ids plus the 3 group-container ids, no more, no fewer', () => {
    expect(FIXTURE.sources.map((entry) => entry.sourceId).sort()).toEqual(
      [...ALL_FIXTURE_SOURCE_IDS].sort(),
    );
  });

  it('every group-container id is pinned to throw, with isSourceLayoutRegistered false', () => {
    for (const sourceId of GROUP_CONTAINER_SOURCE_IDS) {
      const entry = FIXTURE.sources.find((candidate) => candidate.sourceId === sourceId);
      expect(entry, `fixture is missing group-container id ${sourceId}`).toBeDefined();
      expect(entry?.isSourceLayoutRegistered, `${sourceId} must not be registered`).toBe(false);
      expect(entry?.sourceLayout.ok, `${sourceId}'s sourceLayout must throw`).toBe(false);
    }
  });

  const { archiveRoot, issueArk, issueDate } = FIXTURE.fixtureInputs;

  for (const entry of FIXTURE.sources) {
    const { sourceId } = entry;

    describe(sourceId, () => {
      it(`sourceLayout("${sourceId}") is byte-identical to the fixture`, () => {
        const actual = capture(() => sourceLayout(sourceId));
        expect(actual, `sourceLayout(${sourceId}) drifted from fixture`).toEqual(
          entry.sourceLayout,
        );
      });

      it(`isSourceLayoutRegistered("${sourceId}") is byte-identical to the fixture`, () => {
        expect(
          isSourceLayoutRegistered(sourceId),
          `isSourceLayoutRegistered(${sourceId}) drifted from fixture`,
        ).toBe(entry.isSourceLayoutRegistered);
      });

      it(`sourceRootDir("${sourceId}") is byte-identical to the fixture`, () => {
        const actual = capture(() => sourceRootDir(sourceId, archiveRoot));
        expect(actual, `sourceRootDir(${sourceId}) drifted from fixture`).toEqual(
          entry.sourceRootDir,
        );
      });

      it(`monographDir("${sourceId}") is byte-identical to the fixture`, () => {
        const actual = capture(() => monographDir(sourceId, archiveRoot));
        expect(actual, `monographDir(${sourceId}) drifted from fixture`).toEqual(
          entry.monographDir,
        );
      });

      it(`issueDir("${sourceId}", ...) is byte-identical to the fixture`, () => {
        const actual = capture(() =>
          issueDir(sourceId, { ark: issueArk, date: issueDate }, archiveRoot),
        );
        expect(actual, `issueDir(${sourceId}) drifted from fixture`).toEqual(entry.issueDir);
      });

      it(`findIssueDir("${sourceId}", ...) is byte-identical to the fixture`, () => {
        const actual = capture(() => findIssueDir(sourceId, issueArk, archiveRoot));
        expect(actual, `findIssueDir(${sourceId}) drifted from fixture`).toEqual(
          entry.findIssueDir,
        );
      });

      it(`resolveFetchedDir("${sourceId}", ...) is byte-identical to the fixture`, () => {
        const actual = capture(() => resolveFetchedDir(sourceId, issueArk, archiveRoot));
        expect(actual, `resolveFetchedDir(${sourceId}) drifted from fixture`).toEqual(
          entry.resolveFetchedDir,
        );
      });
    });
  }
});
