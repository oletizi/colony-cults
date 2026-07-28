/**
 * T020b (spec 018-corpus-config-seam, FR-007, mechanizing its last clause):
 * an `archiveLayoutOverrides` entry must be present in a corpus manifest
 * ONLY where the generic derivation genuinely does NOT reproduce the
 * characterized legacy output. T013 upheld this by hand -- 7 of the 9 legacy
 * Port Breton sources reproduce generically, and only `PB-P002`/`PB-P003`
 * needed overrides -- but nothing mechanically checked it before this guard.
 * A stale/unnecessary override (or, worse, a missing one) would sit
 * unnoticed indefinitely, since `location-legacy-characterization.test.ts`
 * only proves the FINAL resolved layout is byte-identical; it does not care
 * WHICH resolution step (override vs generic) produced that layout, so it
 * cannot by itself catch an override that no longer earns its keep.
 *
 * DOES NOT MODIFY the T001 characterization fixture
 * (`tests/fixtures/archive/legacy-source-layouts.json`) or its gate test
 * (`tests/unit/archive/location-legacy-characterization.test.ts`) -- both are
 * read-only inputs here. The 9-id set below is copied verbatim from that gate
 * test's `LEGACY_SOURCE_IDS` (the "9 legacy sources" spec.md/SC-001 and
 * FR-007 refer to); it deliberately excludes the 3 `source-group` CONTAINER
 * ids the T024 extension added to that fixture (`PB-P004`/`PB-P006`/
 * `PB-P060`), which have NO archive location at all and so are outside the
 * scope of "does the generic derivation reproduce the legacy path".
 *
 * MECHANISM. For each of the 9 legacy ids:
 *   1. Load the real Source from the production bibliography SSOT
 *      (`bibliography/sources/<id>.yml`) via `loadSourceFile` -- the same
 *      SSOT the characterization fixture was captured against.
 *   2. Compute `deriveSourceLayout(source, source.case)` -- the PURE generic
 *      derivation (FR-017 step 3), with NO override applied.
 *   3. Compare it, via `layoutsEqual`, against the fixture's pinned
 *      `sourceLayout.value` for that id -- the characterized pre-T013 legacy
 *      output SC-001/INV-4 require staying byte-identical.
 *   4. Cross-check against whether `corpora/port-breton.yml` -- the real
 *      production manifest -- declares an `archiveLayoutOverrides` entry for
 *      that id.
 *
 * The two FR-007 assertions fall out directly:
 *   - generic reproduces the fixture, but an override is present  -> the
 *     override is UNNECESSARY (FR-007 violation: over-broad manifest).
 *   - generic does NOT reproduce the fixture, and no override is present ->
 *     an override is MISSING (FR-007 violation: SC-001/INV-4 would fail
 *     for real production data, not just a fixture).
 * Either failure is reported by name, not just a boolean, so a future
 * violation is immediately actionable.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { deriveSourceLayout, layoutsEqual, type SourceLayout } from '@/archive/derive-layout';
import { loadCorpusManifest } from '@/corpus/manifest';
import {
  resolveCorporaRoot,
  resolveRepoRootUpward,
  resolveSourcesDir,
} from '@/cli/composition-root';

/**
 * Copied verbatim from `location-legacy-characterization.test.ts`'s
 * `LEGACY_SOURCE_IDS` -- the 9 legacy sources FR-007/SC-001 refer to. Kept as
 * an independent literal (not imported) because that test file exports
 * nothing; duplicating a 9-element id list is far cheaper than reaching into
 * another test module's internals, and both are cross-checked against the
 * same fixture file below so a drift between them would surface as a missing
 * fixture entry, not silently.
 */
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

interface FixtureSourceEntry {
  sourceId: string;
  sourceLayout: { ok: true; value: SourceLayout } | { ok: false; error: string };
}

interface Fixture {
  sources: FixtureSourceEntry[];
}

const repoRoot = resolveRepoRootUpward();
const FIXTURE: Fixture = JSON.parse(
  readFileSync(
    join(repoRoot, 'tests', 'fixtures', 'archive', 'legacy-source-layouts.json'),
    'utf-8',
  ),
) as Fixture;

