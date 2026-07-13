import { describe, expect, it } from 'vitest';

import { buildCoverageReport } from '@/bibliography/coverage/coverage-model';
import type { CoverageInput } from '@/bibliography/coverage/coverage-model';
import { renderCoverage } from '@/bibliography/coverage/coverage-render';
import type { SearchLogEntry } from '@/bibliography/search-log';
import type { Source } from '@/model/source';

/**
 * T018/T019 (specs/010-corpus-model-coherence, US4/FR-009/FR-012): `bib
 * coverage` reports search history PER RESOLVED SCOPE, each scope LABELED by
 * its kind + id (`work-bundle PB-P004`, `work PB-P001`, never a bare id), and
 * EVERY persisted `ScopeRef` is resolved fail-loud (INV-SCOPE) -- an
 * unresolved / kind-mismatched ref makes the report throw, never silently
 * drops or mislabels it. See contracts/scope-model.md § INV-SCOPE / INV-CLOSURE.
 */

/** Minimal well-formed Source fixture; mirrors tests/unit/bibliography/coverage-count.test.ts. */
function makeSource(sourceId: string, kind: Source['kind']): Source {
  return {
    sourceId,
    titles: [{ text: `title for ${sourceId}`, role: 'canonical' }],
    kind,
    identifiers: [],
  };
}

/** Bundle in-memory Sources + a search log into the pure builder's input. */
function input(sources: readonly Source[], searchLog: readonly SearchLogEntry[]): CoverageInput {
  return {
    sources: sources.map((source) => ({ source, records: [], identifierLeaks: [] })),
    searchLog,
    threadIds: new Set<string>(),
  };
}

/** One well-formed search-log entry over `scope`. */
function search(
  id: string,
  scope: SearchLogEntry['scope'],
  overrides: Partial<SearchLogEntry> = {},
): SearchLogEntry {
  return {
    id,
    date: '2026-07-01',
    repository: 'State Library of Queensland',
    scope,
    query: 'query',
    coverage: 'coverage',
    ...overrides,
  };
}

describe('T018/T019 bib coverage per resolved scope (FR-009, INV-SCOPE)', () => {
  it('groups + labels search history by scope kind (a work-bundle AND a work, both kind-labeled)', () => {
    const sources = [
      makeSource('PB-P004', 'source-group'), // a work-bundle
      makeSource('PB-P001', 'monograph'), // a fetchable work
    ];
    const log = [
      search('SRCH-0001', { kind: 'work-bundle', id: 'PB-P004' }),
      search('SRCH-0002', { kind: 'work', id: 'PB-P001' }),
    ];

    const report = buildCoverageReport(input(sources, log));

    const matrixScopes = report.searchHistory.matrix.map((cell) => cell.scope);
    expect(matrixScopes).toContain('work-bundle PB-P004');
    expect(matrixScopes).toContain('work PB-P001');
    // A bare id is NEVER a scope label on its own -- the kind prefix is always present.
    expect(matrixScopes).not.toContain('PB-P004');
    expect(matrixScopes).not.toContain('PB-P001');

    const byScope = report.searchHistory.byScope.map((s) => s.scope);
    expect(byScope).toContain('work-bundle PB-P004');
    expect(byScope).toContain('work PB-P001');

    // Both kind labels appear in the rendered text report.
    const text = renderCoverage(report, { json: false });
    expect(text).toContain('work-bundle PB-P004');
    expect(text).toContain('work PB-P001');
  });

  it('measured closure is search-evidence-based, not acquisition-based (FR-012/INV-CLOSURE)', () => {
    const sources = [makeSource('PB-P004', 'source-group')];
    const log = [
      search('SRCH-0001', { kind: 'work-bundle', id: 'PB-P004' }, {
        remainingQuestions: ['appeal-court records not searched'],
      }),
    ];

    const report = buildCoverageReport(input(sources, log));
    const scope = report.searchHistory.byScope.find((s) => s.scope === 'work-bundle PB-P004');
    // A search leaving open questions -> the scope is measured OPEN, regardless
    // of any acquisition state (closure keys off search evidence only).
    expect(scope?.measuredClosure).toBe('open');
    expect(scope?.openQuestions).toEqual(['appeal-court records not searched']);
  });

  it('throws (fails loud) on a persisted ScopeRef that does not resolve under its kind (INV-SCOPE)', () => {
    const sources = [makeSource('PB-P004', 'source-group')];
    // A `work` ref pointing at a source-group id is a kind/referent mismatch.
    const mismatched = [search('SRCH-0001', { kind: 'work', id: 'PB-P004' })];
    expect(() => buildCoverageReport(input(sources, mismatched))).toThrow(/PB-P004/);

    // A ref whose id resolves to no Source at all is likewise fail-loud.
    const missing = [search('SRCH-0001', { kind: 'work-bundle', id: 'PB-P999' })];
    expect(() => buildCoverageReport(input(sources, missing))).toThrow(/PB-P999/);
  });
});
