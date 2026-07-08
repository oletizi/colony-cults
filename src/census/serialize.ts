import type { Census, CensusIssue } from '@/model/census';
import { compareIssues } from '@/census/build';

/**
 * Deterministic JSON serialization of a {@link Census} (FR-002).
 *
 * Guarantees:
 * - keys emitted in an EXPLICIT fixed order (see the `*_KEY_ORDER` arrays
 *   below) -- not left to JS object insertion order;
 * - `issues` sorted ascending by date (then ark);
 * - 2-space indent, exactly one trailing newline.
 *
 * Re-serializing identical data yields byte-identical output.
 */

/** Census top-level keys, in emission order. */
const CENSUS_KEY_ORDER = [
  'sourceId',
  'gallicaArk',
  'builtAt',
  'totalIssues',
  'issues',
] as const;

/** Per-issue keys, in emission order. */
const ISSUE_KEY_ORDER = ['ark', 'date', 'label', 'pageCount'] as const;

/** Build an object whose keys are assigned in the explicit issue order. */
function orderedIssue(issue: CensusIssue): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of ISSUE_KEY_ORDER) {
    ordered[key] = issue[key];
  }
  return ordered;
}

/** Build an object whose keys are assigned in the explicit census order. */
function orderedCensus(census: Census): Record<string, unknown> {
  const sortedIssues = [...census.issues]
    .sort(compareIssues)
    .map(orderedIssue);

  const ordered: Record<string, unknown> = {};
  for (const key of CENSUS_KEY_ORDER) {
    ordered[key] = key === 'issues' ? sortedIssues : census[key];
  }
  return ordered;
}

export function serializeCensus(census: Census): string {
  return `${JSON.stringify(orderedCensus(census), null, 2)}\n`;
}
