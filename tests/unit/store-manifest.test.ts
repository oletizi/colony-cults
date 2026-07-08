import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storeAsset } from '@/archive/store';
import type { ProvenanceFields } from '@/archive/provenance';

const MANIFEST_REL = path.join('manifests', 'MANIFEST.sha256');

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
    format: 'image/jpeg',
    ocr_status: 'none',
    rights_raw: '<results/>',
    notes: null,
  };
}

/**
 * FR-006/integrity: the manifest must stay complete even across resumable
 * re-runs. If an asset is present + recorded on disk but its
 * `manifests/MANIFEST.sha256` line went missing (e.g. an interrupted earlier
 * run, or a manually-edited manifest), a skip must REPAIR the manifest entry
 * rather than leave the asset permanently unmanifested.
 */
describe('storeAsset manifest integrity on skip', () => {
  let archiveRoot: string;
  let target: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-store-'));
    target = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('repairs a missing manifest line on the skip path (no re-write)', async () => {
    const bytes = new TextEncoder().encode('the page bytes');
    const relPath = path.relative(archiveRoot, target);

    // First store: writes asset, sidecar, and the manifest entry.
    const first = await storeAsset(bytes, target, provenance(), archiveRoot);
    expect(first.skipped).toBe(false);

    const manifestPath = path.join(archiveRoot, MANIFEST_REL);
    const withEntry = await readFile(manifestPath, 'utf-8');
    expect(withEntry).toContain(relPath);

    // Simulate the manifest losing this asset's line (leaving a valid but
    // incomplete manifest with a different, unrelated entry).
    await writeFile(
      manifestPath,
      `${'0'.repeat(64)}  archive/cases/other/z.jpg\n`,
      'utf-8',
    );

    // Capture the asset's mtime so we can prove the skip path did NOT rewrite
    // the bytes (no re-download / re-write).
    const before = await stat(target);

    // Second store: same bytes, asset already recorded -> SKIP path.
    const second = await storeAsset(bytes, target, provenance(), archiveRoot);
    expect(second.skipped).toBe(true);
    expect(second.sha256).toBe(first.sha256);

    // The asset itself was not rewritten.
    const after = await stat(target);
    expect(after.mtimeMs).toBe(before.mtimeMs);

    // The manifest now contains the repaired entry again, still sorted by path.
    const repaired = await readFile(manifestPath, 'utf-8');
    expect(repaired).toContain(`${first.sha256}  ${relPath}`);
    expect(repaired).toContain('archive/cases/other/z.jpg');
    const paths = repaired
      .trimEnd()
      .split('\n')
      .map((line) => line.slice(66));
    expect(paths).toEqual([...paths].sort());
  });

  it('leaves an already-correct manifest untouched on skip', async () => {
    const bytes = new TextEncoder().encode('bytes b');
    const first = await storeAsset(bytes, target, provenance(), archiveRoot);
    expect(first.skipped).toBe(false);

    const manifestPath = path.join(archiveRoot, MANIFEST_REL);
    const before = await stat(manifestPath);

    const second = await storeAsset(bytes, target, provenance(), archiveRoot);
    expect(second.skipped).toBe(true);

    // No needless rewrite when the entry is already present and correct.
    const after = await stat(manifestPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
