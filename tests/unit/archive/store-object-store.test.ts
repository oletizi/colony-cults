import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storeAsset } from '@/archive/store';
import { companionYamlPath } from '@/archive/store';
import { readProvenance, type ProvenanceFields } from '@/archive/provenance';
import { objectKeyForAsset } from '@/archive/object-key';
import { sha256OfBytes } from '@/archive/checksum';
import { FakeObjectStore } from './fake-object-store';
import type { ObjectStore, PutOptions } from '@/archive/object-store';

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

describe('storeAsset object-store integration (T014)', () => {
  let archiveRoot: string;
  let target: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-store-os-'));
    target = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('uploads to the object store and records the object_store block', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const store = new FakeObjectStore();
    const expectedKey = objectKeyForAsset(archiveRoot, target);
    const expectedSha = sha256OfBytes(bytes);

    const result = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    // (d) a fresh write, not a skip.
    expect(result.skipped).toBe(false);

    // (a) the fake now holds the object at the expected key, with the sha256.
    expect(store.has(expectedKey)).toBe(true);
    const head = await store.head(expectedKey);
    expect(head.exists).toBe(true);
    expect(head.sha256).toBe(expectedSha);

    // (b) the companion YAML records the re-derived object_store block.
    const record = await readProvenance(companionYamlPath(target));
    expect(record.object_store).toEqual({
      provider: COORDS.provider,
      bucket: COORDS.bucket,
      key: expectedKey,
      endpoint: COORDS.endpoint,
    });

    // (c) size is recorded from the actual bytes.
    expect(record.size).toBe(bytes.length);
    // sha256 is the re-derived one.
    expect(record.sha256).toBe(expectedSha);
    expect(result.sha256).toBe(expectedSha);
  });

  it('does not upload and leaves object_store null when no object store is passed', async () => {
    const bytes = new TextEncoder().encode('legacy local-only bytes');

    const result = await storeAsset(bytes, target, provenance(), archiveRoot);

    // (e) no upload happened; object_store stays null.
    expect(result.skipped).toBe(false);
    const record = await readProvenance(companionYamlPath(target));
    expect(record.object_store).toBeNull();
  });

  it('rejects and writes no companion YAML when the upload fails (upload-before-provenance)', async () => {
    const bytes = new TextEncoder().encode('bytes that fail to upload');
    const failing: ObjectStore = {
      async head() {
        return { exists: false };
      },
      async put(_key: string, _bytes: Uint8Array, _options: PutOptions) {
        throw new Error('simulated upload failure');
      },
      async get() {
        throw new Error('not used');
      },
    };

    await expect(
      storeAsset(bytes, target, provenance(), archiveRoot, {
        objectStore: failing,
        objectStoreCoords: COORDS,
      }),
    ).rejects.toThrow('simulated upload failure');

    // No provenance may be written for an upload that did not happen.
    expect(existsSync(companionYamlPath(target))).toBe(false);
  });
});
