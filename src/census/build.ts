import type { Census, CensusIssue } from '@/model/census';
import type { GallicaClient } from '@/gallica/gallica-client';
import { normalizeFrenchDate } from '@/census/date';

/**
 * Build a {@link Census} for a periodical: enumerate every issue across all
 * years, normalize each human date to `YYYY-MM-DD`, resolve each issue's page
 * count, and return the issues sorted ascending by date.
 *
 * `builtAt` is passed in (never read from the wall clock here) so runs are
 * reproducible and testable -- the caller stamps it (see data-model.md §
 * Census).
 *
 * Fails loud (via the client and the date normalizer) on any malformed or
 * missing host data -- no fallback, no partial census.
 */
export async function buildCensus(
  periodicalArk: string,
  client: GallicaClient,
  sourceId: string,
  builtAt: string,
): Promise<Census> {
  if (sourceId.trim().length === 0) {
    throw new Error('buildCensus: sourceId is required');
  }
  if (builtAt.trim().length === 0) {
    throw new Error('buildCensus: builtAt is required');
  }

  const enumeration = await client.issues(periodicalArk);

  const issues: CensusIssue[] = [];
  for (const ref of enumeration.issues) {
    const date = normalizeFrenchDate(ref.label);
    const pageCount = await client.pagination(ref.ark);
    issues.push({
      ark: ref.ark,
      date,
      label: ref.label,
      pageCount,
    });
  }

  issues.sort(compareIssues);

  return {
    sourceId,
    gallicaArk: periodicalArk,
    builtAt,
    totalIssues: enumeration.totalIssues,
    issues,
  };
}

/** Ascending by date, then ark, for a fully deterministic order. */
export function compareIssues(a: CensusIssue, b: CensusIssue): number {
  if (a.date !== b.date) {
    return a.date < b.date ? -1 : 1;
  }
  if (a.ark !== b.ark) {
    return a.ark < b.ark ? -1 : 1;
  }
  return 0;
}
