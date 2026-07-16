/**
 * Tests for {@link InternetArchiveAdapter} (`@/repository/internet-archive/adapter`),
 * T018/T019's `resolve` + `collectRightsEvidence` skeleton
 * (specs/013-archiveorg-acquisition-path,
 * contracts/internet-archive-adapter.md). `acquire` is asserted to be an
 * explicit fail-loud stub (T025 implements it later).
 *
 * Real-fixture coverage: `__fixtures__/metadata-nouvellefrancec00groogoog.json`
 * (the de Groote "Nouvelle-France" item). No network is ever touched -- a
 * fake `ArchiveHttpClient` returns the fixture (or a synthetic response) for
 * `getText`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArchiveHttpClient } from '@/repository/internet-archive/metadata';
import type { RepositoryLocator } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import { InternetArchiveAdapter } from '@/repository/internet-archive/adapter';

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
const LOCATOR: RepositoryLocator = { repository: 'internet-archive', value: ITEM_ID };

/** A fake {@link ArchiveHttpClient} whose `getText` returns a fixed response, never touching the network. */
function fakeClient(responseText: string): ArchiveHttpClient {
  return {
    getText: async (_url: string) => responseText,
    getBytes: async (_url: string) => {
      throw new Error('fakeClient: getBytes is not used by this adapter skeleton.');
    },
  };
}

/** A synthetic non-`texts` item response (a `movies` item), for the fail-loud test. */
function nonTextsResponse(): string {
  const parsed: unknown = JSON.parse(FIXTURE_TEXT);
  if (typeof parsed !== 'object' || parsed === null || !('metadata' in parsed)) {
    throw new Error('test setup: fixture did not parse with a metadata field');
  }
  const metadata = (parsed as Record<string, unknown>).metadata;
  if (typeof metadata !== 'object' || metadata === null) {
    throw new Error('test setup: fixture metadata was not an object');
  }
  return JSON.stringify({ ...parsed, metadata: { ...metadata, mediatype: 'movies' } });
}

describe('InternetArchiveAdapter.resolve -- de Groote fixture (real archive.org shape)', () => {
  it('returns the ia-item identifier', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.identifiers).toEqual([{ type: 'ia-item', value: ITEM_ID }]);
  });

  it('returns a non-empty, mechanical title', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.title).toBe('Nouvelle-France: Colonie libre de Port-Breton, Océanie');
    expect(item.title.length).toBeGreaterThan(0);
  });

  it('returns the details page as sourceUrl', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.sourceUrl).toBe(`https://archive.org/details/${ITEM_ID}`);
  });

  it('builds assetLocators for the selected pdf, scandata, and image-set files', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.assetLocators).toEqual([
      {
        url: `https://archive.org/download/${ITEM_ID}/${ITEM_ID}.pdf`,
        role: 'pdf',
      },
      {
        url: `https://archive.org/download/${ITEM_ID}/${ITEM_ID}_scandata.xml`,
        role: 'scandata',
      },
      {
        url: `https://archive.org/download/${ITEM_ID}/${ITEM_ID}_tif.zip`,
        role: 'image-set',
      },
    ]);
  });

  it('grounds metadata.date from the item date/year, tied to the metadata endpoint', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.metadata.date.value).toBe('1880');
    expect(item.metadata.date.evidence.selector).toBe(
      `https://archive.org/metadata/${ITEM_ID}`,
    );
  });

  it('grounds metadata.creator', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    expect(item.metadata.creator?.value).toBe('P. de Groote');
  });
});

describe('InternetArchiveAdapter.resolve -- fail-loud invariants (IA-INV-A)', () => {
  it('throws on a locator with an empty value', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    await expect(
      adapter.resolve({ repository: 'internet-archive', value: '' }, {}),
    ).rejects.toThrow();
  });

  it('throws when the fetched item is not mediatype "texts"', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(nonTextsResponse()) });
    await expect(adapter.resolve(LOCATOR, {})).rejects.toThrow();
  });
});

describe('InternetArchiveAdapter.collectRightsEvidence -- propose, never decide (FR-004/FR-006)', () => {
  it('returns rightsRaw and grounded date/creator, with no rights verdict field', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const item = await adapter.resolve(LOCATOR, {});
    const evidence = await adapter.collectRightsEvidence(item);
    expect(evidence.rightsRaw).toBe('NOT_IN_COPYRIGHT');
    expect(evidence.date?.value).toBe('1880');
    expect(evidence.creator?.value).toBe('P. de Groote');
    expect(evidence).not.toHaveProperty('rightsStatus');
    expect(evidence).not.toHaveProperty('publicDomain');
    expect(evidence).not.toHaveProperty('verdict');
  });

  it('throws when given an item this adapter did not resolve', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const foreignItem = {
      repository: 'internet-archive' as const,
      identifiers: [{ type: 'ia-item' as const, value: 'unrelated-item' }],
      sourceUrl: 'https://archive.org/details/unrelated-item',
      title: 'Unrelated',
      assetLocators: [],
      metadata: {
        date: {
          value: '1900',
          evidence: { excerpt: '1900' },
          interpretation: 'synthetic',
          provenance: {
            modelAssisted: true as const,
            engine: 'test',
            model: 'test',
            promptVersion: 'test',
            at: new Date().toISOString(),
          },
        },
      },
    };
    await expect(adapter.collectRightsEvidence(foreignItem)).rejects.toThrow();
  });
});

describe('InternetArchiveAdapter.acquire -- fail-closed rights gate (T025, IA-INV-B)', () => {
  it('throws (before any fetch) on a record with no public-domain rights assessment', async () => {
    const adapter = new InternetArchiveAdapter({ client: fakeClient(FIXTURE_TEXT) });
    const record = {} as RepositoryRecord;
    // The full acquire pipeline lives in `acquire.ts` (see acquire.test.ts). Here we
    // only assert the adapter delegates and the rights gate fails closed before any
    // fetch or acquire-time dependency is even consulted.
    await expect(adapter.acquire(record, {})).rejects.toThrow(/public-domain|rightsStatus/);
  });
});

describe('InternetArchiveAdapter constructor -- fail-loud dependency validation', () => {
  it('throws when deps.client is missing', () => {
    // @ts-expect-error -- intentionally omitting the required client to test the guard clause.
    expect(() => new InternetArchiveAdapter({})).toThrow();
  });
});
