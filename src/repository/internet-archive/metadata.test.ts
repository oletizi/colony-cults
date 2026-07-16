/**
 * Tests for {@link fetchItemMetadata} (`@/repository/internet-archive/metadata`),
 * T014's archive.org `/metadata/<id>` client + typed parse for the Internet
 * Archive acquisition adapter (specs/013-archiveorg-acquisition-path).
 *
 * Real-fixture coverage: `__fixtures__/metadata-nouvellefrancec00groogoog.json`
 * (the de Groote "Nouvelle-France" item -- the captured, real archive.org
 * `/metadata/<id>` response shape this module parses).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchItemMetadata } from '@/repository/internet-archive/metadata';
import type { ArchiveHttpClient } from '@/repository/internet-archive/metadata';

const fixturesDir = join(
  process.cwd(),
  'src',
  'repository',
  'internet-archive',
  '__fixtures__',
);

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

const ITEM_ID = 'nouvellefrancec00groogoog';
const FIXTURE_TEXT = readFixture(`metadata-${ITEM_ID}.json`);
const EXPECTED_ENDPOINT = `https://archive.org/metadata/${ITEM_ID}`;

/** A fake {@link ArchiveHttpClient} whose `getText` returns a fixed response, never touching the network. */
function fakeClient(responseText: string): ArchiveHttpClient {
  return {
    getText: async (_url: string) => responseText,
    getBytes: async (_url: string) => {
      throw new Error('fakeClient: getBytes is not used by fetchItemMetadata.');
    },
  };
}

describe('fetchItemMetadata -- real fixture metadata-nouvellefrancec00groogoog.json', () => {
  it('parses the identifier', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    expect(metadata.identifier).toBe('nouvellefrancec00groogoog');
  });

  it('parses the title', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    expect(metadata.title).toBe('Nouvelle-France: Colonie libre de Port-Breton, Océanie');
  });

  it('parses the creator', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    expect(metadata.creator).toBe('P. de Groote');
  });

  it('parses the year', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    expect(metadata.year).toBe('1880');
  });

  it('maps possible-copyright-status (hyphenated) to possibleCopyrightStatus', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    expect(metadata.possibleCopyrightStatus).toBe('NOT_IN_COPYRIGHT');
  });

  it('parses the scanner', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    expect(metadata.scanner).toBe('google');
  });

  it('builds detailsUrl and metadataEndpoint from the item id', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    expect(metadata.detailsUrl).toBe(`https://archive.org/details/${ITEM_ID}`);
    expect(metadata.metadataEndpoint).toBe(EXPECTED_ENDPOINT);
  });

  it('preserves the exact response text as raw', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    expect(metadata.raw).toBe(FIXTURE_TEXT);
  });

  it('includes the primary page-image PDF file', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    const pdf = metadata.files.find((f) => f.name === 'nouvellefrancec00groogoog.pdf');
    expect(pdf).toBeDefined();
    expect(pdf?.format).toBe('Image Container PDF');
  });

  it('includes the scandata file', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    const scandata = metadata.files.find(
      (f) => f.name === 'nouvellefrancec00groogoog_scandata.xml',
    );
    expect(scandata).toBeDefined();
    expect(scandata?.format).toBe('Scandata');
  });

  it('includes the _tif.zip image set', async () => {
    const metadata = await fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
    const tifZip = metadata.files.find((f) => f.name === 'nouvellefrancec00groogoog_tif.zip');
    expect(tifZip).toBeDefined();
    expect(tifZip?.format).toBe('Single Page Processed TIFF ZIP');
  });

  it('fetches from the archive.org metadata endpoint via client.getText', async () => {
    const seen: string[] = [];
    const client: ArchiveHttpClient = {
      getText: async (url: string) => {
        seen.push(url);
        return FIXTURE_TEXT;
      },
      getBytes: async () => {
        throw new Error('unused');
      },
    };
    await fetchItemMetadata(ITEM_ID, client);
    expect(seen).toEqual([EXPECTED_ENDPOINT]);
  });
});

describe('fetchItemMetadata -- fail-loud invariants (no fabrication, Principle V)', () => {
  it('throws on an empty response', async () => {
    await expect(fetchItemMetadata(ITEM_ID, fakeClient(''))).rejects.toThrow();
  });

  it('throws on an unparseable (non-JSON) response', async () => {
    await expect(
      fetchItemMetadata(ITEM_ID, fakeClient('not json at all')),
    ).rejects.toThrow();
  });

  it('throws when the metadata field is absent', async () => {
    const parsed: unknown = JSON.parse(FIXTURE_TEXT);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('test setup: fixture did not parse to an object');
    }
    const withoutMetadata = { ...parsed };
    delete (withoutMetadata as Record<string, unknown>).metadata;
    await expect(
      fetchItemMetadata(ITEM_ID, fakeClient(JSON.stringify(withoutMetadata))),
    ).rejects.toThrow();
  });

  it('throws when mediatype is not "texts"', async () => {
    const parsed: unknown = JSON.parse(FIXTURE_TEXT);
    if (typeof parsed !== 'object' || parsed === null || !('metadata' in parsed)) {
      throw new Error('test setup: fixture did not parse with a metadata field');
    }
    const metadata = (parsed as Record<string, unknown>).metadata;
    if (typeof metadata !== 'object' || metadata === null) {
      throw new Error('test setup: fixture metadata was not an object');
    }
    const modified = {
      ...parsed,
      metadata: { ...metadata, mediatype: 'movies' },
    };
    await expect(
      fetchItemMetadata(ITEM_ID, fakeClient(JSON.stringify(modified))),
    ).rejects.toThrow();
  });
});
