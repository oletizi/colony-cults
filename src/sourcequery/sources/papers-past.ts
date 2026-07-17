/**
 * Papers Past SourceConfig (Phase 1, T016, research R3).
 *
 * Registers `paperspast.natlib.govt.nz/newspapers` as the first live
 * reference source. `resultSelector` and `parseSummary` are validated ONLY
 * against the synthetic fixture in `tests/unit/sourcequery/papers-past.test.ts`;
 * live validation against real markup is an env-gated smoke test, out of
 * this task's scope. Treat `RESULT_SELECTOR` as PROVISIONAL until that smoke
 * run confirms it.
 *
 * NOTE on the import below: `SourceConfig` is imported type-only so this
 * module has no runtime dependency on `@/sourcequery/source-config` (the
 * type import is erased by the compiler). `source-config.ts` imports this
 * module's `PAPERS_PAST` value at its own bottom to auto-register it, so a
 * value-level import here would create a runtime circular dependency.
 */

import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/source-config';
import type { Candidate, QuerySummary } from '@/sourcequery/types';
import { parse } from 'node-html-parser';

/** PROVISIONAL: validated against the synthetic fixture only (see file header). */
const RESULT_SELECTOR = '.search-results .result';
const COUNT_SELECTOR = '.results-count';

/** Builds the Papers Past newspapers search URL for a query, optionally paged. */
function buildQueryUrl(query: string, page?: number): string {
  const base = `https://paperspast.natlib.govt.nz/newspapers?query=${encodeURIComponent(query)}`;
  return page !== undefined && page > 1 ? `${base}&page=${page}` : base;
}

/**
 * Extracts the plain-digit result count from the `.results-count` element.
 * Throws (fail-loud, Principle V) rather than guessing when the count
 * element or a digit sequence within it is absent, or when the parsed count
 * cannot be found literally in the HTML bytes (grounding, FR-007).
 */
function parseCount(html: string, root: ReturnType<typeof parse>): number {
  const countEl = root.querySelector(COUNT_SELECTOR);
  if (!countEl) {
    throw new Error(
      `papers-past parseSummary: no element matching "${COUNT_SELECTOR}" found; cannot determine result count.`
    );
  }
  const match = countEl.text.match(/\d+/);
  if (!match) {
    throw new Error(
      `papers-past parseSummary: no digit sequence found in count element text "${countEl.text}".`
    );
  }
  const count = Number.parseInt(match[0], 10);
  if (!html.includes(String(count))) {
    throw new Error(
      `papers-past parseSummary: ungrounded count "${count}" - its String(count) form is not a ` +
        `literal substring of the parsed HTML.`
    );
  }
  return count;
}

/**
 * Extracts first-page candidates from result rows. Throws (fail-loud) when a
 * row is missing its title/ref link, rather than silently dropping the row.
 */
function parseCandidates(root: ReturnType<typeof parse>): Candidate[] {
  const rows = root.querySelectorAll(RESULT_SELECTOR);
  return rows.map((row): Candidate => {
    const link = row.querySelector('a');
    if (!link) {
      throw new Error('papers-past parseSummary: result row is missing its title/ref <a> link.');
    }
    const ref = link.getAttribute('href');
    if (!ref) {
      throw new Error('papers-past parseSummary: result link is missing an href.');
    }
    const title = link.text.trim();
    const dateEl = row.querySelector('.result-date');
    const date = dateEl ? dateEl.text.trim() : undefined;
    return date === undefined ? { title, ref } : { title, ref, date };
  });
}

/** Parses total count + first-page candidates from a persisted Papers Past results page. */
function parseSummary(html: string): QuerySummary {
  const root = parse(html);
  const count = parseCount(html, root);
  const candidates = parseCandidates(root);
  return { count, candidates };
}

export const PAPERS_PAST: SourceConfig = {
  id: 'papers-past',
  baseUrl: 'https://paperspast.natlib.govt.nz',
  buildQueryUrl,
  resultSelector: RESULT_SELECTOR,
  parseSummary,
  retention: 'persist',
  attribution: '',
  preferredGeo: 'NZ',
  minIntervalMs: 1000,
  grace: DEFAULT_GRACE,
};
