/**
 * Chronicling America SourceConfig (recon bootstrap — new US-press axis).
 *
 * Chronicling America (US Library of Congress, `chroniclingamerica.loc.gov`)
 * is the US counterpart to the NZ Papers Past vein: a large public-domain
 * historical-newspaper corpus. The Papers Past de Rays / Port-Breton harvest
 * is saturated (search-log SRCH-0032), and the log names Chronicling America
 * as the next axis ("not yet queried -- needs its own bib query-source
 * SourceConfig"); PB-P077 already shows US relay coverage (a Paris letter via
 * the Philadelphia Press).
 *
 * PROVISIONAL: `resultSelector` and `parseSummary` here are a best-effort first
 * guess at the loc.gov results DOM. The governed client persists the raw page
 * BEFORE parsing (persist-first), so a wrong selector still yields a capture
 * under `bibliography/repository-responses/chronicling-america/` from which the
 * selectors get corrected. Treat these as UNVALIDATED until a live recon run
 * confirms them against real markup. This config exists to MEASURE the vein
 * (research-first, per the log's discipline), not yet to acquire; a full
 * acquisition adapter is a later spec IF recon proves the vein worthwhile.
 *
 * Imports mirror papers-past.ts: `SourceConfig` is type-only (erased) and the
 * one value needed, `DEFAULT_GRACE`, comes from the leaf `grace` module, to
 * keep the auto-register value-import in `source-config.ts` acyclic.
 */

import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/grace';
import { isCountGrounded } from '@/sourcequery/grounding';
import type { Candidate, QuerySummary } from '@/sourcequery/types';
import { parse } from 'node-html-parser';

/**
 * Provisional selectors for the Chronicling America page-search results DOM.
 * The results summary historically reads "1 - 20 of N" and each result row
 * links to a `/lccn/.../seq-N/` page. Both are best-effort until a live
 * capture confirms them.
 */
const RESULT_SELECTOR = '.results_list, #results, .search_results, ol.results';
const COUNT_SELECTOR = '.results_range, .pagination_summary, .results_summary';
const ROW_SELECTOR = '.result_row, li.result, .results_list li';

/**
 * A number token: a comma-grouped total (`12,345`) or a plain digit run (`42`).
 */
const NUMBER_TOKEN = '\\d{1,3}(?:,\\d{3})+|\\d+';

/** Builds the Chronicling America page-search results URL for a query, optionally paged. */
function buildQueryUrl(query: string, page?: number): string {
  const base = `https://chroniclingamerica.loc.gov/search/pages/results/?andtext=${encodeURIComponent(query)}`;
  return page !== undefined && page > 1 ? `${base}&page=${page}` : base;
}

/**
 * Selects the TOTAL result count from a results-summary text. Prefers the
 * explicit total after "of" (the "1 - 20 of N" range shape); refuses to guess
 * when the text carries multiple bare numbers and no "of <total>" (fail-loud).
 */
function selectTotalCount(text: string): number {
  const ofMatch = text.match(new RegExp(`\\bof\\s+(${NUMBER_TOKEN})`, 'i'));
  if (ofMatch) {
    return Number.parseInt(ofMatch[1].replace(/,/g, ''), 10);
  }
  const tokens = text.match(new RegExp(NUMBER_TOKEN, 'g'));
  if (!tokens || tokens.length === 0) {
    throw new Error(
      `chronicling-america parseSummary: no digit sequence found in count element text "${text}".`
    );
  }
  if (tokens.length > 1) {
    throw new Error(
      `chronicling-america parseSummary: ambiguous count text "${text}" — multiple numbers and no ` +
        `"of <total>" disambiguator; refusing to guess which is the total (fail-loud).`
    );
  }
  return Number.parseInt(tokens[0].replace(/,/g, ''), 10);
}

/**
 * Extracts the result count from the results-summary element. Throws
 * (fail-loud, Principle V) when the element is absent, no digit sequence is
 * present, the text is ambiguous, or the parsed count is not traceable in the
 * HTML bytes.
 */
function parseCount(html: string, root: ReturnType<typeof parse>): number {
  const countEl = root.querySelector(COUNT_SELECTOR);
  if (!countEl) {
    throw new Error(
      `chronicling-america parseSummary: no element matching "${COUNT_SELECTOR}" found; cannot determine result count.`
    );
  }
  const count = selectTotalCount(countEl.text);
  if (!isCountGrounded(html, count)) {
    throw new Error(
      `chronicling-america parseSummary: ungrounded count "${count}" — its digit sequence (allowing ` +
        `thousands separators) is not present in the parsed HTML.`
    );
  }
  return count;
}

/**
 * Extracts first-page candidates from result rows. Each row links to a
 * newspaper page; the link text carries the title and the href the ref.
 * Throws (fail-loud) when a row is missing its link, rather than silently
 * dropping the row.
 */
function parseCandidates(root: ReturnType<typeof parse>): Candidate[] {
  const rows = root.querySelectorAll(ROW_SELECTOR);
  return rows.map((row): Candidate => {
    const link = row.querySelector('a');
    if (!link) {
      throw new Error('chronicling-america parseSummary: result row is missing its link.');
    }
    const ref = link.getAttribute('href');
    if (!ref) {
      throw new Error('chronicling-america parseSummary: result link is missing an href.');
    }
    const title = link.text.trim();
    return { title, ref };
  });
}

/** Parses total count + first-page candidates from a persisted results page. */
function parseSummary(html: string): QuerySummary {
  const root = parse(html);
  const count = parseCount(html, root);
  const candidates = parseCandidates(root);
  return { count, candidates };
}

export const CHRONICLING_AMERICA: SourceConfig = {
  id: 'chronicling-america',
  baseUrl: 'https://chroniclingamerica.loc.gov',
  buildQueryUrl,
  resultSelector: RESULT_SELECTOR,
  parseSummary,
  retention: 'persist',
  attribution: '',
  preferredGeo: 'US',
  minIntervalMs: 1000,
  grace: DEFAULT_GRACE,
};
