import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { HttpClient } from '@/gallica/http-client';
import type { FetchLike } from '@/gallica/http-client';
import { GallicaHttpClient } from '@/gallica/gallica-client';

/**
 * Integration coverage for the census slice against RECORDED FIXTURES via an
 * injected HttpClient -- no real network.
 *
 * The fixtures only cover the 1879 issue list + one issue's pagination, so this
 * test asserts the authoritative total (78) from the year fixture and fully
 * validates the 1879 slice. The full live 78-issue census (all years, every
 * issue's pagination) is validated by the quickstart live run.
 */

function fixture(name: string): string {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return readFileSync(path, 'utf-8');
}

/** Route a Gallica service URL to the matching recorded fixture body. */
function fixtureFor(url: string): string {
  if (url.includes('/services/Pagination')) {
    return fixture('pagination-bpt6k5603637g.xml');
  }
  if (url.includes('/services/Issues')) {
    return url.includes('date=1879')
      ? fixture('issues-1879.xml')
      : fixture('issues-years.xml');
  }
  throw new Error(`fixtureFor: no fixture mapped for ${url}`);
}

/** A fetch that answers every request from a fixture; records the URLs. */
function fixtureFetch(): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = (input) => {
    const url = String(input);
    urls.push(url);
    return Promise.resolve(new Response(fixtureFor(url), { status: 200 }));
  };
  return { fetch, urls };
}

function makeClient(): GallicaHttpClient {
  const { fetch } = fixtureFetch();
  // Immediate sleep so the rate limiter/backoff never wall-clocks in tests.
  const http = new HttpClient({ fetch, sleep: () => Promise.resolve() });
  return new GallicaHttpClient(http);
}

const PERIODICAL_ARK = 'ark:/12148/cb328261098/date';

describe('GallicaHttpClient against fixtures', () => {
  it('reads the authoritative totalIssues (78) and the 1879-1885 year span', async () => {
    const client = makeClient();
    const { totalIssues, years } = await client.years(PERIODICAL_ARK);

    expect(totalIssues).toBe(78);
    expect(years).toEqual([
      '1879',
      '1880',
      '1881',
      '1882',
      '1883',
      '1884',
      '1885',
    ]);
  });

  it('produces the 6 issues of 1879 with correct arks and labels', async () => {
    const client = makeClient();
    const issues = await client.issuesForYear(PERIODICAL_ARK, '1879');

    expect(issues).toEqual([
      { ark: 'bpt6k5603637g', label: '15 juillet 1879' },
      { ark: 'bpt6k56068358', label: '15 août 1879' },
      { ark: 'bpt6k5606840k', label: '15 septembre 1879' },
      { ark: 'bpt6k5606842d', label: '15 octobre 1879' },
      { ark: 'bpt6k5606843t', label: '15 novembre 1879' },
      { ark: 'bpt6k56068447', label: '15 décembre 1879' },
    ]);
  });

  it('resolves the page count (nbVueImages) for an issue', async () => {
    const client = makeClient();
    const pageCount = await client.pagination('bpt6k5603637g');

    expect(pageCount).toBe(12);
  });

  it('builds the correct Issues year-list URL (bare + /date)', async () => {
    const { fetch, urls } = fixtureFetch();
    const http = new HttpClient({ fetch, sleep: () => Promise.resolve() });
    const client = new GallicaHttpClient(http);

    await client.years(PERIODICAL_ARK);

    expect(urls).toEqual([
      'https://gallica.bnf.fr/services/Issues?ark=cb328261098/date',
    ]);
  });
});
