import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storeAsset, companionYamlPath } from '@/archive/store';
import { sha256OfBytes } from '@/archive/checksum';
import { FakeObjectStore } from './fake-object-store';
import type { ObjectHead, PutOptions } from '@/archive/object-store';
import type { ProvenanceFields } from '@/archive/provenance';

/**
 * Counts EVERY B2 primitive, including reads, so a test can prove the DEFAULT
 * (trust-local) path performs no download-class (Class B) operations.
 */
class CountingStore extends FakeObjectStore {
  headCount = 0;
  getCount = 0;
  putCount = 0;

  override async head(key: string): Promise<ObjectHead> {
    this.headCount += 1;
    return super.head(key);
  }
  override async get(key: string): Promise<Uint8Array> {
    this.getCount += 1;
    return super.get(key);
  }
  override async put(key: string, bytes: Uint8Array, o: PutOptions): Promise<void> {
    this.putCount += 1;
    await super.put(key, bytes, o);
  }
}

const COORDS = {
  provider: 'backblaze-b2',
  bucket: 'colony-cults',
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
};

function provenance(): ProvenanceFields {
  return {
    id: 'PB-P001', title: 'La Nouvelle France', type: 'page-image',
    case: 'port-breton', language: 'French', source_archive: 'Gallica / BnF',
    catalog_url: 'https://gallica.bnf.fr/ark:/12148/bpt6k5603637g',
    original_url: 'https://gallica.bnf.fr/iiif/x/f1/full/full/0/native.jpg',
    rights_status: 'public-domain', retrieved: '2026-07-08T00:00:00.000Z',
    local_path: 'x', sha256: 'x', size: 0, format: 'image/jpeg',
    ocr_status: 'none', object_store: null, rights_raw: '<results/>', notes: null,
  };
}

describe('storeAsset trust-local-provenance default (no B2 read on skip)', () => {
  let archiveRoot: string;
  let target: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-trust-local-'));
    target = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
  });
  afterEach(() => rmSync(archiveRoot, { recursive: true, force: true }));

  it('new asset: uploads via PUT only — no HEAD, no GET', async () => {
    const bytes = new TextEncoder().encode('fresh master bytes');
    const store = new CountingStore();

    const r = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    expect(r.skipped).toBe(false);
    expect(store.putCount).toBe(1);
    expect(store.headCount).toBe(0); // Class B avoided
    expect(store.getCount).toBe(0);
  });

  it('already recorded: trusts the local YAML — skips with ZERO B2 calls', async () => {
    const bytes = new TextEncoder().encode('already-recorded master');
    const store = new CountingStore();

    // First run records object_store in the companion YAML (one PUT).
    await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });
    const yaml1 = readFileSync(companionYamlPath(target), 'utf-8');
    store.putCount = 0;

    // Second run: same bytes, DIFFERENT retrieved timestamp (a resume).
    const again = provenance();
    again.retrieved = '2026-12-31T23:59:59.000Z';
    const r = await storeAsset(bytes, target, again, archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    expect(r.skipped).toBe(true);
    expect(store.headCount).toBe(0); // trusts local — never touches B2
    expect(store.getCount).toBe(0);
    expect(store.putCount).toBe(0);
    // provenance preserved byte-for-byte (retrieved not churned)
    expect(readFileSync(companionYamlPath(target), 'utf-8')).toBe(yaml1);
  });

  it('local record mismatch (different sha): does NOT trust it — re-uploads', async () => {
    const store = new CountingStore();
    // Record the asset for the ORIGINAL bytes.
    await storeAsset(new TextEncoder().encode('v1'), target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });
    store.putCount = 0;

    // Now different bytes for the same target -> local record no longer matches.
    const r = await storeAsset(new TextEncoder().encode('v2-different'), target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });

    expect(r.skipped).toBe(false);
    expect(store.putCount).toBe(1);
    expect(store.headCount).toBe(0);
  });

  it('sanity: the sha256 the fresh run records matches the bytes', async () => {
    const bytes = new TextEncoder().encode('bytes to hash');
    const store = new CountingStore();
    const r = await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: store,
      objectStoreCoords: COORDS,
    });
    expect(r.sha256).toBe(sha256OfBytes(bytes));
  });
});
