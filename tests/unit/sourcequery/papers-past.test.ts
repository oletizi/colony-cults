/**
 * Papers Past SourceConfig registration + parsing (T016, research R3).
 *
 * `resultSelector` + `parseSummary` were CONFIRMED against a live
 * paperspast.natlib.govt.nz/newspapers capture (2026-07-18, "Marquis de Rays"
 * → 695 results, persisted under bibliography/repository-responses/papers-past/).
 * The fixtures below mirror that real markup: the count sits in the top pager as
 * "Showing results 1-10 of <N>" (`.pager-center .en-version`), and each result
 * row's title/publication/date are in `.article-preview__*` fields inside
 * `.search-results`.
 */

import { describe, it, expect } from 'vitest';
import { getSourceConfig } from '@/sourcequery/source-config';
import { PAPERS_PAST } from '@/sourcequery/sources/papers-past';

interface FixtureRow {
  title?: string;
  ref?: string;
  paper?: string;
  year?: string;
}

/** Build a Papers Past-shaped results page with the given count text + rows. */
function page(countText: string, rows: FixtureRow[] = []): string {
  const rowHtml = rows
    .map(
      (r) => `
      <div class="article-preview grid-x">
        <div class="article-preview__title article-preview__title--newspapers cell small-6">
          ${r.ref !== undefined ? `<a href="${r.ref}">${r.title ?? ''}</a>` : (r.title ?? '')}
        </div>
        <div class="cell article-preview__publication small-3"><span>${r.paper ?? ''}</span></div>
        <div class="cell article-preview__year auto"><span>${r.year ?? ''}</span></div>
      </div>`,
    )
    .join('');
  return `<!DOCTYPE html><html><body>
    <div class="cell pager-center text-center"><span class="en-version">${countText}</span></div>
    <div class="search-results">${rowHtml}</div>
  </body></html>`;
}

const FIXTURE_HTML = page('Showing results 1-10 of 42', [
  { title: 'Maori Land Meeting Held', ref: '/newspapers/ODT18990101.2.3', paper: 'Otago Daily Times', year: '1 January 1899' },
  { title: 'Land Court Sitting Reported', ref: '/newspapers/EP18990215.2.10', paper: 'Evening Post', year: '15 February 1899' },
]);

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
    expect(PAPERS_PAST.resultSelector).toBe('.search-results');
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
    it('extracts the grounded total from the real "Showing results 1-10 of N" pager shape', () => {
      const summary = PAPERS_PAST.parseSummary(FIXTURE_HTML);
      expect(summary.count).toBe(42);
      expect(FIXTURE_HTML.includes(String(summary.count))).toBe(true);
    });

    it('parses a thousands-separated total without truncating ("of 12,345" -> 12345)', () => {
      const summary = PAPERS_PAST.parseSummary(page('Showing results 1-10 of 12,345', [{ ref: '/newspapers/X.1', title: 'A' }]));
      // A naive /\d+/ on "12,345" would truncate to 12 (silent wrong data).
      expect(summary.count).toBe(12345);
    });

    it('parses a multi-group thousands-separated total ("of 1,234,567" -> 1234567)', () => {
      expect(PAPERS_PAST.parseSummary(page('Showing results 1-10 of 1,234,567', [{ ref: '/newspapers/X.1', title: 'A' }])).count).toBe(1234567);
    });

    it('reads the total after "of", not the range start ("1-10 of 695" -> 695, not 1)', () => {
      const summary = PAPERS_PAST.parseSummary(page('Showing results 1-10 of 695', [{ ref: '/newspapers/X.1', title: 'A' }]));
      // A naive "first digit run" read would return 1 (the range START) — the
      // silent-wrong-data bug selectTotalCount guards against.
      expect(summary.count).toBe(695);
    });

    it('parses a single-number count with no range prefix ("5 results" -> 5)', () => {
      expect(PAPERS_PAST.parseSummary(page('5 results', [{ ref: '/newspapers/X.1', title: 'A' }])).count).toBe(5);
    });

    it('extracts first-page candidates (title, ref, and publication+date) from real markup', () => {
      const summary = PAPERS_PAST.parseSummary(FIXTURE_HTML);
      expect(summary.candidates).toEqual([
        {
          title: 'Maori Land Meeting Held',
          ref: '/newspapers/ODT18990101.2.3',
          date: 'Otago Daily Times, 1 January 1899',
        },
        {
          title: 'Land Court Sitting Reported',
          ref: '/newspapers/EP18990215.2.10',
          date: 'Evening Post, 15 February 1899',
        },
      ]);
    });

    it('throws when the count element is missing (fail-loud, no fallback)', () => {
      expect(() =>
        PAPERS_PAST.parseSummary('<html><body><div class="search-results"></div></body></html>')
      ).toThrow();
    });

    it('throws when a result row has no title/ref link (fail-loud, no fallback)', () => {
      // A title block present but with no <a> — refuse to silently drop the row.
      const html = page('Showing results 1-10 of 1', [{ title: 'No Link Here', paper: 'Otago Daily Times', year: '1 January 1899' }]);
      expect(() => PAPERS_PAST.parseSummary(html)).toThrow();
    });

    it('throws (ambiguous) on a page-range count with no total ("1 - 10 results")', () => {
      // Two numbers (1, 10), no "of <total>" disambiguator: refuses to guess.
      expect(() =>
        PAPERS_PAST.parseSummary(page('1 - 10 results', [{ ref: '/newspapers/X.1', title: 'A' }]))
      ).toThrow(/ambiguous/i);
    });
  });
});
