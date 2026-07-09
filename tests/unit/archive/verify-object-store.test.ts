import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storeAsset, verifyAsset, companionYamlPath } from '@/archive/store';
import { readProvenance, type ProvenanceFields } from '@/archive/provenance';
import { objectKeyForAsset } from '@/archive/object-key';
import { sha256OfBytes } from '@/archive/checksum';
import { FakeObjectStore } from './fake-object-store';

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

describe('verifyAsset against the object store (T020, FR-008, SC-002/SC-004)', () => {
  let archiveRoot: string;
  let target: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-verify-os-'));
    target = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('reports ok:true when the B2 copy matches the recorded sha256', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const store = new FakeObjectStore();

    await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    const result = await verifyAsset(target, { objectStore: store });

    expect(result.ok).toBe(true);
    expect(result.recorded).toBe(sha256OfBytes(bytes));
    expect(result.actual).toBe(sha256OfBytes(bytes));
  });

  it('detects a corrupted B2 copy (bytes at the key no longer match the recorded sha256)', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const store = new FakeObjectStore();

    await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    const key = objectKeyForAsset(archiveRoot, target);
    const corrupted = new TextEncoder().encode('DIFFERENT bytes entirely');
    await store.put(key, corrupted, { sha256: sha256OfBytes(corrupted) });

    const result = await verifyAsset(target, { objectStore: store });

    expect(result.ok).toBe(false);
    expect(result.recorded).toBe(sha256OfBytes(bytes));
    expect(result.actual).toBe(sha256OfBytes(corrupted));
  });

  it('detects a missing B2 object as a verification failure, never ok:true', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const store = new FakeObjectStore();

    await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    const key = objectKeyForAsset(archiveRoot, target);
    store.delete(key);

    let result;
    let thrown: unknown;
    try {
      result = await verifyAsset(target, { objectStore: store });
    } catch (error) {
      thrown = error;
    }

    if (thrown !== undefined) {
      expect(thrown).toBeInstanceOf(Error);
      const message = thrown instanceof Error ? thrown.message : '';
      expect(message.length).toBeGreaterThan(0);
    } else {
      expect(result).toBeDefined();
      expect(result?.ok).toBe(false);
    }
  });

  it('falls back to local verification for a legacy asset with object_store: null', async () => {
    const bytes = new TextEncoder().encode('legacy local-only bytes');
    const store = new FakeObjectStore();

    // No objectStore/objectStoreCoords passed to storeAsset -- object_store
    // stays null in the companion YAML, matching a pre-B2 asset.
    await storeAsset(bytes, target, provenance(), archiveRoot);

    const record = await readProvenance(companionYamlPath(target));
    expect(record.object_store).toBeNull();

    // Even though a live objectStore IS passed to verifyAsset, the null
    // object_store block means there is nothing to check in B2 -- it must
    // fall back to re-hashing the local file.
    const result = await verifyAsset(target, { objectStore: store });

    expect(result.ok).toBe(true);
    expect(result.recorded).toBe(sha256OfBytes(bytes));
    expect(result.actual).toBe(sha256OfBytes(bytes));
  });
});
