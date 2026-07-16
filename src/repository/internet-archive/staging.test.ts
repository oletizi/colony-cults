/**
 * Tests for `@/repository/internet-archive/staging` (T021/T022), the
 * per-session PDF staging module for the Internet Archive acquisition
 * adapter (specs/013-archiveorg-acquisition-path). Covers:
 *   - `stageFile`: fetch via an injected {@link ArchiveHttpClient}, write to
 *     disk, and record fixity (byteLength + sha256, `@/archive/checksum`).
 *   - `stagingDir`: the per-item staging subdirectory layout.
 *   - `cleanupStaging`: recursive delete, tolerant of an already-absent dir.
 *   - `sourceObjectKey` / `pageMasterObjectKey`: the exact B2 key strings per
 *     data-model.md § Object-store key layout.
 *
 * No network access, no real B2 -- `ArchiveHttpClient` is faked and all
 * staging happens under a unique `os.tmpdir()` subdirectory cleaned up by
 * this test itself.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256OfBytes } from '@/archive/checksum';
import type { ArchiveHttpClient } from '@/repository/internet-archive/metadata';
import {
  stageFile,
  stagingDir,
  cleanupStaging,
  sourceObjectKey,
  pageMasterObjectKey,
} from '@/repository/internet-archive/staging';

/** A fake {@link ArchiveHttpClient} whose `getBytes` returns fixed bytes, never touching the network. */
function fakeClient(bytesByUrl: Readonly<Record<string, Uint8Array>>): ArchiveHttpClient {
  return {
    getText: async (_url: string) => {
      throw new Error('fakeClient: getText is not used by stageFile.');
    },
    getBytes: async (url: string) => {
      const bytes = bytesByUrl[url];
      if (bytes === undefined) {
        throw new Error(`fakeClient: no fixture bytes registered for ${url}`);
      }
      return bytes;
    },
  };
}

const DOWNLOAD_URL = 'https://archive.org/download/some-item/some-item.pdf';
const CONTENT = new TextEncoder().encode('a small fake PDF payload for staging tests');
const EXPECTED_SHA256 = sha256OfBytes(CONTENT);

let workDir: string | undefined;

async function freshTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'colony-staging-test-'));
  workDir = dir;
  return dir;
}

afterEach(async () => {
  if (workDir !== undefined) {
    await rm(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

describe('stageFile', () => {
  it('fetches bytes via the injected client and writes them to destPath', async () => {
    const root = await freshTempRoot();
    const destPath = join(root, 'nested', 'source.pdf');
    const client = fakeClient({ [DOWNLOAD_URL]: CONTENT });

    await stageFile(DOWNLOAD_URL, destPath, client);

    const written = await readFile(destPath);
    expect(new Uint8Array(written)).toEqual(CONTENT);
  });

  it('returns fixity matching the shipped sha256 util and the actual byte length', async () => {
    const root = await freshTempRoot();
    const destPath = join(root, 'source.pdf');
    const client = fakeClient({ [DOWNLOAD_URL]: CONTENT });

    const staged = await stageFile(DOWNLOAD_URL, destPath, client);

    expect(staged.path).toBe(destPath);
    expect(staged.byteLength).toBe(CONTENT.byteLength);
    expect(staged.sha256).toBe(EXPECTED_SHA256);
  });

  it('creates parent directories that do not yet exist', async () => {
    const root = await freshTempRoot();
    const destPath = join(root, 'a', 'b', 'c', 'source.pdf');
    const client = fakeClient({ [DOWNLOAD_URL]: CONTENT });

    await stageFile(DOWNLOAD_URL, destPath, client);

    const info = await stat(destPath);
    expect(info.isFile()).toBe(true);
  });

  it('fails loud on empty bytes rather than staging a zero-byte file', async () => {
    const root = await freshTempRoot();
    const destPath = join(root, 'source.pdf');
    const client = fakeClient({ [DOWNLOAD_URL]: new Uint8Array() });

    await expect(stageFile(DOWNLOAD_URL, destPath, client)).rejects.toThrow(/empty/i);
  });
});

describe('stagingDir', () => {
  it('nests staging under <root>/.staging/internet-archive/<itemId>', () => {
    const root = '/some/archive/root';
    expect(stagingDir(root, 'nouvellefrancec00groogoog')).toBe(
      '/some/archive/root/.staging/internet-archive/nouvellefrancec00groogoog',
    );
  });
});

describe('cleanupStaging', () => {
  it('recursively removes an existing staging directory', async () => {
    const root = await freshTempRoot();
    const dir = join(root, 'internet-archive', 'some-item');
    const destPath = join(dir, 'source.pdf');
    const client = fakeClient({ [DOWNLOAD_URL]: CONTENT });
    await stageFile(DOWNLOAD_URL, destPath, client);

    await cleanupStaging(dir);

    await expect(stat(dir)).rejects.toThrow();
  });

  it('is safe to call when the directory is already absent', async () => {
    const root = await freshTempRoot();
    const neverCreated = join(root, 'does', 'not', 'exist');

    await expect(cleanupStaging(neverCreated)).resolves.toBeUndefined();
  });
});

describe('sourceObjectKey', () => {
  it('produces the exact documented repository-source key', () => {
    expect(sourceObjectKey('nouvellefrancec00groogoog', 'deadbeef')).toBe(
      'archive/internet-archive/nouvellefrancec00groogoog/source/deadbeef.pdf',
    );
  });
});

describe('pageMasterObjectKey', () => {
  it('produces the exact documented page-master key', () => {
    expect(pageMasterObjectKey('nouvellefrancec00groogoog', 12, 'deadbeef')).toBe(
      'archive/internet-archive/nouvellefrancec00groogoog/pages/12-deadbeef.jpg',
    );
  });
});
