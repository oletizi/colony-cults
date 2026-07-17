/**
 * Papers Past SourceConfig registration + parsing (T016, research R3).
 *
 * `resultSelector` (`.search-results .result`) and `parseSummary` are
 * validated ONLY against the synthetic fixture HTML below. Live validation
 * against the real paperspast.natlib.govt.nz/newspapers markup is deferred to
 * an env-gated smoke test outside this unit test's scope; the selector is
 * PROVISIONAL until that smoke run confirms it against real markup.
 */

import { describe, it, expect } from 'vitest';
import { getSourceConfig } from '@/sourcequery/source-config';
import { PAPERS_PAST } from '@/sourcequery/sources/papers-past';

/**
 * Synthetic fixture matching the chosen `.search-results .result` row
 * selector and a `.results-count` count element. The count is expressed in
 * plain digits (no thousands separator) so `String(count)` is a literal
 * substring of the HTML, satisfying the Frugality grounding check (FR-007).
 */
const FIXTURE_HTML = `
<!DOCTYPE html>
<html>
  <body>
    <div class="results-count">42 results for &quot;maori land&quot;</div>
    <div class="search-results">
      <div class="result">
        <a class="result-title" href="/newspapers/ODT18990101.2.3">Maori Land Meeting Held</a>
        <span class="result-date">1 January 1899</span>
      </div>
      <div class="result">
        <a class="result-title" href="/newspapers/EP18990215.2.10">Land Court Sitting Reported</a>
        <span class="result-date">15 February 1899</span>
      </div>
    </div>
  </body>
</html>
`;

describe('sourcequery/sources/papers-past', () => {
  it('registers papers-past in the source registry via source-config auto-registration', () => {
    const config = getSourceConfig('papers-past');
    expect(config.id).toBe('papers-past');
    expect(config).toBe(PAPERS_PAST);
  });

  it('exposes the expected static config fields', () => {
    expect(PAPERS_PAST.baseUrl).toBe('https://paperspast.natlib.govt.nz');
    expect(PAPERS_PAST.retention).toBe('persist');
    expect(PAPERS_PAST.attribution).toBe('');
    expect(PAPERS_PAST.preferredGeo).toBe('NZ');
    expect(PAPERS_PAST.minIntervalMs).toBe(1000);
    expect(PAPERS_PAST.resultSelector).toBe('.search-results .result');
  });

  describe('buildQueryUrl', () => {
    it('builds a page-1 URL with an encoded query and no page param', () => {
      const url = PAPERS_PAST.buildQueryUrl('maori land');
      expect(url).toBe('https://paperspast.natlib.govt.nz/newspapers?query=maori%20land');
    });

    it('appends &page= for page > 1', () => {
      const url = PAPERS_PAST.buildQueryUrl('maori land', 2);
      expect(url).toBe('https://paperspast.natlib.govt.nz/newspapers?query=maori%20land&page=2');
    });

    it('omits &page= for page === 1', () => {
      const url = PAPERS_PAST.buildQueryUrl('maori land', 1);
      expect(url).toBe('https://paperspast.natlib.govt.nz/newspapers?query=maori%20land');
    });

    it('encodes special characters in the query', () => {
      const url = PAPERS_PAST.buildQueryUrl('Ngāti & Iwi/Hapū');
      expect(url).toBe(
        `https://paperspast.natlib.govt.nz/newspapers?query=${encodeURIComponent('Ngāti & Iwi/Hapū')}`
      );
    });
  });

  describe('parseSummary', () => {
    it('extracts the grounded count from the fixture', () => {
      const summary = PAPERS_PAST.parseSummary(FIXTURE_HTML);
      expect(summary.count).toBe(42);
      expect(FIXTURE_HTML.includes(String(summary.count))).toBe(true);
    });

    it('extracts first-page candidates (title, ref, date) from the fixture', () => {
      const summary = PAPERS_PAST.parseSummary(FIXTURE_HTML);
      expect(summary.candidates).toEqual([
        {
          title: 'Maori Land Meeting Held',
          ref: '/newspapers/ODT18990101.2.3',
          date: '1 January 1899',
        },
        {
          title: 'Land Court Sitting Reported',
          ref: '/newspapers/EP18990215.2.10',
          date: '15 February 1899',
        },
      ]);
    });

    it('throws when the count element is missing (fail-loud, no fallback)', () => {
      expect(() => PAPERS_PAST.parseSummary('<html><body><div class="search-results"></div></body></html>')).toThrow();
    });

    it('throws when a result row has no link (fail-loud, no fallback)', () => {
      const html = `
        <div class="results-count">1 result</div>
        <div class="search-results">
          <div class="result"><span class="result-date">1 January 1899</span></div>
        </div>
      `;
      expect(() => PAPERS_PAST.parseSummary(html)).toThrow();
    });
  });
});
