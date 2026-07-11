import { describe, it, expect } from 'vitest';
import { HttpClient } from '@/gallica/http-client';
import type { FetchLike } from '@/gallica/http-client';
import {
  BNF_SRU_BASE,
  BnfSruDiscoveryMechanism,
  buildCql,
  buildSearchRetrieveUrl,
} from '@/sourcegroup/discovery/bnf-sru';

/**
 * A minimal but realistic `srw:searchRetrieveResponse` with two Dublin Core
 * records, shaped from a captured live BnF general-catalogue SRU response
 * (T004 spike): `srw:recordIdentifier` carries the bare ark, and the Dublin
 * Core payload sits under `oai_dc:dc` inside `srw:recordData`.
 */
const TWO_RECORD_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
  <srw:version>1.2</srw:version>
  <srw:numberOfRecords>2</srw:numberOfRecords>
  <srw:records>
    <srw:record>
      <srw:recordSchema>dc</srw:recordSchema>
      <srw:recordPacking>xml</srw:recordPacking>
      <srw:recordData>
        <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier>http://catalogue.bnf.fr/ark:/12148/cb307654321</dc:identifier>
          <dc:title>La Nouvelle-France / Charles Bonaventure du Breil, marquis de Rays</dc:title>
          <dc:creator>Rays, Charles Bonaventure du Breil, marquis de (1832-1893)</dc:creator>
          <dc:date>1878</dc:date>
        </oai_dc:dc>
      </srw:recordData>
      <srw:recordIdentifier>ark:/12148/cb307654321</srw:recordIdentifier>
      <srw:recordPosition>1</srw:recordPosition>
    </srw:record>
    <srw:record>
      <srw:recordSchema>dc</srw:recordSchema>
      <srw:recordPacking>xml</srw:recordPacking>
      <srw:recordData>
        <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier>http://catalogue.bnf.fr/ark:/12148/cb412345678</dc:identifier>
          <dc:title>La Colonisation de la Nouvelle-Bretagne</dc:title>
          <dc:creator>Du Breil de Rays, Charles</dc:creator>
          <dc:date>1880</dc:date>
        </oai_dc:dc>
      </srw:recordData>
      <srw:recordIdentifier>ark:/12148/cb412345678</srw:recordIdentifier>
      <srw:recordPosition>2</srw:recordPosition>
    </srw:record>
  </srw:records>
</srw:searchRetrieveResponse>`;

/** BnF's shape for a zero-hit (or diagnostic-only) response: an empty `<srw:records/>`. */
const ZERO_RECORD_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
  <srw:version>1.2</srw:version>
  <srw:numberOfRecords>0</srw:numberOfRecords>
  <srw:records/>
</srw:searchRetrieveResponse>`;

const EXPLAIN_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<srw:explainResponse xmlns:srw="http://www.loc.gov/zing/srw/">
  <srw:version>1.2</srw:version>
</srw:explainResponse>`;

/** Build an `HttpClient` with an injected fetch that always returns `body`. */
function clientReturning(body: string, status = 200): {
  http: HttpClient;
  calls: string[];
} {
  const calls: string[] = [];
  const fetch: FetchLike = (input) => {
    calls.push(String(input));
    return Promise.resolve(new Response(body, { status }));
  };
  const http = new HttpClient({ fetch, sleep: () => Promise.resolve() });
  return { http, calls };
}

describe('buildSearchRetrieveUrl / buildCql', () => {
  it('builds the documented SRU searchRetrieve URL over bib.anywhere', () => {
    const url = buildSearchRetrieveUrl('Marquis de Rays');

    expect(url.startsWith(`${BNF_SRU_BASE}?`)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('operation')).toBe('searchRetrieve');
    expect(parsed.searchParams.get('version')).toBe('1.2');
    expect(parsed.searchParams.get('recordSchema')).toBe('dublincore');
    expect(parsed.searchParams.get('query')).toBe(
      'bib.anywhere all "Marquis de Rays"',
    );
    expect(parsed.searchParams.get('maximumRecords')).toBe('20');
    expect(parsed.searchParams.get('startRecord')).toBe('1');
  });

  it('honors maxResults/startRecord from DiscoverySearchOptions', () => {
    const url = buildSearchRetrieveUrl('Marquis de Rays', {
      maxResults: 5,
      startRecord: 11,
    });
    const parsed = new URL(url);

    expect(parsed.searchParams.get('maximumRecords')).toBe('5');
    expect(parsed.searchParams.get('startRecord')).toBe('11');
  });

  it('escapes double quotes in the query so CQL is not broken out of', () => {
    expect(buildCql('a "quoted" phrase')).toBe(
      'bib.anywhere all "a \\"quoted\\" phrase"',
    );
  });

  it('rejects an empty query', () => {
    expect(() => buildCql('   ')).toThrow();
  });
});

describe('BnfSruDiscoveryMechanism.search', () => {
  it('parses Dublin Core records into DiscoveryCandidate[] with ark identifiers and hints', async () => {
    const { http, calls } = clientReturning(TWO_RECORD_FIXTURE);
    const mechanism = new BnfSruDiscoveryMechanism(http);

    const candidates = await mechanism.search('Marquis de Rays');

    expect(candidates).toEqual([
      {
        identifier: 'ark:/12148/cb307654321',
        titleHint:
          'La Nouvelle-France / Charles Bonaventure du Breil, marquis de Rays',
        creatorHint: 'Rays, Charles Bonaventure du Breil, marquis de (1832-1893)',
        dateHint: '1878',
        endpoint: 'bnf-catalogue-sru',
      },
      {
        identifier: 'ark:/12148/cb412345678',
        titleHint: 'La Colonisation de la Nouvelle-Bretagne',
        creatorHint: 'Du Breil de Rays, Charles',
        dateHint: '1880',
        endpoint: 'bnf-catalogue-sru',
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('operation=searchRetrieve');
  });

  it('returns [] when numberOfRecords is 0', async () => {
    const { http } = clientReturning(ZERO_RECORD_FIXTURE);
    const mechanism = new BnfSruDiscoveryMechanism(http);

    const candidates = await mechanism.search('zzz-no-such-thing');

    expect(candidates).toEqual([]);
  });

  it('fails loud (throws, no fabricated results) on an HTTP error', async () => {
    const { http } = clientReturning('not found', 404);
    const mechanism = new BnfSruDiscoveryMechanism(http);

    await expect(mechanism.search('Marquis de Rays')).rejects.toThrow();
  });

  it('fails loud on a malformed/empty response body', async () => {
    const { http } = clientReturning('');
    const mechanism = new BnfSruDiscoveryMechanism(http);

    await expect(mechanism.search('Marquis de Rays')).rejects.toThrow();
  });
});

describe('BnfSruDiscoveryMechanism.isAvailable', () => {
  it('returns true when the explain probe succeeds', async () => {
    const { http, calls } = clientReturning(EXPLAIN_FIXTURE);
    const mechanism = new BnfSruDiscoveryMechanism(http);

    await expect(mechanism.isAvailable()).resolves.toBe(true);
    expect(calls[0]).toContain('operation=explain');
  });

  it('returns false (does not throw) when the endpoint is unavailable', async () => {
    const { http } = clientReturning('service unavailable', 503);
    const mechanism = new BnfSruDiscoveryMechanism(http);

    await expect(mechanism.isAvailable()).resolves.toBe(false);
  });

  it('returns false when the endpoint returns a non-retryable HTTP error', async () => {
    const { http } = clientReturning('not found', 404);
    const mechanism = new BnfSruDiscoveryMechanism(http);

    await expect(mechanism.isAvailable()).resolves.toBe(false);
  });
});
