import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storeAsset, companionYamlPath } from '@/archive/store';
import { objectKeyForAsset } from '@/archive/object-key';
import type { ProvenanceFields } from '@/archive/provenance';
import { FakeObjectStore } from '../unit/archive/fake-object-store';

/**
 * SC-001 proof (T017): image master bytes never enter git.
 *
 * This test drives a THROWAWAY git repo created in a temp dir -- it never
 * touches the real project repo, and the product code under test
 * (`storeAsset`) never calls git itself. Only the test harness invokes `git`,
 * purely to observe what a real archive worktree's `git status` would report
 * for a page image written under its `.gitignore`.
 */

const GITIGNORE_CONTENTS = [
  'archive/cases/**/*.jpg',
  'archive/cases/**/*.jpeg',
  'archive/cases/**/*.png',
  '',
].join('\n');

const COORDS = {
  provider: 'backblaze-b2',
  bucket: 'colony-cults',
  endpoint: 'https://s3.us-west-004.backblazeb2.com',
};

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

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

describe('SC-001: no image master bytes enter git (T017)', () => {
  let archiveRoot: string;
  let target: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-sc001-'));

    // 1 + 2. Init a throwaway git repo standing in for the archive worktree,
    // with the same image-master ignores the real archive worktree uses.
    git(archiveRoot, ['init', '--quiet']);
    git(archiveRoot, ['config', 'user.name', 'SC-001 Test']);
    git(archiveRoot, ['config', 'user.email', 'sc001-test@example.invalid']);
    writeFileSync(path.join(archiveRoot, '.gitignore'), GITIGNORE_CONTENTS, 'utf-8');
    git(archiveRoot, ['add', '.gitignore']);
    git(archiveRoot, ['commit', '--quiet', '-m', 'chore: ignore image masters']);

    target = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('leaves the local OCR cache on disk while keeping the .jpg out of git status, with the master in the object store', async () => {
    const bytes = new TextEncoder().encode('the page image bytes');
    const fake = new FakeObjectStore();
    const expectedKey = objectKeyForAsset(archiveRoot, target);

    // 3. Store the asset, exactly as the fetch pipeline would for a page image.
    await storeAsset(bytes, target, provenance(), archiveRoot, {
      objectStore: fake,
      objectStoreCoords: COORDS,
    });

    // 4a. Local cache .jpg exists -- we don't lose local (OCR) access.
    expect(existsSync(target)).toBe(true);
    expect(existsSync(companionYamlPath(target))).toBe(true);

    // 4b. SC-001 proof: git status lists no .jpg path -- the master is
    // git-ignored. The companion .yml and manifest DO show up as untracked;
    // that is expected, so assert specifically on the .jpg extension.
    const status = git(archiveRoot, ['status', '--porcelain']);
    const statusLines = status.split('\n').filter((line) => line.length > 0);
    expect(statusLines.length).toBeGreaterThan(0);
    const jpgLines = statusLines.filter((line) => line.endsWith('.jpg'));
    expect(jpgLines).toEqual([]);

    // 4c. The master bytes DID reach the object store.
    expect(fake.has(expectedKey)).toBe(true);
    const stored = await fake.get(expectedKey);
    expect(stored).toEqual(bytes);
  });
});
