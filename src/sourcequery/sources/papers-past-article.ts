/**
 * Papers Past ARTICLE-content SourceConfig (content read, distinct from the
 * `papers-past` search config). Given a Papers Past article code (e.g.
 * "HNS18840103.2.19.3"), fetches that article's page so the governed client
 * persists its raw HTML + OCR text before analysis — the sanctioned way to read
 * a discrete article's content (skill: "OCR/content read" is in scope).
 *
 * Selectors CONFIRMED against a live capture (2026-07-18); see
 * bibliography/repository-responses/papers-past-article/. No runtime dependency
 * on `@/sourcequery/source-config` (SourceConfig imported type-only;
 * DEFAULT_GRACE from the leaf `@/sourcequery/grace`).
 */

import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/grace';
import { isCountGrounded } from '@/sourcequery/grounding';
import type { Candidate, QuerySummary } from '@/sourcequery/types';
import { parse } from 'node-html-parser';

/** The OCR text container on a Papers Past article page — the "correctable text" tab panel. */
const ARTICLE_SELECTOR = '#text-tab';
/** The article title heading (e.g. "CONVICTION OF MARQUIS DE RAYS. Hawera & Normanby Star ..."). */
const TITLE_SELECTOR = 'h3';

/** `query` is the article code, e.g. "HNS18840103.2.19.3" (leading slash / query-string tolerated). */
function buildQueryUrl(query: string): string {
  const code = query.trim().replace(/^\/?(newspapers\/)?/, '').replace(/\?.*$/, '');
  return `https://paperspast.natlib.govt.nz/newspapers/${code}`;
}

/**
 * "Summary" of an article page: count 1 (the article) + a single candidate
 * carrying the title + a short OCR excerpt as `date` (best-effort). The full
 * OCR text is read from the persisted capture; this only proves a real article
 * page rendered. Grounded on the literal "1".
 */
function parseSummary(html: string): QuerySummary {
  const root = parse(html);
  const container = root.querySelector(ARTICLE_SELECTOR);
  if (!container) {
    throw new Error(
      `papers-past-article parseSummary: no OCR container matching "${ARTICLE_SELECTOR}"; ` +
        'not an article page (fail-loud).'
    );
  }
  const titleEl = root.querySelector(TITLE_SELECTOR);
  const title = titleEl ? titleEl.text.trim() : 'Papers Past article';
  const excerpt = container.text.trim().replace(/\s+/g, ' ').slice(0, 120);
  const candidate: Candidate = { title, ref: buildQueryUrl(title), date: excerpt };
  const count = 1;
  if (!isCountGrounded(html, count)) {
    throw new Error('papers-past-article parseSummary: ungrounded count.');
  }
  return { count, candidates: [candidate] };
}

export const PAPERS_PAST_ARTICLE: SourceConfig = {
  id: 'papers-past-article',
  baseUrl: 'https://paperspast.natlib.govt.nz',
  buildQueryUrl,
  resultSelector: ARTICLE_SELECTOR,
  parseSummary,
  retention: 'persist',
  attribution: '',
  preferredGeo: 'NZ',
  minIntervalMs: 1000,
  grace: DEFAULT_GRACE,
};
