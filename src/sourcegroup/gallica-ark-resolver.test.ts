import { describe, it, expect } from 'vitest';
import {
  GALLICA_ARCHIVE_NAME,
  GALLICA_NORMALIZATION_VERSION,
  gallicaArkIdentifierResolver,
  gallicaArkMetadataResolver,
  resolveArkViaGallica,
  type GallicaOaiRecordSource,
} from '@/sourcegroup/gallica-ark-resolver';

/**
 * A Gallica `services/OAIRecord` response for a single monograph ark, shaped
 * from the real `oai_dc:dc` schema (see `tests/fixtures/
 * oairecord-bpt6k5603637g.xml`, a periodical issue) and hand-built to carry
 * the title/creator/date/rights values documented by a live probe of
 * `ark:/12148/bpt6k5785971m` (the actual bug report this resolver fixes) --
 * not a byte-for-byte network capture.
 */
const ONE_RECORD_FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<results ResultsGenerationSearchTime="0:00:00.015" countResults="1" resultType="CVOAIRecordSearchService" searchTime="">
<visibility_rights>all</visibility_rights>
<notice>
<record>
<header>
<identifier>oai:bnf.fr:gallica/ark:/12148/bpt6k5785971m</identifier>
<datestamp>2024-04-26</datestamp>
<setSpec>gallica:corpus:PACA1</setSpec>
</header>
<metadata>
<oai_dc:dc xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">
<dc:identifier>https://gallica.bnf.fr/ark:/12148/bpt6k5785971m</dc:identifier>
<dc:date>1889</dc:date>
<dc:title>La Vérité sur la colonie de Port-Breton et sur le Mis de Rays</dc:title>
<dc:creator>Valamont, P. de</dc:creator>
<dc:publisher>[s.n.] (Paris)</dc:publisher>
<dc:type xml:lang="fre">texte</dc:type>
<dc:type xml:lang="eng">text</dc:type>
<dc:language>fre</dc:language>
<dc:source>Bibliothèque nationale de France</dc:source>
<dc:rights xml:lang="fre">domaine public</dc:rights>
<dc:rights xml:lang="eng">public domain</dc:rights>
</oai_dc:dc>
</metadata>
</record>
</notice>
<provenance>bnf.fr</provenance>
<title>La Vérité sur la colonie de Port-Breton et sur le Mis de Rays</title>
<date nbIssue="1">1889</date>
</results>`;

/**
 * Gallica's shape for "no OAIRecord for this ark": `countResults="0"` and no
 * `<notice>` element (an HTTP 200, NOT a 404 -- confirmed by the same live
 * probe that motivated this resolver: a bibliographic `cb` ark or a dead
 * `bpt6k` ark against `services/OAIRecord` returns this shape).
 */
const NOT_FOUND_FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<results ResultsGenerationSearchTime="0:00:00.005" countResults="0" resultType="CVOAIRecordSearchService" searchTime="">
<visibility_rights>all</visibility_rights>
</results>`;

/** A fake {@link GallicaOaiRecordSource} returning `body`, or throwing when `body` is an Error. */
function gallicaReturning(body: string | Error): { gallica: GallicaOaiRecordSource; calls: string[] } {
  const calls: string[] = [];
  const gallica: GallicaOaiRecordSource = {
    oaiRecord: (ark: string) => {
      calls.push(ark);
      if (body instanceof Error) {
        return Promise.reject(body);
      }
      return Promise.resolve(body);
    },
  };
  return { gallica, calls };
}

describe('resolveArkViaGallica', () => {
  it('maps the single Dublin Core OAIRecord to ArkMetadata (title/creator/date/rights)', async () => {
    const { gallica, calls } = gallicaReturning(ONE_RECORD_FIXTURE);

    const metadata = await resolveArkViaGallica('ark:/12148/bpt6k5785971m', {
      gallica,
      retrievedAt: '2026-07-10T00:00:00.000Z',
    });

    expect(metadata).not.toBeNull();
    expect(metadata).toEqual({
      titles: [{ text: 'La Vérité sur la colonie de Port-Breton et sur le Mis de Rays', role: 'archive' }],
      creator: 'Valamont, P. de',
      date: '1889',
      rightsRaw: 'domaine public',
      originalUrl: 'https://gallica.bnf.fr/ark:/12148/bpt6k5785971m',
      rawResponse: ONE_RECORD_FIXTURE,
      endpoint: 'https://gallica.bnf.fr/services/OAIRecord?ark=bpt6k5785971m',
      retrievedAt: '2026-07-10T00:00:00.000Z',
      normalizationVersion: GALLICA_NORMALIZATION_VERSION,
      archive: GALLICA_ARCHIVE_NAME,
    });
    // The ark is passed through to the injected client verbatim.
    expect(calls).toEqual(['ark:/12148/bpt6k5785971m']);
  });

  it('returns null when Gallica reports no OAIRecord for the ark (countResults="0", no <notice>)', async () => {
    const { gallica } = gallicaReturning(NOT_FOUND_FIXTURE);

    const metadata = await resolveArkViaGallica('ark:/12148/cbDEADark', { gallica });

    expect(metadata).toBeNull();
  });

  it('rejects an empty ark', async () => {
    const { gallica } = gallicaReturning(ONE_RECORD_FIXTURE);

    await expect(resolveArkViaGallica('   ', { gallica })).rejects.toThrow();
  });

  it('fails loud (throws, no fabricated metadata) when the injected client errors', async () => {
    const { gallica } = gallicaReturning(new Error('HttpClient: non-retryable HTTP 403 for ...'));

    await expect(
      resolveArkViaGallica('ark:/12148/bpt6k5785971m', { gallica }),
    ).rejects.toThrow(/403/);
  });

  it('fails loud on a malformed/empty response body', async () => {
    const { gallica } = gallicaReturning('');

    await expect(
      resolveArkViaGallica('ark:/12148/bpt6k5785971m', { gallica }),
    ).rejects.toThrow();
  });
});

describe('gallicaArkMetadataResolver', () => {
  it('binds the rich resolver to a GallicaOaiRecordSource', async () => {
    const { gallica } = gallicaReturning(ONE_RECORD_FIXTURE);
    const resolve = gallicaArkMetadataResolver(gallica);

    const metadata = await resolve('ark:/12148/bpt6k5785971m');

    expect(metadata?.archive).toBe(GALLICA_ARCHIVE_NAME);
    expect(metadata?.titles[0]?.text).toBe(
      'La Vérité sur la colonie de Port-Breton et sur le Mis de Rays',
    );
  });
});

describe('gallicaArkIdentifierResolver', () => {
  it('collapses a hit to { ark }', async () => {
    const { gallica } = gallicaReturning(ONE_RECORD_FIXTURE);
    const resolve = gallicaArkIdentifierResolver(gallica);

    await expect(resolve('ark:/12148/bpt6k5785971m')).resolves.toEqual({
      ark: 'ark:/12148/bpt6k5785971m',
    });
  });

  it('collapses a miss to null', async () => {
    const { gallica } = gallicaReturning(NOT_FOUND_FIXTURE);
    const resolve = gallicaArkIdentifierResolver(gallica);

    await expect(resolve('ark:/12148/cbDEADark')).resolves.toBeNull();
  });

  it('fails loud on a client error (never swallows)', async () => {
    const { gallica } = gallicaReturning(new Error('boom'));
    const resolve = gallicaArkIdentifierResolver(gallica);

    await expect(resolve('ark:/12148/bpt6k5785971m')).rejects.toThrow(/boom/);
  });
});
