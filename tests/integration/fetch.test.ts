import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '@/gallica/http-client';
import type { FetchLike } from '@/gallica/http-client';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { fetchIssue } from '@/fetch/issue';
import { assertInsideArchive } from '@/archive/location';
import { objectKeyForAsset } from '@/archive/object-key';
import { readProvenance } from '@/archive/provenance';
import { FakeObjectStore } from '../unit/archive/fake-object-store';

/**
 * Integration coverage for the fetch pipeline (T028): fetchIssue is driven
 * against an injected GallicaHttpClient whose only outside dependency (fetch)
 * is stubbed with RECORDED FIXTURES -- the pagination fixture for the page
 * count, an OAIRecord fixture for the rights gate, and the sampled page JPEG
 * for every page. Writes land in a TEMP archive root, never the real repo. No
 * real network.
 */

const ISSUE_ARK = 'bpt6k5603637g';
const ISSUE_DATE = '1879-07-15';
const SOURCE_ID = 'PB-P001';
/** The archive-relative dir fetchIssue must target for this issue. */
const ISSUE_SUBDIR = path.join(
  'archive/cases/port-breton/newspapers/la-nouvelle-france',
  `${ISSUE_DATE}_${ISSUE_ARK}`,
);

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

function textFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf-8');
}

function imageFixtureBytes(): ArrayBuffer {
  const view = new Uint8Array(readFileSync(fixturePath('iiif-page-sample.jpg')));
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

/**
 * A fixture-backed fetch. `oaiFixture` selects the rights response so the
 * public-domain and in-copyright paths can both be exercised. Records every
 * requested URL so a resumable re-run can be asserted to issue NO new image
 * downloads.
 */
function fixtureFetch(oaiFixture: string): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const image = imageFixtureBytes();
  const fetch: FetchLike = (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/services/Pagination')) {
      return Promise.resolve(
        new Response(textFixture('pagination-bpt6k5603637g.xml'), {
          status: 200,
        }),
      );
    }
    if (url.includes('/services/OAIRecord')) {
      return Promise.resolve(new Response(textFixture(oaiFixture), { status: 200 }));
    }
    if (url.includes('/iiif/') && url.endsWith('native.jpg')) {
      return Promise.resolve(new Response(image, { status: 200 }));
    }
    throw new Error(`fixtureFetch: no fixture mapped for ${url}`);
  };
  return { fetch, urls };
}

function makeClient(oaiFixture: string): {
  client: GallicaHttpClient;
  urls: string[];
} {
  const { fetch, urls } = fixtureFetch(oaiFixture);
  // Immediate sleep so the rate limiter/backoff never wall-clocks in tests.
  const http = new HttpClient({ fetch, sleep: () => Promise.resolve() });
  return { client: new GallicaHttpClient(http), urls };
}

function imageRequestCount(urls: string[]): number {
  return urls.filter((u) => u.endsWith('native.jpg')).length;
}

function baseContext(client: GallicaHttpClient, archiveRoot: string) {
  return {
    client,
    sourceId: SOURCE_ID,
    date: ISSUE_DATE,
    archiveRoot,
    clock: () => new Date('2026-07-08T00:00:00.000Z'),
  };
}

