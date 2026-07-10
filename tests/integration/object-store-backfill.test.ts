import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '@/gallica/http-client';
import type { FetchLike } from '@/gallica/http-client';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { fetchIssue } from '@/fetch/issue';
import { objectKeyForAsset } from '@/archive/object-key';
import { readProvenance } from '@/archive/provenance';
import { FakeObjectStore } from '../unit/archive/fake-object-store';

/**
 * Backfill regression coverage (audit HIGH finding): an archive whose page
 * masters were populated by a PRIOR local-only run MUST NOT be treated as
 * "complete" during a later --object-store run. The pre-download local skip
 * (`isAssetRecorded`) is a LOCAL check only; when an object store is
 * configured it must not short-circuit `storeAsset`, or B2 never sees the
 * bytes and provenance's `object_store` stays null.
 *
 * These tests drive fetchIssue against fixture-backed Gallica responses and
 * count IIIF image requests so we can prove the backfill run reads the LOCAL
 * cache (zero re-downloads) yet still uploads to the injected object store.
 */

const ISSUE_ARK = 'bpt6k5603637g';
const ISSUE_DATE = '1879-07-15';
const SOURCE_ID = 'PB-P001';
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

function fixtureFetch(): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const image = imageFixtureBytes();
  const fetch: FetchLike = (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/services/Pagination')) {
      return Promise.resolve(
        new Response(textFixture('pagination-bpt6k5603637g.xml'), { status: 200 }),
      );
    }
    if (url.includes('/services/OAIRecord')) {
      return Promise.resolve(
        new Response(textFixture('oairecord-bpt6k5603637g.xml'), { status: 200 }),
      );
    }
    if (url.includes('/iiif/') && url.endsWith('native.jpg')) {
      return Promise.resolve(new Response(image, { status: 200 }));
    }
    throw new Error(`fixtureFetch: no fixture mapped for ${url}`);
  };
  return { fetch, urls };
}

function makeClient(): { client: GallicaHttpClient; urls: string[] } {
  const { fetch, urls } = fixtureFetch();
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

const COORDS = {
  provider: 'backblaze-b2',
  bucket: 'colony-cults',
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
};

describe('fetchIssue backfill of pre-existing local masters into an object store', () => {
  let archiveRoot: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-backfill-'));
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('uploads already-recorded local masters to B2 on a later --object-store run WITHOUT re-downloading', async () => {
    // Prior local-only run: no object store, populates + records every page.
    const first = makeClient();
    await fetchIssue(ISSUE_ARK, baseContext(first.client, archiveRoot));
    expect(imageRequestCount(first.urls)).toBe(12);

    const dir = path.join(archiveRoot, ISSUE_SUBDIR);
    const page1 = path.join(dir, 'f001.jpg');
    const expectedKey = objectKeyForAsset(archiveRoot, page1);

    // Local-only run left object_store null and B2 empty.
    const before = await readProvenance(`${page1.slice(0, -4)}.yml`);
    expect(before.object_store).toBeNull();

    // Later run WITH an object store (not pre-seeded) and WITHOUT force.
    const objectStore = new FakeObjectStore();
    const second = makeClient();
    const rerun = await fetchIssue(ISSUE_ARK, {
      ...baseContext(second.client, archiveRoot),
      objectStore,
      objectStoreCoords: COORDS,
    });

    // The pre-existing local master was NOT silently skipped: it was uploaded.
    expect(objectStore.has(expectedKey)).toBe(true);
    expect(objectStore.size).toBe(12);

    // Bytes came from the LOCAL cache, not a re-download from Gallica.
    expect(imageRequestCount(second.urls)).toBe(0);

    // No B2-head skips (the store was empty), and no downloads either, so
    // these pages count as neither skipped nor freshly-downloaded bytes.
    expect(rerun.skippedCount).toBe(0);
    expect(rerun.bytesWritten).toBe(0);

    // Provenance now carries the object_store block re-derived from coords.
    const after = await readProvenance(`${page1.slice(0, -4)}.yml`);
    expect(after.object_store).toEqual({
      provider: COORDS.provider,
      bucket: COORDS.bucket,
      key: expectedKey,
      endpoint: COORDS.endpoint,
    });

    // A third run finds the object already in B2 at the matching sha and skips
    // the upload (B2-head is the skip authority for object-store runs).
    const third = makeClient();
    const idempotent = await fetchIssue(ISSUE_ARK, {
      ...baseContext(third.client, archiveRoot),
      objectStore,
      objectStoreCoords: COORDS,
    });
    expect(idempotent.skippedCount).toBe(12);
    expect(imageRequestCount(third.urls)).toBe(0);
  });

  it('legacy path unchanged: with NO object store a recorded local master is skipped (no upload)', async () => {
    const first = makeClient();
    await fetchIssue(ISSUE_ARK, baseContext(first.client, archiveRoot));

    const second = makeClient();
    const rerun = await fetchIssue(
      ISSUE_ARK,
      baseContext(second.client, archiveRoot),
    );

    expect(rerun.skippedCount).toBe(12);
    expect(rerun.bytesWritten).toBe(0);
    expect(imageRequestCount(second.urls)).toBe(0);

    // object_store stays null on the legacy path.
    const page1yml = path.join(archiveRoot, ISSUE_SUBDIR, 'f001.yml');
    expect(existsSync(page1yml)).toBe(true);
    const record = await readProvenance(page1yml);
    expect(record.object_store).toBeNull();
  });
});
