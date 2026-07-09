import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  storeAsset,
  companionYamlPath,
  auditManifestProvenance,
} from '@/archive/store';
import type { ProvenanceFields } from '@/archive/provenance';
import { FakeObjectStore } from './fake-object-store';

function provenance(id: string): ProvenanceFields {
  return {
    id,
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

/**
 * T024: the archive keeps TWO git-tracked integrity records for every
 * asset -- `manifests/MANIFEST.sha256` and the per-asset companion YAML's
 * `sha256` field. This audit proves the two agree, independent of the
 * object store (masters may live in B2; both records are still git-tracked
 * and must corroborate each other).
 */
describe('auditManifestProvenance', () => {
  let archiveRoot: string;
  let target1: string;
  let target2: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-manifest-audit-'));
    target1 = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
    target2 = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f002.jpg',
    );
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('reports zero disagreements when the manifest and provenance agree', async () => {
    const store = new FakeObjectStore();
    await storeAsset(
      new TextEncoder().encode('page one bytes'),
      target1,
      provenance('PB-P001'),
      archiveRoot,
      { objectStore: store, objectStoreCoords: COORDS },
    );
    await storeAsset(
      new TextEncoder().encode('page two bytes'),
      target2,
      provenance('PB-P002'),
      archiveRoot,
      { objectStore: store, objectStoreCoords: COORDS },
    );

    const disagreements = await auditManifestProvenance(archiveRoot);
    expect(disagreements).toEqual([]);
  });

  it('reports exactly the one entry whose companion YAML sha256 was corrupted', async () => {
    const store = new FakeObjectStore();
    await storeAsset(
      new TextEncoder().encode('page one bytes'),
      target1,
      provenance('PB-P001'),
      archiveRoot,
      { objectStore: store, objectStoreCoords: COORDS },
    );
    await storeAsset(
      new TextEncoder().encode('page two bytes'),
      target2,
      provenance('PB-P002'),
      archiveRoot,
      { objectStore: store, objectStoreCoords: COORDS },
    );

    // Corrupt target2's companion YAML: rewrite its recorded sha256 to a
    // different, well-formed 64-hex-char value so the manifest and
    // provenance disagree for exactly this one asset.
    const yamlPath = companionYamlPath(target2);
    const original = readFileSync(yamlPath, 'utf-8');
    const fakeSha = '0'.repeat(64);
    const corrupted = original.replace(
      /^sha256: "[0-9a-f]{64}"$/m,
      `sha256: "${fakeSha}"`,
    );
    expect(corrupted).not.toBe(original);
    writeFileSync(yamlPath, corrupted, 'utf-8');

    const relPath2 = path.relative(archiveRoot, target2);
    const disagreements = await auditManifestProvenance(archiveRoot);
    expect(disagreements).toHaveLength(1);
    expect(disagreements[0].relPath).toBe(relPath2);
    expect(disagreements[0].provenanceSha256).toBe(fakeSha);
    expect(disagreements[0].manifestSha256).not.toBe(fakeSha);
  });

  it('throws when the manifest itself is missing (structural failure)', async () => {
    await expect(auditManifestProvenance(archiveRoot)).rejects.toThrow(
      /manifest/i,
    );
  });
});
