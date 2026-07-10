import { describe, it, expect } from 'vitest';
import { HttpClient } from '@/gallica/http-client';
import type { FetchLike } from '@/gallica/http-client';
import {
  BNF_ARCHIVE_NAME,
  BNF_NORMALIZATION_VERSION,
  bnfArkIdentifierResolver,
  bnfArkMetadataResolver,
  buildArkPersistentIdCql,
  resolveArkViaBnfSru,
} from '@/sourcegroup/ark-resolver';

/**
 * A `bib.persistentid` SRU response for a single ark, shaped from a captured
 * live BnF general-catalogue SRU response (T004 spike): one Dublin Core record
 * under `oai_dc:dc`, carrying title/creator/rights/identifier.
 */
const ONE_RECORD_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
  <srw:version>1.2</srw:version>
  <srw:numberOfRecords>1</srw:numberOfRecords>
  <srw:records>
    <srw:record>
      <srw:recordSchema>dc</srw:recordSchema>
      <srw:recordPacking>xml</srw:recordPacking>
      <srw:recordData>
        <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier>http://catalogue.bnf.fr/ark:/12148/cb307654321</dc:identifier>
          <dc:title>La Nouvelle-France</dc:title>
          <dc:title>Nouvelle-France, colonie libre de Port-Breton</dc:title>
          <dc:creator>Rays, Charles Bonaventure du Breil, marquis de (1832-1893)</dc:creator>
          <dc:date>1878</dc:date>
          <dc:rights>domaine public</dc:rights>
        </oai_dc:dc>
      </srw:recordData>
      <srw:recordIdentifier>ark:/12148/cb307654321</srw:recordIdentifier>
      <srw:recordPosition>1</srw:recordPosition>
    </srw:record>
  </srw:records>
</srw:searchRetrieveResponse>`;

/** BnF's shape for a zero-hit response: an empty `<srw:records/>`. */
const ZERO_RECORD_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
  <srw:version>1.2</srw:version>
  <srw:numberOfRecords>0</srw:numberOfRecords>
  <srw:records/>
</srw:searchRetrieveResponse>`;

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

describe('buildArkPersistentIdCql', () => {
  it('resolves via the bib.persistentid ARK index', () => {
    expect(buildArkPersistentIdCql('ark:/12148/cb307654321')).toBe(
      'bib.persistentid all "ark:/12148/cb307654321"',
    );
  });

  it('rejects an empty ark', () => {
    expect(() => buildArkPersistentIdCql('   ')).toThrow();
  });
});

describe('resolveArkViaBnfSru', () => {
  it('maps the single Dublin Core record to ArkMetadata', async () => {
    const { http, calls } = clientReturning(ONE_RECORD_FIXTURE);

    const metadata = await resolveArkViaBnfSru('ark:/12148/cb307654321', {
      http,
      retrievedAt: '2026-07-10T00:00:00.000Z',
    });

    expect(metadata).not.toBeNull();
    expect(metadata).toEqual({
      titles: [
        { text: 'La Nouvelle-France', role: 'archive' },
        { text: 'Nouvelle-France, colonie libre de Port-Breton', role: 'archive' },
      ],
      creator: 'Rays, Charles Bonaventure du Breil, marquis de (1832-1893)',
      rightsRaw: 'domaine public',
      originalUrl: 'http://catalogue.bnf.fr/ark:/12148/cb307654321',
      rawResponse: ONE_RECORD_FIXTURE,
      endpoint: calls[0],
      retrievedAt: '2026-07-10T00:00:00.000Z',
      normalizationVersion: BNF_NORMALIZATION_VERSION,
      archive: BNF_ARCHIVE_NAME,
    });
    // The query resolves against the bib.persistentid index (dublincore schema).
    const params = new URL(calls[0]).searchParams;
    expect(params.get('recordSchema')).toBe('dublincore');
    expect(params.get('query')).toBe('bib.persistentid all "ark:/12148/cb307654321"');
  });

  it('returns null when the ark resolves to zero records', async () => {
    const { http } = clientReturning(ZERO_RECORD_FIXTURE);

    const metadata = await resolveArkViaBnfSru('ark:/12148/cbDEADark', { http });

    expect(metadata).toBeNull();
  });

  it('fails loud (throws, no fabricated metadata) on an HTTP error', async () => {
    const { http } = clientReturning('not found', 404);

    await expect(
      resolveArkViaBnfSru('ark:/12148/cb307654321', { http }),
    ).rejects.toThrow();
  });

  it('fails loud on a malformed/empty response body', async () => {
    const { http } = clientReturning('');

    await expect(
      resolveArkViaBnfSru('ark:/12148/cb307654321', { http }),
    ).rejects.toThrow();
  });
});

describe('bnfArkMetadataResolver', () => {
  it('binds the rich resolver to an HttpClient', async () => {
    const { http } = clientReturning(ONE_RECORD_FIXTURE);
    const resolve = bnfArkMetadataResolver(http);

    const metadata = await resolve('ark:/12148/cb307654321');

    expect(metadata?.archive).toBe(BNF_ARCHIVE_NAME);
    expect(metadata?.titles[0]?.text).toBe('La Nouvelle-France');
  });
});

describe('bnfArkIdentifierResolver', () => {
  it('collapses a hit to { ark }', async () => {
    const { http } = clientReturning(ONE_RECORD_FIXTURE);
    const resolve = bnfArkIdentifierResolver(http);

    await expect(resolve('ark:/12148/cb307654321')).resolves.toEqual({
      ark: 'ark:/12148/cb307654321',
    });
  });

  it('collapses a miss to null', async () => {
    const { http } = clientReturning(ZERO_RECORD_FIXTURE);
    const resolve = bnfArkIdentifierResolver(http);

    await expect(resolve('ark:/12148/cbDEADark')).resolves.toBeNull();
  });

  it('fails loud on an HTTP error (never swallows)', async () => {
    const { http } = clientReturning('boom', 500);
    const resolve = bnfArkIdentifierResolver(http);

    await expect(resolve('ark:/12148/cb307654321')).rejects.toThrow();
  });
});
