/**
 * Papers Past ARTICLE content-read SourceConfig (content read, distinct from
 * the `papers-past` search config). Selectors confirmed against a live capture
 * (2026-07-18): the OCR text lives in the "#text-tab" correctable-text panel and
 * the title in an <h3>. See bibliography/repository-responses/papers-past-article/.
 */

import { describe, it, expect } from 'vitest';
import { getSourceConfig } from '@/sourcequery/source-config';
import { PAPERS_PAST_ARTICLE } from '@/sourcequery/sources/papers-past-article';

/** Minimal fixture mirroring the real article page: an <h3> title + a #text-tab OCR panel. */
const ARTICLE_HTML = `<!DOCTYPE html><html><body>
  <h3>CONVICTION OF MARQUIS DE RAYS. Hawera &amp; Normanby Star, 3 January 1884, Page 3</h3>
  <div class="tabs-content">
    <div class="content tabs-panel" id="text-tab">
      <div><p>The trial of the Marquis de Rays on charges of fraud and deception in connection with
      the New Ireland expedition concluded to-day, when the prisoner was found guilty and sentenced
      to four years' imprisonment.</p></div>
    </div>
  </div>
</body></html>`;

describe('sourcequery/sources/papers-past-article', () => {
  it('registers papers-past-article via source-config auto-registration', () => {
    expect(getSourceConfig('papers-past-article')).toBe(PAPERS_PAST_ARTICLE);
    expect(PAPERS_PAST_ARTICLE.retention).toBe('persist');
    expect(PAPERS_PAST_ARTICLE.resultSelector).toBe('#text-tab');
  });

  describe('buildQueryUrl (normalizes an article code)', () => {
    it('builds an article URL from a bare code', () => {
      expect(PAPERS_PAST_ARTICLE.buildQueryUrl('HNS18840103.2.19.3')).toBe(
        'https://paperspast.natlib.govt.nz/newspapers/HNS18840103.2.19.3'
      );
    });
    it('strips a leading /newspapers/ path and a ?query= suffix', () => {
      expect(PAPERS_PAST_ARTICLE.buildQueryUrl('/newspapers/DTN18840103.2.17.3?query=Marquis+de+Rays')).toBe(
        'https://paperspast.natlib.govt.nz/newspapers/DTN18840103.2.17.3'
      );
    });
  });

  describe('parseSummary (content read)', () => {
    it('reads an article page: count 1, the h3 title, and an OCR excerpt', () => {
      const s = PAPERS_PAST_ARTICLE.parseSummary(ARTICLE_HTML);
      expect(s.count).toBe(1);
      expect(s.candidates).toHaveLength(1);
      expect(s.candidates[0].title).toContain('CONVICTION OF MARQUIS DE RAYS');
      expect(s.candidates[0].date).toContain('The trial of the Marquis de Rays');
    });

    it('throws (fail-loud) when the #text-tab OCR container is absent (not an article page)', () => {
      expect(() =>
        PAPERS_PAST_ARTICLE.parseSummary('<html><body><h3>Some search page</h3></body></html>')
      ).toThrow();
    });
  });
});
