/**
 * Chronicling America loc.gov JSON API SourceConfig (recon bootstrap).
 *
 * SRCH-0034 established that loc.gov's interactive collection-search UI is gated
 * by an invisible Cloudflare Turnstile that our governed automated browser
 * cannot pass (automation detection, not IP reputation). LoC nonetheless
 * publishes a sanctioned, keyless JSON API for the SAME collection
 * (loc.gov/apis): append `&fo=json` to a collection URL. The open question this
 * config tests: does Cloudflare EXEMPT the `fo=json` API path from Turnstile
 * (LoC wants programmatic access to work), or is the API gated the same way?
 *
 * PROVISIONAL / recon: persist-first answers that from the captured page —
 * a Turnstile interstitial (API also gated) vs actual JSON (API open). The
 * JSON parse below is best-effort; if the API is open we design a proper
 * API/bulk adapter. Same acyclic-import shape as the sibling configs.
 */

import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/grace';
import { isCountGrounded } from '@/sourcequery/grounding';
import type { Candidate, QuerySummary } from '@/sourcequery/types';
import { parse } from 'node-html-parser';

/**
 * The result container the browser renders for a JSON response. A headed
 * Chrome wraps a raw JSON body in a `<pre>` (its built-in viewer); this is the
 * block-detection anchor proving a real (non-challenge) API response rendered.
 */
const RESULT_SELECTOR = 'pre';

/** Builds the loc.gov JSON API URL for a query, optionally paged (loc.gov `sp`). */
function buildQueryUrl(query: string, page?: number): string {
  const base = `https://www.loc.gov/collections/chronicling-america/?q=${encodeURIComponent(query)}&fo=json`;
  return page !== undefined && page > 1 ? `${base}&sp=${page}` : base;
}

/**
 * Extracts the JSON payload text from the rendered page. A browser viewing a
 * JSON response exposes the raw JSON as the page's text content; slice from the
 * first `{` to the last `}` to drop any viewer chrome, then parse. Throws
 * (fail-loud) when no JSON object is present.
 */
function extractJson(html: string): Record<string, unknown> {
  const root = parse(html);
  const text = root.text;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      'chronicling-america-api parseSummary: no JSON object found in the page text.',
    );
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('chronicling-america-api parseSummary: parsed JSON is not an object.');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Reads the total result count from the loc.gov JSON `pagination.of` field and
 * grounds it against the page bytes. Throws (fail-loud) when the field is
 * missing or ungrounded.
 */
function readCount(html: string, data: Record<string, unknown>): number {
  const pagination = data['pagination'];
  const of =
    typeof pagination === 'object' && pagination !== null
      ? (pagination as Record<string, unknown>)['of']
      : undefined;
  if (typeof of !== 'number') {
    throw new Error(
      'chronicling-america-api parseSummary: pagination.of (total count) is missing or not a number.',
    );
  }
  if (!isCountGrounded(html, of)) {
    throw new Error(
      `chronicling-america-api parseSummary: ungrounded count "${of}" — not present in the page bytes.`,
    );
  }
  return of;
}

/** Reads first-page candidates from the loc.gov JSON `results[]` array. */
function readCandidates(data: Record<string, unknown>): Candidate[] {
  const results = data['results'];
  if (!Array.isArray(results)) {
    return [];
  }
  return results.flatMap((row): Candidate[] => {
    if (typeof row !== 'object' || row === null) {
      return [];
    }
    const record = row as Record<string, unknown>;
    const title = typeof record['title'] === 'string' ? record['title'] : undefined;
    const ref =
      typeof record['id'] === 'string'
        ? record['id']
        : typeof record['url'] === 'string'
          ? record['url']
          : undefined;
    if (title === undefined || ref === undefined) {
      return [];
    }
    return [{ title, ref }];
  });
}

/** Parses total count + first-page candidates from the persisted JSON API page. */
function parseSummary(html: string): QuerySummary {
  const data = extractJson(html);
  const count = readCount(html, data);
  const candidates = readCandidates(data);
  return { count, candidates };
}

export const CHRONICLING_AMERICA_API: SourceConfig = {
  id: 'chronicling-america-api',
  baseUrl: 'https://www.loc.gov',
  buildQueryUrl,
  resultSelector: RESULT_SELECTOR,
  parseSummary,
  retention: 'persist',
  attribution: '',
  preferredGeo: 'US',
  minIntervalMs: 1000,
  grace: DEFAULT_GRACE,
};
