import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCoverageReport } from '@/bibliography/coverage/coverage-model';
import type { WorkBundleCoverage, CoverageInput } from '@/bibliography/coverage/coverage-model';
import { renderCoverage } from '@/bibliography/coverage/coverage-render';
import { loadAllSources } from '@/bibliography/load';
import { loadSearchLog } from '@/bibliography/search-log';

/**
 * The per-section computation over the `tests/fixtures/coverage` fixture
 * (T008/T010 per-work-bundle + per-work counting, T014/T016/T019 register,
 * T028 distribution, T025 search history, T022 gap semantics, T012
 * determinism). The fixture is loaded via the REAL loaders so these tests
 * exercise the same shapes the CLI passes in.
 */

const FIXTURE_ROOT = path.resolve(__dirname, '../../fixtures/coverage');

function loadFixtureInput(): CoverageInput {
  const sources = loadAllSources(path.join(FIXTURE_ROOT, 'sources'));
  const searchLog = loadSearchLog(path.join(FIXTURE_ROOT, 'search-log.yml'));
  return { sources, searchLog };
}

function workBundle(id: string): WorkBundleCoverage {
  const found = buildCoverageReport(loadFixtureInput()).perWorkBundle.find((c) => c.workBundle === id);
  if (found === undefined) {
    throw new Error(`fixture is missing expected work-bundle ${id}`);
  }
  return found;
}

describe('T008/T010 per-work-bundle lifecycle counts (per work, FR-014)', () => {
  it('buckets PB-P001 members by their own lifecycle state', () => {
    const pb001 = workBundle('PB-P001');
    // PB-P003 discovered, PB-P004 approved-for-acquisition, PB-P005 excluded.
    expect(pb001.membersByLifecycleState).toEqual([
      { state: 'approved-for-acquisition', count: 1 },
      { state: 'discovered', count: 1 },
      { state: 'excluded', count: 1 },
    ]);
  });

  it('counts a multi-archive member (PB-P004, two repositoryRecords) exactly ONCE (INV-3)', () => {
    const pb001 = workBundle('PB-P001');
    // actualMemberCount is a WORK count: 3 member Sources, not 4 copies.
    expect(pb001.actualMemberCount).toBe(3);
    const approved = pb001.membersByLifecycleState.find(
      (b) => b.state === 'approved-for-acquisition',
    );
    // PB-P004 has two RepositoryRecords but must contribute 1 to its lifecycle bucket.
    expect(approved).toEqual({ state: 'approved-for-acquisition', count: 1 });
    const total = pb001.membersByLifecycleState.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(pb001.actualMemberCount);
  });

  it('sorts lifecycle buckets deterministically by state name', () => {
    const states = workBundle('PB-P001').membersByLifecycleState.map((b) => b.state);
    expect(states).toEqual([...states].sort((a, b) => a.localeCompare(b)));
  });
});

describe('T022 gap semantics (knownMemberCount vs derived actual)', () => {
  it('renders a numeric gap when knownMemberCount is a number', () => {
    const pb001 = workBundle('PB-P001');
    expect(pb001.knownMemberCount).toBe(3);
    expect(pb001.gap).toBe(0); // 3 known - 3 actual
    expect(typeof pb001.gap).toBe('number');
  });

  it('keeps a numeric gap of 0 distinct from the literal unknown', () => {
    const pb002 = workBundle('PB-P002');
    expect(pb002.knownMemberCount).toBe('unknown');
    expect(pb002.gap).toBe('unknown');
    // Distinctness: PB-P001 gap is the NUMBER 0, PB-P002 gap is the STRING 'unknown'.
    expect(workBundle('PB-P001').gap).not.toBe('unknown');
  });

  it('renders the unknown gap as the literal word, never 0 or a percentage', () => {
    const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });
    expect(text).toContain('gap: unknown');
    expect(text).toContain('gap: 0'); // PB-P001's numeric zero gap
    expect(text).not.toContain('%');
  });
});

describe('T028/T014/T015 evidence-class distribution (FR-011, FR-008/INV-4)', () => {
  it('counts every WORK by class, with absent -> unclassified; source-groups excluded', () => {
    const report = buildCoverageReport(loadFixtureInput());
    // PB-P001/PB-P002 are source-groups (containers) and are excluded entirely
    // (FR-008/INV-4) -- only PB-P005 (a monograph with no evidenceClass) lands
    // in unclassified.
    expect(report.evidenceClassDistribution).toEqual([
      { class: 'book', count: 1 },
      { class: 'pamphlet', count: 1 },
      { class: 'prospectus', count: 1 },
      { class: 'newspaper', count: 1 },
      { class: 'trial-record', count: 1 },
      { class: 'unclassified', count: 1 },
    ]);
  });

  it('sums to the fetchable-work count, not the total source count (containers excluded)', () => {
    const report = buildCoverageReport(loadFixtureInput());
    const total = report.evidenceClassDistribution.reduce((sum, b) => sum + b.count, 0);
    const workCount = loadFixtureInput().sources.filter(
      (loaded) => loaded.source.kind !== 'source-group',
    ).length;
    expect(total).toBe(workCount);
    // Sanity: the fixture has 2 source-groups (PB-P001, PB-P002) among 8 sources.
    expect(total).toBe(loadFixtureInput().sources.length - 2);
  });
});

