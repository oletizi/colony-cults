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
 * `%`). It deliberately does NOT assert per-campaign counts / distribution /
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

/** The source-group ids in the fixture (the campaigns the report projects one entry each for). */
const FIXTURE_CAMPAIGNS = ['PB-P001', 'PB-P002'];

describe('T007 coverage skeleton: buildCoverageReport', () => {
  it('produces one CampaignCoverage per source-group', () => {
    const report = buildCoverageReport(loadFixtureInput());
    expect(report.perCampaign.map((c) => c.campaign)).toEqual(FIXTURE_CAMPAIGNS);
  });

  it('shapes every section (present, deterministically empty in the skeleton)', () => {
    const report: CoverageReport = buildCoverageReport(loadFixtureInput());

    // Top-level section keys all present.
    expect(Object.keys(report)).toEqual([
      'perCampaign',
      'evidenceClassDistribution',
      'register',
      'searchHistory',
    ]);

    // Each CampaignCoverage carries the full shape with skeleton placeholders.
    for (const campaign of report.perCampaign) {
      expect(campaign.membersByLifecycleState).toEqual([]);
      expect(campaign.actualMemberCount).toBe(0);
      expect(campaign.knownMemberCount).toBe('unknown');
      expect(campaign.gap).toBe('unknown');
    }

    // Distribution + search history empty; register seeds one empty bucket per campaign.
    expect(report.evidenceClassDistribution).toEqual([]);
    expect(report.register.ungrouped).toEqual([]);
    expect(report.register.byCampaign.map((b) => b.campaign)).toEqual(FIXTURE_CAMPAIGNS);
    for (const bucket of report.register.byCampaign) {
      expect(bucket.entries).toEqual([]);
    }
    expect(report.searchHistory.matrix).toEqual([]);
    expect(report.searchHistory.byRepository).toEqual([]);
  });

  it('is total over an empty corpus (no throw, all-empty report)', () => {
    const report = buildCoverageReport({ sources: [], searchLog: [] });
    expect(report.perCampaign).toEqual([]);
    expect(report.register.byCampaign).toEqual([]);
  });
});

describe('T007 coverage skeleton: renderCoverage text', () => {
  const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });

  it('prints every section header', () => {
    expect(text).toContain('Per-campaign counts:');
    expect(text).toContain('Evidence classes:');
    expect(text).toContain('Unresolved references:');
    expect(text).toContain('[no campaign]:');
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
