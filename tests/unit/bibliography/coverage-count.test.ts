import { describe, expect, it } from 'vitest';

import { buildCoverageReport } from '@/bibliography/coverage/coverage-model';
import type { CoverageInput } from '@/bibliography/coverage/coverage-model';
import type { Source } from '@/model/source';

/**
 * T014/T015 (specs/010-corpus-model-coherence, US2/FR-008): the evidence-class
 * distribution counts WORKS ONLY -- a `kind: source-group` container is
 * excluded from the distribution entirely (contracts/scope-model.md INV-4,
 * INV-COUNT). A container MUST NOT appear as `unclassified` and MUST NOT be
 * counted as a work.
 */

/** Minimal well-formed Source fixture; mirrors tests/unit/bibliography/scope.test.ts. */
function makeSource(
  sourceId: string,
  kind: Source['kind'],
  evidenceClass?: Source['evidenceClass'],
): Source {
  return {
    sourceId,
    titles: [{ text: `title for ${sourceId}`, role: 'canonical' }],
    kind,
    identifiers: [],
    evidenceClass,
  };
}

function loadedInput(sources: readonly Source[]): CoverageInput {
  return {
    sources: sources.map((source) => ({ source, records: [], identifierLeaks: [] })),
    searchLog: [],
  };
}

describe('T014/T015 evidence-class distribution counts works only (FR-008, INV-4)', () => {
  it('excludes source-groups entirely: unclassified reaches 0 when every work is classified', () => {
    const sources: Source[] = [
      makeSource('PB-P001', 'source-group'), // container, no evidenceClass
      makeSource('PB-P002', 'source-group'), // container, no evidenceClass
      makeSource('PB-P003', 'monograph', 'pamphlet'),
      makeSource('PB-P004', 'monograph', 'book'),
      makeSource('PB-P005', 'periodical', 'newspaper'),
    ];

    const report = buildCoverageReport(loadedInput(sources));

    expect(report.evidenceClassDistribution).toEqual([
      { class: 'book', count: 1 },
      { class: 'pamphlet', count: 1 },
      { class: 'newspaper', count: 1 },
    ]);
    const unclassified = report.evidenceClassDistribution.find((b) => b.class === 'unclassified');
    expect(unclassified).toBeUndefined();
  });

  it('does not report a container as unclassified, and does not count it as a work', () => {
    const sources: Source[] = [
      makeSource('PB-P001', 'source-group'), // no evidenceClass -- must not land in unclassified
      makeSource('PB-P003', 'monograph', 'pamphlet'),
      makeSource('PB-P005', 'monograph'), // no evidenceClass -- IS a work, must be unclassified
    ];

    const report = buildCoverageReport(loadedInput(sources));

    expect(report.evidenceClassDistribution).toEqual([
      { class: 'pamphlet', count: 1 },
      { class: 'unclassified', count: 1 },
    ]);
    const total = report.evidenceClassDistribution.reduce((sum, b) => sum + b.count, 0);
    // Only the 2 works are counted -- the 1 source-group is excluded.
    expect(total).toBe(2);
  });
});
