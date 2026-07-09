import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storeAsset, companionYamlPath } from '@/archive/store';
import { readProvenance, type ProvenanceFields } from '@/archive/provenance';
import { objectKeyForAsset } from '@/archive/object-key';
import { sha256OfBytes } from '@/archive/checksum';
import { FakeObjectStore } from './fake-object-store';
import type { PutOptions } from '@/archive/object-store';

/**
 * Counting FakeObjectStore that records how many times each mutating/reading
 * primitive was invoked, so tests can prove "no re-upload happened", "metadata
 * was backfilled", and "the second run took the cheap metadata path (no get)".
 */
class CountingStore extends FakeObjectStore {
  putCount = 0;
  attachCount = 0;
  getCount = 0;

  override async put(
    key: string,
    bytes: Uint8Array,
    options: PutOptions,
  ): Promise<void> {
    this.putCount += 1;
    await super.put(key, bytes, options);
  }

  override async attachSha256Metadata(
    key: string,
    sha256: string,
    contentType?: string,
  ): Promise<void> {
    this.attachCount += 1;
    await super.attachSha256Metadata(key, sha256, contentType);
  }

  override async get(key: string): Promise<Uint8Array> {
    this.getCount += 1;
    return super.get(key);
  }
}

function provenance(): ProvenanceFields {
  return {
    id: 'PB-P001',
    title: 'La Nouvelle France',
    type: 'page-image',
    case: 'port-breton',
    language: 'French',
    source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k5603637g',
    original_url:
      'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k5603637g/f1/full/full/0/native.jpg',
    rights_status: 'public-domain',
    retrieved: '2026-07-08T00:00:00.000Z',
    local_path: 'overwritten-by-store',
    sha256: 'overwritten-by-store',
    size: 0,
    format: 'image/jpeg',
    ocr_status: 'none',
    object_store: null,
    rights_raw: '<results/>',
    notes: null,
  };
}

const COORDS = {
  provider: 'backblaze-b2',
  bucket: 'colony-cults',
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
};

describe('storeAsset content-based idempotency + self-healing (FR-006)', () => {
  let archiveRoot: string;
  let target: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-store-idem-'));
    target = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('rclone-style object (etag/md5, no sha256): skips, backfills metadata + provenance, then takes fast path', async () => {
    const bytes = new TextEncoder().encode('the master page bytes');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingStore();
    const key = objectKeyForAsset(archiveRoot, target);

    // An object placed by another tool: bytes + etag present, no sha256 meta.
    store.seedExternal(key, bytes);
    expect((await store.head(key)).sha256).toBeUndefined();

    const first = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    // Skipped, zero re-uploads, metadata backfilled via the cheap ETag path.
    expect(first.skipped).toBe(true);
    expect(store.putCount).toBe(0);
    expect(store.attachCount).toBe(1);
    // The ETag/size cheap path suffices -- no full-body fetch was needed.
    expect(store.getCount).toBe(0);

    // Metadata was actually attached (head now reports our sha256).
    expect((await store.head(key)).sha256).toBe(sha256);

    // Provenance was backfilled: object_store block is non-null.
    const record = await readProvenance(companionYamlPath(target));
    expect(record.object_store).toEqual({
      provider: COORDS.provider,
      bucket: COORDS.bucket,
      key,
      endpoint: COORDS.endpoint,
    });
    expect(record.sha256).toBe(sha256);

    // Second run: fast metadata path -- still skipped, no attach, no get.
    const attachBefore = store.attachCount;
    const getBefore = store.getCount;
    const second = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });
    expect(second.skipped).toBe(true);
    expect(store.putCount).toBe(0);
    expect(store.attachCount).toBe(attachBefore);
    expect(store.getCount).toBe(getBefore);
  });

  it('our-metadata object: fast-path skip, no attach, no get', async () => {
    const bytes = new TextEncoder().encode('already-ours page bytes');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingStore();
    const key = objectKeyForAsset(archiveRoot, target);
    await store.put(key, bytes, { sha256 });
    const seededPuts = store.putCount;

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    expect(result.skipped).toBe(true);
    expect(store.putCount).toBe(seededPuts);
    expect(store.attachCount).toBe(0);
    expect(store.getCount).toBe(0);
  });

  it('absent object: uploads once and records the object_store block', async () => {
    const bytes = new TextEncoder().encode('fresh master bytes');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingStore();
    const key = objectKeyForAsset(archiveRoot, target);

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    expect(result.skipped).toBe(false);
    expect(store.putCount).toBe(1);
    expect(store.attachCount).toBe(0);
    expect((await store.head(key)).sha256).toBe(sha256);

    const record = await readProvenance(companionYamlPath(target));
    expect(record.object_store).not.toBeNull();
    expect(record.object_store?.key).toBe(key);
  });

  it('same size but different content (etag differs): fetches, hash differs, re-uploads (no false skip)', async () => {
    const bytes = new TextEncoder().encode('AAAAAAAAAAAAAAAA'); // 16 bytes
    const otherSameLen = new TextEncoder().encode('BBBBBBBBBBBBBBBB'); // 16 bytes
    expect(bytes.length).toBe(otherSameLen.length);

    const store = new CountingStore();
    const key = objectKeyForAsset(archiveRoot, target);
    store.seedExternal(key, otherSameLen);
    const seededPuts = store.putCount;

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    // Cheap ETag path fails (md5 differs) -> get()+hash -> mismatch -> upload.
    expect(result.skipped).toBe(false);
    expect(store.getCount).toBe(1);
    expect(store.putCount).toBe(seededPuts + 1);
    expect(store.attachCount).toBe(0);
    // The correct bytes now sit at the key.
    expect((await store.head(key)).sha256).toBe(sha256OfBytes(bytes));
  });

  it('multipart-style etag (contains a hyphen) but matching content: falls to get()+hash, skips + backfills', async () => {
    const bytes = new TextEncoder().encode('multipart master bytes');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingStore();
    const key = objectKeyForAsset(archiveRoot, target);
    store.seedExternal(key, bytes);
    // Force a multipart-shaped ETag that cannot equal the content MD5.
    store.overrideEtag(key, 'd41d8cd98f00b204e9800998ecf8427e-3');
    const seededPuts = store.putCount;

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    // Cheap path skipped (hyphen); get()+hash matches -> skip + backfill.
    expect(result.skipped).toBe(true);
    expect(store.getCount).toBe(1);
    expect(store.putCount).toBe(seededPuts);
    expect(store.attachCount).toBe(1);
    expect((await store.head(key)).sha256).toBe(sha256);
  });

  it('force with a present object: re-uploads (skipped:false), no head/skip', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingStore();
    const key = objectKeyForAsset(archiveRoot, target);
    await store.put(key, bytes, { sha256 });
    const seededPuts = store.putCount;

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      force: true,
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    expect(result.skipped).toBe(false);
    expect(store.putCount).toBe(seededPuts + 1);
    expect(store.attachCount).toBe(0);
    expect(store.getCount).toBe(0);
  });

  it('skip path does not rewrite an existing local cache file', async () => {
    const bytes = new TextEncoder().encode('the master page bytes');
    const store = new CountingStore();
    const key = objectKeyForAsset(archiveRoot, target);
    store.seedExternal(key, bytes);

    // First run creates the local cache file (object present, skip path).
    await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });
    expect(existsSync(target)).toBe(true);
    const firstContents = readFileSync(target);

    // Second run must leave the existing cache file byte-identical.
    await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });
    expect(readFileSync(target).equals(firstContents)).toBe(true);
  });
});