describe('T014/T016/T019 unresolved-references register (FR-012)', () => {
  it('groups an unresolved member reference under its work-bundle', () => {
    const report = buildCoverageReport(loadFixtureInput());
    const pb001 = report.register.byWorkBundle.find((b) => b.workBundle === 'PB-P001');
    const references = pb001?.entries.filter((e) => e.kind === 'reference') ?? [];
    expect(references).toContainEqual({
      kind: 'reference',
      citedAs: 'Unknown Journal Reference',
      basis: 'Citation found in foreword but journal not yet identified',
      owner: 'PB-P004',
    });
  });

  it('omits a RESOLVED reference (has resolvedTo) from the register', () => {
    const report = buildCoverageReport(loadFixtureInput());
    const everyEntry = [
      ...report.register.byWorkBundle.flatMap((b) => b.entries),
      ...report.register.ungrouped,
    ];
    // PB-P004 + PB-P007 both cite the resolved "Prospectus"/"Campaign Prospectus" (resolvedTo PB-P008).
    expect(everyEntry.some((e) => e.citedAs === 'Prospectus of the Campaign')).toBe(false);
    expect(everyEntry.some((e) => e.citedAs === 'Campaign Prospectus')).toBe(false);
  });

  it('places a standalone (no-partOf) source reference in the ungrouped bucket', () => {
    const report = buildCoverageReport(loadFixtureInput());
    expect(report.register.ungrouped).toEqual([
      {
        kind: 'reference',
        citedAs: 'Private Letter to the Governor',
        basis: 'quoted in the text but source not yet located',
        owner: 'PB-P007',
      },
    ]);
  });

  it('surfaces a suspected gap under its work-bundle with basis', () => {
    const report = buildCoverageReport(loadFixtureInput());
    const pb001 = report.register.byWorkBundle.find((b) => b.workBundle === 'PB-P001');
    const suspected = pb001?.entries.filter((e) => e.kind === 'suspected') ?? [];
    expect(suspected).toContainEqual({
      kind: 'suspected',
      description: 'Suspected private correspondence regarding the campaign',
      basis: 'Referenced indirectly in acquired members; location and archive status unknown',
      owner: 'PB-P001',
    });
  });

  it('leaves a work-bundle with no unresolved refs or suspected gaps empty', () => {
    const report = buildCoverageReport(loadFixtureInput());
    const pb002 = report.register.byWorkBundle.find((b) => b.workBundle === 'PB-P002');
    expect(pb002?.entries).toEqual([]);
  });
});

describe('T023 suspected-lead resolution (specs/011 SC-004)', () => {
  function suspectedByDescription(description: string) {
    const report = buildCoverageReport(loadFixtureInput());
    const pb001 = report.register.byWorkBundle.find((b) => b.workBundle === 'PB-P001');
    const entry = pb001?.entries.find(
      (e) => e.kind === 'suspected' && e.description === description,
    );
    if (entry === undefined) {
      throw new Error(`fixture is missing expected suspected entry "${description}"`);
    }
    return entry;
  }

  it('carries an absent resolution through unchanged (renders as unexamined, today\'s behavior)', () => {
    const entry = suspectedByDescription('Suspected private correspondence regarding the campaign');
    expect(entry.resolution).toBeUndefined();
  });

  it('carries an identified resolution through with its candidate', () => {
    const entry = suspectedByDescription('Suspected court filing referenced by a witness deposition');
    expect(entry.resolution).toEqual({
      state: 'identified',
      candidate: 'Archive C, folder 12, item 4 (uninventoried)',
      resolvedAt: '2026-07-02',
    });
  });

  it('carries an inventoried resolution through with its sourceId', () => {
    const entry = suspectedByDescription('Suspected companion pamphlet to the prospectus');
    expect(entry.resolution).toEqual({
      state: 'inventoried',
      sourceId: 'PB-P008',
      resolvedAt: '2026-07-03',
    });
  });

  it('carries an excluded resolution through with its reason', () => {
    const entry = suspectedByDescription('Suspected second printing of the prospectus');
    expect(entry.resolution).toEqual({
      state: 'excluded',
      reason: 'Turned out to be a reprint of PB-P008, not a distinct work',
      resolvedAt: '2026-07-04',
    });
  });

  it('carries an unavailable resolution through with its reason', () => {
    const entry = suspectedByDescription('Suspected diary of a campaign participant');
    expect(entry.resolution).toEqual({
      state: 'unavailable',
      reason: 'Family declined to make the diary available for research',
      resolvedAt: '2026-07-05',
    });
  });

  it('renders an unexamined (or absent-resolution) lead as a plain open bullet, unchanged', () => {
    const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });
    const line = text
      .split('\n')
      .find((l) => l.includes('Suspected private correspondence regarding the campaign'));
    expect(line).toBe(
      '      - Suspected private correspondence regarding the campaign' +
        ' (basis: Referenced indirectly in acquired members; location and archive status unknown)',
    );
  });

  it('renders an identified lead distinctly, referencing its candidate, not as an open bullet', () => {
    const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });
    expect(text).toContain(
      '- Suspected court filing referenced by a witness deposition' +
        ' (basis: A candidate repository record was located but not yet inventoried as a Source)' +
        '  [identified: candidate Archive C, folder 12, item 4 (uninventoried) (2026-07-02)]',
    );
  });

  it('renders an inventoried lead referencing its resolved Source id', () => {
    const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });
    expect(text).toContain('[resolved: inventoried as PB-P008 (2026-07-03)]');
  });

  it('renders an excluded lead showing its reason', () => {
    const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });
    expect(text).toContain(
      '[resolved: excluded -- Turned out to be a reprint of PB-P008, not a distinct work (2026-07-04)]',
    );
  });

  it('renders an unavailable lead showing its reason', () => {
    const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });
    expect(text).toContain(
      '[resolved: unavailable -- Family declined to make the diary available for research (2026-07-05)]',
    );
  });

  it('counts ONLY the unexamined lead as open, not the four resolved leads (SC-004)', () => {
    const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });
    // PB-P001 has 5 suspected leads: 1 unexamined (open), 4 resolved (not open).
    expect(text).toContain('PB-P001:  (open: 1 / total: 5)');
  });
});

