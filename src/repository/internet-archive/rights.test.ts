/**
 * Tests for {@link collectRightsEvidence}
 * (`@/repository/internet-archive/rights`) -- T034/T035, IA rights-evidence
 * proposal (specs/013-archiveorg-acquisition-path,
 * contracts/internet-archive-adapter.md `collectRightsEvidence` section,
 * FR-004 / FR-006).
 *
 * Real-fixture coverage: `__fixtures__/metadata-nouvellefrancec00groogoog.json`
 * (the de Groote "Nouvelle-France" item), parsed via the real
 * `fetchItemMetadata` so the `ItemMetadata` under test is genuine, not
 * hand-typed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchItemMetadata } from '@/repository/internet-archive/metadata';
import type { ArchiveHttpClient, ItemMetadata } from '@/repository/internet-archive/metadata';
import { collectRightsEvidence } from '@/repository/internet-archive/rights';

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

async function deGrooteItem(): Promise<ItemMetadata> {
  return fetchItemMetadata(ITEM_ID, fakeClient(FIXTURE_TEXT));
}

describe('collectRightsEvidence -- de Groote fixture (real archive.org shape)', () => {
  it('preserves possible-copyright-status verbatim as rightsRaw, never a verdict', async () => {
    const item = await deGrooteItem();
    const evidence = collectRightsEvidence(item);
    expect(evidence.rightsRaw).toBe('NOT_IN_COPYRIGHT');
  });

  it('grounds date to the item metadata date (1880), tied to the metadata endpoint', async () => {
    const item = await deGrooteItem();
    const evidence = collectRightsEvidence(item);
    expect(evidence.date?.value).toBe('1880');
    expect(evidence.date?.evidence.excerpt).toBe('1880');
    expect(evidence.date?.evidence.selector).toBe(EXPECTED_ENDPOINT);
    expect(evidence.date?.provenance.at).toEqual(expect.any(String));
  });

  it('grounds creator to "P. de Groote", tied to the metadata endpoint', async () => {
    const item = await deGrooteItem();
    const evidence = collectRightsEvidence(item);
    expect(evidence.creator?.value).toBe('P. de Groote');
    expect(evidence.creator?.evidence.excerpt).toBe('P. de Groote');
    expect(evidence.creator?.evidence.selector).toBe(EXPECTED_ENDPOINT);
  });

  it('never expresses a public-domain (or any other) rights verdict', async () => {
    const item = await deGrooteItem();
    const evidence = collectRightsEvidence(item);
    // RightsEvidence has no rightsStatus/verdict field at all -- assert the
    // raw status is preserved as-is, not translated into a determination.
    expect(evidence).not.toHaveProperty('rightsStatus');
    expect(evidence).not.toHaveProperty('publicDomain');
    expect(evidence).not.toHaveProperty('verdict');
    expect(evidence.rightsRaw).toBe('NOT_IN_COPYRIGHT');
    expect(Object.keys(evidence).sort()).toEqual(['creator', 'date', 'rightsRaw']);
  });
});

describe('collectRightsEvidence -- falls back to year when date is absent', () => {
  it('grounds date from item.year when item.date is undefined', () => {
    const item: ItemMetadata = {
      identifier: 'fallback-item',
      mediatype: 'texts',
      title: 'Fallback Title',
      year: '1901',
      files: [],
      detailsUrl: 'https://archive.org/details/fallback-item',
      metadataEndpoint: 'https://archive.org/metadata/fallback-item',
      raw: '{}',
    };
    const evidence = collectRightsEvidence(item);
    expect(evidence.date?.value).toBe('1901');
  });
});

describe('collectRightsEvidence -- fail-loud invariants', () => {
  it('throws when item is null', () => {
    // @ts-expect-error -- intentionally passing null to test the guard clause.
    expect(() => collectRightsEvidence(null)).toThrow();
  });
});