describe('fetchIssue (T028, fetch pipeline)', () => {
  let archiveRoot: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-fetch-'));
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('writes all 12 page images + companion YAML inside the temp archive', async () => {
    const { client } = makeClient('oairecord-bpt6k5603637g.xml');
    const result = await fetchIssue(ISSUE_ARK, baseContext(client, archiveRoot));

    expect(result.pageCount).toBe(12);
    expect(result.pages).toHaveLength(12);
    expect(result.skippedCount).toBe(0);
    expect(result.rights.status).toBe('public-domain');

    const dir = path.join(archiveRoot, ISSUE_SUBDIR);
    expect(result.dir).toBe(dir);

    // Every page + its sidecar exists AND resolves strictly inside the archive.
    for (let page = 1; page <= 12; page += 1) {
      const jpg = path.join(dir, `f${String(page).padStart(3, '0')}.jpg`);
      const yml = path.join(dir, `f${String(page).padStart(3, '0')}.yml`);
      expect(existsSync(jpg)).toBe(true);
      expect(existsSync(yml)).toBe(true);
      expect(() => assertInsideArchive(jpg, archiveRoot)).not.toThrow();
    }

    // Companion YAML carries the required provenance (FR-005/007).
    const yaml = await readFile(path.join(dir, 'f001.yml'), 'utf-8');
    expect(yaml).toContain('id: "PB-P001"');
    expect(yaml).toContain('type: "page-image"');
    expect(yaml).toContain('rights_status: "public-domain"');
    expect(yaml).toContain('format: "image/jpeg"');
    expect(yaml).toContain('ocr_status: "none"');
    expect(yaml).toContain(
      'original_url: "https://gallica.bnf.fr/iiif/ark:/12148/bpt6k5603637g/f1/full/full/0/native.jpg"',
    );
    expect(yaml).toContain('rights_raw:');
    expect(yaml).toContain('domaine public');

    // The integrity manifest is updated.
    const manifest = await readFile(
      path.join(archiveRoot, 'manifests', 'MANIFEST.sha256'),
      'utf-8',
    );
    expect(manifest).toContain(path.join(ISSUE_SUBDIR, 'f001.jpg'));
  });

  it('skips already-recorded pages on a second run (resumability), re-fetches with force', async () => {
    const first = makeClient('oairecord-bpt6k5603637g.xml');
    await fetchIssue(ISSUE_ARK, baseContext(first.client, archiveRoot));
    expect(imageRequestCount(first.urls)).toBe(12);

    // Second run against a FRESH client: every page is already recorded, so no
    // image is downloaded again.
    const second = makeClient('oairecord-bpt6k5603637g.xml');
    const rerun = await fetchIssue(
      ISSUE_ARK,
      baseContext(second.client, archiveRoot),
    );
    expect(rerun.skippedCount).toBe(12);
    expect(rerun.bytesWritten).toBe(0);
    expect(imageRequestCount(second.urls)).toBe(0);

    // With force, the same pages ARE re-fetched.
    const forced = makeClient('oairecord-bpt6k5603637g.xml');
    const forcedRun = await fetchIssue(ISSUE_ARK, {
      ...baseContext(forced.client, archiveRoot),
      force: true,
    });
    expect(forcedRun.skippedCount).toBe(0);
    expect(imageRequestCount(forced.urls)).toBe(12);
  });

  it('throws and writes NOTHING for a non-public-domain issue', async () => {
    const { client } = makeClient('oairecord-non-public-domain.xml');
    await expect(
      fetchIssue(ISSUE_ARK, baseContext(client, archiveRoot)),
    ).rejects.toThrow(/not confirmed public-domain|in copyright/i);

    // Nothing was written: the issue directory does not exist.
    expect(existsSync(path.join(archiveRoot, ISSUE_SUBDIR))).toBe(false);
    expect(
      existsSync(path.join(archiveRoot, 'manifests', 'MANIFEST.sha256')),
    ).toBe(false);
  });

  it('enforces the archive write-guard (no asset escapes the archive root)', async () => {
    const { client } = makeClient('oairecord-bpt6k5603637g.xml');
    const result = await fetchIssue(ISSUE_ARK, baseContext(client, archiveRoot));

    // Positive: every written asset is strictly inside the archive root.
    for (const page of result.pages) {
      expect(() => assertInsideArchive(page.path, archiveRoot)).not.toThrow();
    }
    // Negative: the guard fetchIssue relies on refuses a sibling path.
    expect(() =>
      assertInsideArchive(path.join(archiveRoot, '..', 'escapee.jpg'), archiveRoot),
    ).toThrow(/outside the private archive|no override/i);
  });

  it('T015: uploads page-image masters to an injected object store and records object_store in provenance', async () => {
    const { client } = makeClient('oairecord-bpt6k5603637g.xml');
    const objectStore = new FakeObjectStore();
    const objectStoreCoords = {
      provider: 'backblaze-b2',
      bucket: 'colony-cults',
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
    };

    const result = await fetchIssue(ISSUE_ARK, {
      ...baseContext(client, archiveRoot),
      objectStore,
      objectStoreCoords,
    });

    expect(result.skippedCount).toBe(0);
    const dir = path.join(archiveRoot, ISSUE_SUBDIR);
    const page1 = path.join(dir, 'f001.jpg');
    const expectedKey = objectKeyForAsset(archiveRoot, page1);

    // The master actually landed in the injected object store.
    expect(objectStore.has(expectedKey)).toBe(true);

    // Provenance records the object_store block re-derived from the coords.
    const record = await readProvenance(`${page1.slice(0, -4)}.yml`);
    expect(record.object_store).toEqual({
      provider: objectStoreCoords.provider,
      bucket: objectStoreCoords.bucket,
      key: expectedKey,
      endpoint: objectStoreCoords.endpoint,
    });
  });
});
