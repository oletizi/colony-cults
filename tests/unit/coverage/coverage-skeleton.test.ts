import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCoverageReport } from '@/bibliography/coverage/coverage-model';
import type { CoverageInput, CoverageReport } from '@/bibliography/coverage/coverage-model';
import { renderCoverage } from '@/bibliography/coverage/coverage-render';
import { loadAllSources } from '@/bibliography/load';
import { loadSearchLog } from '@/bibliography/search-log';

/**
 * T007 skeleton proof: the pure {@link buildCoverageReport} projects the loaded
 * model into a fully-shaped {@link CoverageReport} whose every section is
 * present (empty in the skeleton), and {@link renderCoverage} prints every
 * section header in both text and JSON forms while upholding INV-1 (no headline
 * `%`). It deliberately does NOT assert per-work-bundle counts / distribution /
 * register population / search history -- those are T010/T028/T016/T019/T025 and
 * fail their own RED tests until implemented.
 */

const FIXTURE_ROOT = path.resolve(__dirname, '../../fixtures/coverage');

/** Load the fixture bibliography via the REAL loaders, then bundle for the pure builder. */
function loadFixtureInput(): CoverageInput {
  const sources = loadAllSources(path.join(FIXTURE_ROOT, 'sources'));
  const searchLog = loadSearchLog(path.join(FIXTURE_ROOT, 'search-log.yml'));
  return { sources, searchLog };
}

/** The source-group ids in the fixture (the work-bundles the report projects one entry each for). */
const FIXTURE_WORK_BUNDLES = ['PB-P001', 'PB-P002'];

describe('T007 coverage skeleton: buildCoverageReport', () => {
  it('produces one WorkBundleCoverage per source-group', () => {
    const report = buildCoverageReport(loadFixtureInput());
    expect(report.perWorkBundle.map((c) => c.workBundle)).toEqual(FIXTURE_WORK_BUNDLES);
  });

  it('shapes every section (top-level keys present, fixed order)', () => {
    const report: CoverageReport = buildCoverageReport(loadFixtureInput());

    // Top-level section keys all present, in the fixed order the JSON render relies on.
    expect(Object.keys(report)).toEqual([
      'perWorkBundle',
      'evidenceClassDistribution',
      'register',
      'searchHistory',
    ]);

    // Every WorkBundleCoverage carries the full field shape.
    for (const workBundle of report.perWorkBundle) {
      expect(Object.keys(workBundle)).toEqual([
        'workBundle',
        'membersByLifecycleState',
        'actualMemberCount',
        'knownMemberCount',
        'gap',
      ]);
    }

    // The register seeds one bucket per work-bundle, in work-bundle order.
    expect(report.register.byWorkBundle.map((b) => b.workBundle)).toEqual(FIXTURE_WORK_BUNDLES);
  });

  it('is total over an empty corpus (no throw, all-empty report)', () => {
    const report = buildCoverageReport({ sources: [], searchLog: [] });
    expect(report.perWorkBundle).toEqual([]);
    expect(report.register.byWorkBundle).toEqual([]);
  });
});

describe('T007 coverage skeleton: renderCoverage text', () => {
  const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });

  it('prints every section header', () => {
    expect(text).toContain('Per-work-bundle counts:');
    expect(text).toContain('Evidence classes:');
    expect(text).toContain('Unresolved references:');
    expect(text).toContain('[no work-bundle]:');
    expect(text).toContain('Search history:');
    expect(text).toContain('Repository rollup:');
  });

  it('renders empty sections cleanly with (none)', () => {
    expect(text).toContain('(none)');
  });

  it('emits no headline percentage anywhere (INV-1)', () => {
    expect(text).not.toContain('%');
  });

  it('renders unknown gap/denominator as the literal unknown (INV-2)', () => {
    expect(text).toContain('believed extent (knownMemberCount): unknown');
    expect(text).toContain('gap: unknown');
  });
});

describe('T007 coverage skeleton: renderCoverage json', () => {
  it('is valid JSON carrying the same section keys', () => {
    const report = buildCoverageReport(loadFixtureInput());
    const json = renderCoverage(report, { json: true });
    const parsed: unknown = JSON.parse(json);
    expect(parsed).toEqual(report);
  });

  it('is deterministic across two calls', () => {
    const report = buildCoverageReport(loadFixtureInput());
    const first = renderCoverage(report, { json: true });
    const second = renderCoverage(report, { json: true });
    expect(first).toBe(second);
  });
});
