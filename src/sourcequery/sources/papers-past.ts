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
 * NOTE on the imports below: this module has NO runtime dependency on
 * `@/sourcequery/source-config`. `SourceConfig` is imported from it type-only
 * (erased by the compiler), and the one value it needs, `DEFAULT_GRACE`, comes
 * from the leaf `@/sourcequery/grace` module instead. This matters because
 * `source-config.ts` value-imports this module's `PAPERS_PAST` at its own
 * bottom to auto-register it; a value-level import back into `source-config`
 * here would create a runtime circular dependency. Pulling `DEFAULT_GRACE`
 * from `grace` (which depends only on `types`) keeps that cycle broken.
 */

import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/grace';
import { isCountGrounded } from '@/sourcequery/grounding';
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
 * A number token: a comma-grouped total (`12,345`) or a plain digit run (`42`).
 * Papers Past renders NZ-locale comma grouping; the pattern accepts both.
 */
const NUMBER_TOKEN = '\\d{1,3}(?:,\\d{3})+|\\d+';

/**
 * Selects the TOTAL result count from the `.results-count` element text,
 * robustly across the shapes Papers Past can render:
 *   "42 results"                  -> 42        (single number)
 *   "12,345 results"              -> 12345     (comma-grouped total)
 *   "1 - 10 of 12,345 results"    -> 12345     (range prefix; total follows "of")
 *   "1 - 10 results"              -> THROW     (a page range with no total —
 *                                               refuse to guess which number is
 *                                               the total; fail-loud, Principle V)
 * A naive "first digit run" read returns `1` for the range shape (the range
 * START, not the total) and grounds spuriously — the silent-wrong-data bug this
 * guards against.
 */
function selectTotalCount(text: string): number {
  // Prefer an explicit total after "of" (the range-prefix shape).
  const ofMatch = text.match(new RegExp(`\\bof\\s+(${NUMBER_TOKEN})`, 'i'));
  if (ofMatch) {
    return Number.parseInt(ofMatch[1].replace(/,/g, ''), 10);
  }
  const tokens = text.match(new RegExp(NUMBER_TOKEN, 'g'));
  if (!tokens || tokens.length === 0) {
    throw new Error(
      `papers-past parseSummary: no digit sequence found in count element text "${text}".`
    );
  }
  if (tokens.length > 1) {
    throw new Error(
      `papers-past parseSummary: ambiguous count text "${text}" — multiple numbers and no ` +
        `"of <total>" disambiguator; refusing to guess which is the total (fail-loud).`
    );
  }
  return Number.parseInt(tokens[0].replace(/,/g, ''), 10);
}

/**
 * Extracts the result count from the `.results-count` element (see
 * {@link selectTotalCount} for the shapes handled). Throws (fail-loud,
 * Principle V) when the count element is absent, no digit sequence is present,
 * the count text is ambiguous, or the parsed count is not traceable in the HTML
 * bytes. Grounding is separator-tolerant (via {@link isCountGrounded}) so a
 * count parsed from a grouped form like "12,345" still grounds against those
 * same bytes.
 */
function parseCount(html: string, root: ReturnType<typeof parse>): number {
  const countEl = root.querySelector(COUNT_SELECTOR);
  if (!countEl) {
    throw new Error(
      `papers-past parseSummary: no element matching "${COUNT_SELECTOR}" found; cannot determine result count.`
    );
  }
  const count = selectTotalCount(countEl.text);
  if (!isCountGrounded(html, count)) {
    throw new Error(
      `papers-past parseSummary: ungrounded count "${count}" - its digit sequence (allowing ` +
        `thousands separators) is not present in the parsed HTML.`
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
