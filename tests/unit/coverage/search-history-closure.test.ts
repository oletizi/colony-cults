import { describe, expect, it } from 'vitest';

import { buildSearchHistory } from '@/bibliography/coverage/coverage-history';
import type { SearchLogEntry } from '@/bibliography/search-log';

/**
 * Closure semantics for search-history open questions (review fix): a question
 * recorded by an early search and omitted by a later search for the same
 * (repository, campaign) is CLOSED -- `openQuestions` reflects the latest
 * entry, not a union across all history. The repository rollup unions each
 * campaign's CURRENT open questions.
 */

function entry(overrides: Partial<SearchLogEntry> & Pick<SearchLogEntry, 'id' | 'date'>): SearchLogEntry {
  return {
    repository: 'State Library of Queensland',
    campaign: 'PB-P004',
    scope: 'scope',
    coverage: 'coverage',
    ...overrides,
  };
}

describe('buildSearchHistory open-question closure', () => {
  it('drops a question a later search omits (resolved) for the same repo x campaign', () => {
    const log = [
      entry({ id: 'SRCH-0001', date: '2026-01-01', remainingQuestions: ['Were appeal records digitized?'] }),
      entry({ id: 'SRCH-0002', date: '2026-02-01', remainingQuestions: [] }),
    ];
    const { matrix } = buildSearchHistory(log);
    expect(matrix).toHaveLength(1);
    expect(matrix[0]?.lastSearched).toBe('2026-02-01');
    expect(matrix[0]?.openQuestions).toEqual([]);
  });

  it('keeps only the latest entry questions, not a union of all history', () => {
    const log = [
      entry({ id: 'SRCH-0001', date: '2026-01-01', remainingQuestions: ['Q1'] }),
      entry({ id: 'SRCH-0002', date: '2026-02-01', remainingQuestions: ['Q2'] }),
    ];
    const { matrix } = buildSearchHistory(log);
    expect(matrix[0]?.openQuestions).toEqual(['Q2']);
  });

  it('repository rollup unions each campaign latest open questions', () => {
    const log = [
      entry({ id: 'A', date: '2026-01-01', campaign: 'PB-P004', remainingQuestions: ['Q-P004'] }),
      entry({ id: 'B', date: '2026-01-01', campaign: 'PB-P010', remainingQuestions: ['Q-P010'] }),
    ];
    const { byRepository } = buildSearchHistory(log);
    expect(byRepository).toHaveLength(1);
    expect(byRepository[0]?.openQuestions.sort()).toEqual(['Q-P004', 'Q-P010']);
  });

  it('a question closed in a campaign latest search is closed in the repository rollup too', () => {
    const log = [
      entry({ id: 'A1', date: '2026-01-01', campaign: 'PB-P004', remainingQuestions: ['Q-P004'] }),
      entry({ id: 'A2', date: '2026-02-01', campaign: 'PB-P004', remainingQuestions: [] }),
      entry({ id: 'B1', date: '2026-01-01', campaign: 'PB-P010', remainingQuestions: ['Q-P010'] }),
    ];
    const { byRepository } = buildSearchHistory(log);
    expect(byRepository[0]?.openQuestions).toEqual(['Q-P010']);
    expect(byRepository[0]?.lastSearched).toBe('2026-02-01');
  });
});
