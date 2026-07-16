import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FetchClient } from '@/fetch/issue';
import { fetchMonograph } from '@/fetch/issue';
import { monographDir } from '@/archive/location';
import type { OaiRecordRights, IiifInfo } from '@/gallica/gallica-client';

/**
 * Fetch-core folio-selection coverage (spec 012, T007/T008): the shared
 * per-document loop can be constrained to an optional selected-folio set so a
 * caller fetches only some folios of a document instead of all of them, WITHOUT
 * changing behavior when no selection is given. Driven entirely against an
 * INJECTED FAKE CLIENT (no HTTP, no fixtures, no network) and a temp archive
 * root -- never the real repo, never Gallica -- mirroring the harness in
 * `tests/integration/monograph-fetch.test.ts`.
 */

const DOCUMENT_ARK = 'bpt6kFAKE00002';
const MONOGRAPH_SOURCE_ID = 'PB-P002';
const MONOGRAPH_SLUG = 'nouvelle-france-colonie-libre-port-breton';

const PUBLIC_DOMAIN_RIGHTS: OaiRecordRights = {
  rawResponse: '<oai><dc:rights>domaine public</dc:rights></oai>',
  dcRights: ['domaine public'],
};

/** A fully in-memory fake `FetchClient` -- no HTTP, deterministic bytes. */
function fakeClient(options: {
  pageCount: number;
  rights?: OaiRecordRights;
}): FetchClient & { calls: string[] } {
  const { pageCount, rights = PUBLIC_DOMAIN_RIGHTS } = options;
  const calls: string[] = [];
  return {
    calls,
    async oaiRecord(ark: string): Promise<string> {
      calls.push(`oaiRecord:${ark}`);
      return rights.rawResponse;
    },
    async oaiRights(ark: string): Promise<OaiRecordRights> {
      calls.push(`oaiRights:${ark}`);
      return rights;
    },
    async pagination(ark: string): Promise<number> {
      calls.push(`pagination:${ark}`);
      return pageCount;
    },
    async iiifInfo(): Promise<IiifInfo> {
      return { width: 100, height: 100 };
    },
    async iiifImage(ark: string, page: number): Promise<Uint8Array> {
      calls.push(`iiifImage:${ark}:${page}`);
      return new Uint8Array([0xff, 0xd8, page, page, page, 0xff, 0xd9]);
    },
  };
}

function baseCtx(client: FetchClient, archiveRoot: string) {
  return {
    client,
    sourceId: MONOGRAPH_SOURCE_ID,
    archiveRoot,
    clock: () => new Date('2026-07-08T00:00:00.000Z'),
  };
}

/** The IIIF folio ordinals actually fetched, in call order. */
function fetchedFolios(client: { calls: string[] }): number[] {
  return client.calls
    .filter((c) => c.startsWith('iiifImage:'))
    .map((c) => Number.parseInt(c.split(':').at(-1) ?? '', 10));
}

describe('fetchDocumentPages folio selection (spec 012, T007/T008)', () => {
  let archiveRoot: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-folio-'));
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('fetches EXACTLY the selected folios of a 200-page doc, nothing else', async () => {
    const client = fakeClient({ pageCount: 200 });
    const result = await fetchMonograph(DOCUMENT_ARK, {
      ...baseCtx(client, archiveRoot),
      folios: [48, 49, 50],
    });

    // Only folios 48,49,50 were fetched from Gallica -- no other page touched.
    expect(fetchedFolios(client)).toEqual([48, 49, 50]);

    // The document's TOTAL is still reported; the selection is reported too.
    expect(result.pageCount).toBe(200);
    expect(result.requestedFolios).toEqual([48, 49, 50]);
    expect(result.fetchedCount).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.skippedCount).toBe(0);

    const dir = monographDir(MONOGRAPH_SOURCE_ID, archiveRoot);
    for (const folio of [48, 49, 50]) {
      const stem = `f${String(folio).padStart(3, '0')}`;
      expect(existsSync(path.join(dir, `${stem}.jpg`))).toBe(true);
      expect(existsSync(path.join(dir, `${stem}.yml`))).toBe(true);
    }

    // Nothing else was stored: exactly the three folios' jpg + yml pairs.
    const jpgs = readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    expect(jpgs).toEqual(['f048.jpg', 'f049.jpg', 'f050.jpg']);
    expect(path.basename(dir)).toBe(MONOGRAPH_SLUG);
  });

  it('throws and writes NOTHING when a requested folio exceeds pageCount', async () => {
    const client = fakeClient({ pageCount: 200 });
    await expect(
      fetchMonograph(DOCUMENT_ARK, {
        ...baseCtx(client, archiveRoot),
        folios: [201],
      }),
    ).rejects.toThrow(/201/);

    // No IIIF fetch, no directory, no manifest -- fail before any fetch/store.
    expect(fetchedFolios(client)).toEqual([]);
    expect(existsSync(monographDir(MONOGRAPH_SOURCE_ID, archiveRoot))).toBe(false);
    expect(
      existsSync(path.join(archiveRoot, 'manifests', 'MANIFEST.sha256')),
    ).toBe(false);
  });

  it('throws and writes NOTHING when a requested folio is below 1', async () => {
    const client = fakeClient({ pageCount: 200 });
    await expect(
      fetchMonograph(DOCUMENT_ARK, {
        ...baseCtx(client, archiveRoot),
        folios: [0],
      }),
    ).rejects.toThrow(/\b0\b/);

    expect(fetchedFolios(client)).toEqual([]);
    expect(existsSync(monographDir(MONOGRAPH_SOURCE_ID, archiveRoot))).toBe(false);
  });

  it('bounds-checks the whole selection before fetching anything (mid-set offender)', async () => {
    const client = fakeClient({ pageCount: 200 });
    await expect(
      fetchMonograph(DOCUMENT_ARK, {
        ...baseCtx(client, archiveRoot),
        folios: [48, 999, 50],
      }),
    ).rejects.toThrow(/999/);

    // Even though 48 is valid, NOTHING was fetched -- the bound check runs to
    // completion before any page is visited.
    expect(fetchedFolios(client)).toEqual([]);
    expect(existsSync(monographDir(MONOGRAPH_SOURCE_ID, archiveRoot))).toBe(false);
  });

  it('with NO folios, fetches every folio 1..pageCount (whole-document regression lock)', async () => {
    const client = fakeClient({ pageCount: 4 });
    const result = await fetchMonograph(DOCUMENT_ARK, baseCtx(client, archiveRoot));

    expect(fetchedFolios(client)).toEqual([1, 2, 3, 4]);
    expect(result.pageCount).toBe(4);
    expect(result.fetchedCount).toBe(4);
    expect(result.requestedFolios).toBeUndefined();
    expect(result.pages).toHaveLength(4);
    expect(result.skippedCount).toBe(0);

    const dir = monographDir(MONOGRAPH_SOURCE_ID, archiveRoot);
    const jpgs = readdirSync(dir)
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    expect(jpgs).toEqual(['f001.jpg', 'f002.jpg', 'f003.jpg', 'f004.jpg']);
  });
});