const corporaRoot = resolveCorporaRoot(repoRoot);
const sourcesDir = resolveSourcesDir(repoRoot);
const manifest = loadCorpusManifest(corporaRoot, 'port-breton');
const overrides = manifest.archiveLayoutOverrides ?? {};

interface Analysis {
  sourceId: string;
  genericReproducesLegacy: boolean;
  hasOverride: boolean;
}

function analyze(sourceId: string): Analysis {
  const fixtureEntry = FIXTURE.sources.find((entry) => entry.sourceId === sourceId);
  if (fixtureEntry === undefined) {
    throw new Error(
      `T020b: fixture is missing legacy source id "${sourceId}" -- ` +
        'tests/fixtures/archive/legacy-source-layouts.json must cover every LEGACY_SOURCE_IDS entry',
    );
  }
  if (!fixtureEntry.sourceLayout.ok) {
    throw new Error(
      `T020b: fixture's sourceLayout for "${sourceId}" is a throw, not a value -- ` +
        'every one of the 9 legacy ids is expected to resolve a real layout (see the ' +
        'characterization gate test)',
    );
  }

  const { source } = loadSourceFile(join(sourcesDir, `${sourceId}.yml`));
  const generic = deriveSourceLayout(source, source.case);
  const genericReproducesLegacy = layoutsEqual(generic, fixtureEntry.sourceLayout.value);
  const hasOverride = Object.prototype.hasOwnProperty.call(overrides, sourceId);

  return { sourceId, genericReproducesLegacy, hasOverride };
}

describe('T020b guard: archiveLayoutOverride present ONLY where generic derivation differs (FR-007)', () => {
  it('sanity: the fixture and the production manifest were both actually loaded', () => {
    expect(FIXTURE.sources.length).toBeGreaterThan(0);
    expect(manifest.id).toBe('port-breton');
  });

  const analyses = LEGACY_SOURCE_IDS.map(analyze);

  it.each(analyses)(
    '$sourceId: override presence matches override necessity',
    ({ sourceId, genericReproducesLegacy, hasOverride }) => {
      if (genericReproducesLegacy) {
        expect(
          hasOverride,
          `${sourceId}: the generic derivation already reproduces the characterized legacy ` +
            'layout byte-identically, so its archiveLayoutOverrides entry in corpora/port-breton.yml ' +
            'is UNNECESSARY (FR-007) -- remove it',
        ).toBe(false);
      } else {
        expect(
          hasOverride,
          `${sourceId}: the generic derivation does NOT reproduce the characterized legacy ` +
            'layout, so corpora/port-breton.yml is MISSING an archiveLayoutOverrides entry for it ' +
            '(FR-007) -- without one, SC-001/INV-4 would fail for this source',
        ).toBe(true);
      }
    },
  );

  it('exactly the expected set of legacy sources needs an override (documents the current split)', () => {
    const necessary = analyses.filter((a) => !a.genericReproducesLegacy).map((a) => a.sourceId);
    // Not a duplicate of the per-id checks above: this pins the SHAPE of the
    // split (which ids, and how many) as one readable assertion, so a
    // reviewer sees the whole picture in one place instead of reconstructing
    // it from 9 pass/fail lines.
    expect(necessary.sort()).toEqual(['PB-P002', 'PB-P003']);
  });

  it('every declared override in corpora/port-breton.yml is accounted for by one of the 9 legacy ids', () => {
    // Guards the guard: if the manifest ever grows an override for a legacy
    // id NOT in LEGACY_SOURCE_IDS (a drift between this list and the T001
    // fixture's scope), that override would silently escape both checks
    // above. Every currently-declared override is, today, one of the 9.
    const declaredIds = Object.keys(overrides);
    const uncovered = declaredIds.filter((id) => !LEGACY_SOURCE_IDS.includes(id as never));
    expect(
      uncovered,
      `archiveLayoutOverrides declares an id outside the 9 legacy sources this guard checks: ` +
        `${uncovered.join(', ')} -- extend LEGACY_SOURCE_IDS or investigate why a NEW source needs ` +
        'an override the T001 fixture was never captured for',
    ).toEqual([]);
  });
});