describe('T025/T019 search history (FR-013/FR-009): matrix keyed + labeled per resolved scope', () => {
  it('builds one matrix cell per (repository, scope), each scope kind-labeled', () => {
    const report = buildCoverageReport(loadFixtureInput());
    // Spec 010 (T019): the matrix scope axis is now the KIND-LABELED scope
    // (`work-bundle PB-P001`), not the retired bare per-campaign id.
    expect(report.searchHistory.matrix).toEqual([
      {
        repository: 'Fixture Archive A',
        scope: 'work-bundle PB-P001',
        lastSearched: '2026-07-01',
        openQuestions: [
          'Whereabouts of the suspected private correspondence?',
          'Any additional unknown members not yet catalogued?',
        ],
      },
      {
        repository: 'Fixture Archive B',
        scope: 'work-bundle PB-P001',
        lastSearched: '2026-07-05',
        openQuestions: ['Are there digitised versions available?'],
      },
      {
        repository: 'Fixture Archive C',
        scope: 'work-bundle PB-P002',
        lastSearched: '2026-07-08',
        openQuestions: [],
      },
    ]);
  });

  it('rolls up per resolved scope with search-evidence-based measured closure (FR-012)', () => {
    const report = buildCoverageReport(loadFixtureInput());
    expect(report.searchHistory.byScope).toEqual([
      {
        scope: 'work-bundle PB-P001',
        lastSearched: '2026-07-05',
        openQuestions: [
          'Whereabouts of the suspected private correspondence?',
          'Any additional unknown members not yet catalogued?',
          'Are there digitised versions available?',
        ],
        measuredClosure: 'open',
      },
      {
        scope: 'work-bundle PB-P002',
        lastSearched: '2026-07-08',
        openQuestions: [],
        measuredClosure: 'closed',
      },
    ]);
  });

  it('rolls up each repository across all its work-bundles', () => {
    const report = buildCoverageReport(loadFixtureInput());
    expect(report.searchHistory.byRepository).toEqual([
      {
        repository: 'Fixture Archive A',
        lastSearched: '2026-07-01',
        openQuestions: [
          'Whereabouts of the suspected private correspondence?',
          'Any additional unknown members not yet catalogued?',
        ],
      },
      {
        repository: 'Fixture Archive B',
        lastSearched: '2026-07-05',
        openQuestions: ['Are there digitised versions available?'],
      },
      {
        repository: 'Fixture Archive C',
        lastSearched: '2026-07-08',
        openQuestions: [],
      },
    ]);
  });
});

describe('T012 determinism (SC-004)', () => {
  it('produces identical report + render across two runs over the same input', () => {
    const firstReport = buildCoverageReport(loadFixtureInput());
    const secondReport = buildCoverageReport(loadFixtureInput());
    expect(firstReport).toEqual(secondReport);

    expect(renderCoverage(firstReport, { json: true })).toBe(
      renderCoverage(secondReport, { json: true }),
    );
    expect(renderCoverage(firstReport, { json: false })).toBe(
      renderCoverage(secondReport, { json: false }),
    );
  });

  it('renders the multi-archive member and suspected gap in the text output', () => {
    const text = renderCoverage(buildCoverageReport(loadFixtureInput()), { json: false });
    // PB-P004's unresolved reference, attributed to its citing source.
    expect(text).toContain('Unknown Journal Reference');
    expect(text).toContain('[cited in PB-P004]');
    // The suspected sub-listing.
    expect(text).toContain('  suspected:');
    expect(text).toContain('Suspected private correspondence regarding the campaign');
    // No headline percentage anywhere (INV-1).
    expect(text).not.toContain('%');
  });
});
