import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storeAsset, companionYamlPath } from '@/archive/store';
import { readProvenance, type ProvenanceFields } from '@/archive/provenance';
import { objectKeyForAsset } from '@/archive/object-key';
import { sha256OfBytes } from '@/archive/checksum';
import { FakeObjectStore } from './fake-object-store';
import type { PutOptions } from '@/archive/object-store';

/**
 * Test-local wrapper that counts `put` calls, so tests can assert "no
 * re-upload happened" without changing the shared FakeObjectStore's contract.
 */
class CountingObjectStore extends FakeObjectStore {
  putCount = 0;

  override async put(
    key: string,
    bytes: Uint8Array,
    options: PutOptions,
  ): Promise<void> {
    this.putCount += 1;
    await super.put(key, bytes, options);
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

describe('storeAsset B2-head-based idempotent skip (T019, FR-006/SC-003)', () => {
  let archiveRoot: string;
  let target: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-store-skip-'));
    target = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('skips the upload when B2 already holds the object at the matching sha256', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingObjectStore();
    const key = objectKeyForAsset(archiveRoot, target);
    await store.put(key, bytes, { sha256 });
    const seededPutCount = store.putCount;

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      reconcileRemote: true,
      objectStoreCoords: COORDS,
    });

    expect(result.skipped).toBe(true);
    // No re-upload: the put count is unchanged from the pre-seed.
    expect(store.putCount).toBe(seededPutCount);

    // Provenance and manifest are still written/refreshed on the skip path.
    const record = await readProvenance(companionYamlPath(target));
    expect(record.object_store).toEqual({
      provider: COORDS.provider,
      bucket: COORDS.bucket,
      key,
      endpoint: COORDS.endpoint,
    });
    expect(record.sha256).toBe(sha256);
    expect(result.sha256).toBe(sha256);
  });

  it('re-uploads when force is true, even though B2 already holds a matching object', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingObjectStore();
    const key = objectKeyForAsset(archiveRoot, target);
    await store.put(key, bytes, { sha256 });
    const seededPutCount = store.putCount;

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      force: true,
      objectStore: store,
      reconcileRemote: true,
      objectStoreCoords: COORDS,
    });

    expect(result.skipped).toBe(false);
    expect(store.putCount).toBe(seededPutCount + 1);
  });

  it('does not skip when B2 holds the same key with a different sha256 (hash mismatch is not "already done")', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const sha256 = sha256OfBytes(bytes);
    const staleBytes = new TextEncoder().encode('some other, stale bytes');
    const staleSha = sha256OfBytes(staleBytes);
    const store = new CountingObjectStore();
    const key = objectKeyForAsset(archiveRoot, target);
    await store.put(key, staleBytes, { sha256: staleSha });
    const seededPutCount = store.putCount;

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      reconcileRemote: true,
      objectStoreCoords: COORDS,
    });

    expect(result.skipped).toBe(false);
    expect(store.putCount).toBe(seededPutCount + 1);

    // The re-put overwrote the stale object with the correct bytes/hash.
    const head = await store.head(key);
    expect(head.sha256).toBe(sha256);
  });
});
