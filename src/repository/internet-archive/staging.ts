/**
 * `stageFile` + the object-store key layout -- the per-session PDF staging
 * module for the Internet Archive acquisition adapter
 * (specs/013-archiveorg-acquisition-path). Implements `acquire` steps 2
 * ("Fetch PDF -> staging ... Record fixity") and 7/8 (the object-store key
 * layout an upload step writes to, and the post-success staging cleanup) --
 * see `contracts/internet-archive-adapter.md` and `data-model.md` §
 * "Object-store key layout".
 *
 * `stagingRoot` is always an EXPLICIT caller-supplied value (the
 * `InternetArchiveAdapterDeps.stagingRoot` seam, itself derived from
 * `resolveArchiveRoot` in `@/archive/location` -- see that module's
 * `COLONY_ARCHIVE_ROOT` resolution). This module never reads
 * `COLONY_ARCHIVE_ROOT` (or any env var) itself; it only ever receives a
 * resolved root, per the no-silent-shared-default rule (TASK-19).
 *
 * Fail-loud (Principle V): `stageFile` throws on an empty fetch rather than
 * staging a zero-byte file, and never fabricates fixity for bytes it did
 * not itself fetch.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256OfBytes } from '@/archive/checksum';
import type { ArchiveHttpClient } from '@/repository/internet-archive/metadata';

/** Fixity + location of one staged file (contract step 2's "record fixity"). */
export interface StagedFile {
  /** Absolute path of the staged file on disk. */
  path: string;
  /** Size of the staged bytes, in bytes. */
  byteLength: number;
  /** Lowercase-hex SHA-256 of the staged bytes (`@/archive/checksum`). */
  sha256: string;
}

/**
 * Fetch `downloadUrl` via the injected `client` and write the bytes to
 * `destPath` (creating any missing parent directories), returning the
 * staged file's fixity.
 *
 * **Cache-first (Principle XII / D-11 -- never waste a request).** If a
 * non-empty file already exists at `destPath` (staged by an earlier
 * `--dry-run` examine pass, or a prior interrupted run), its bytes are
 * re-read from disk and its fixity returned WITHOUT calling `client.getBytes`
 * -- so a `--dry-run` followed by the real acquire re-reads the verified
 * local master and re-downloads NOTHING. The staged file IS the cache; the
 * caller re-verifies it against the recorded `qualityAssessment` checksum
 * before acting, so a stale/corrupt cache fails the gate rather than being
 * silently trusted.
 *
 * Fails loud rather than staging a zero-byte file: an empty response from
 * `client.getBytes` (or a 0-byte file already on disk) throws, since a 0-byte
 * "PDF" is never a legitimate archive.org asset and silently staging it would
 * let a transport failure masquerade as a successful fetch.
 */
export async function stageFile(
  downloadUrl: string,
  destPath: string,
  client: ArchiveHttpClient,
): Promise<StagedFile> {
  if (downloadUrl.trim().length === 0) {
    throw new Error('stageFile: downloadUrl is required.');
  }
  if (destPath.trim().length === 0) {
    throw new Error('stageFile: destPath is required.');
  }

  const cached = await readStagedFile(destPath);
  if (cached !== undefined) {
    return cached;
  }

  const bytes = await client.getBytes(downloadUrl);
  if (bytes.byteLength === 0) {
    throw new Error(
      `stageFile: fetching ${downloadUrl} returned empty bytes -- refusing to stage a 0-byte file.`,
    );
  }

  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, bytes);

  return {
    path: destPath,
    byteLength: bytes.byteLength,
    sha256: sha256OfBytes(bytes),
  };
}

/**
 * Re-read an already-staged file's fixity from disk (the XII cache path), or
 * `undefined` when nothing usable is staged at `destPath`. A 0-byte staged
 * file throws -- it is never a legitimate cached asset and must not shadow a
 * real re-fetch silently.
 */
async function readStagedFile(destPath: string): Promise<StagedFile | undefined> {
  let exists = false;
  try {
    const info = await stat(destPath);
    exists = info.isFile();
  } catch {
    return undefined;
  }
  if (!exists) {
    return undefined;
  }
  const bytes = await readFile(destPath);
  if (bytes.byteLength === 0) {
    throw new Error(
      `stageFile: a 0-byte file is already staged at ${destPath} -- refusing to reuse it; delete it and re-stage.`,
    );
  }
  return {
    path: destPath,
    byteLength: bytes.byteLength,
    sha256: sha256OfBytes(bytes),
  };
}

/**
 * The per-item staging directory: `<stagingRoot>/.staging/internet-archive/<itemId>`.
 * A private, per-session scratch location under the caller-supplied
 * `stagingRoot` (never a shared/global path -- see the module doc comment).
 */
export function stagingDir(stagingRoot: string, itemId: string): string {
  if (stagingRoot.trim().length === 0) {
    throw new Error('stagingDir: stagingRoot is required.');
  }
  if (itemId.trim().length === 0) {
    throw new Error('stagingDir: itemId is required.');
  }
  return join(stagingRoot, '.staging', 'internet-archive', itemId);
}

/**
 * Recursively delete a staging directory on successful completion (contract
 * step 8: "On success (non-dry-run), delete staging"). Tolerant of an
 * already-absent directory (`force: true`) -- cleanup is idempotent, not a
 * signal that something is wrong.
 */
export async function cleanupStaging(dir: string): Promise<void> {
  if (dir.trim().length === 0) {
    throw new Error('cleanupStaging: dir is required.');
  }
  await rm(dir, { recursive: true, force: true });
}

/** The stable object-store key prefix all Internet Archive assets live under. */
const KEY_PREFIX = 'archive/internet-archive';

/**
 * The object-store key for the repository-source PDF, per data-model.md §
 * "Object-store key layout": `archive/internet-archive/<item-id>/source/<sha256>.pdf`.
 */
export function sourceObjectKey(itemId: string, sha256: string): string {
  if (itemId.trim().length === 0) {
    throw new Error('sourceObjectKey: itemId is required.');
  }
  if (sha256.trim().length === 0) {
    throw new Error('sourceObjectKey: sha256 is required.');
  }
  return `${KEY_PREFIX}/${itemId}/source/${sha256}.pdf`;
}

/**
 * The object-store key for one page-master image, per data-model.md §
 * "Object-store key layout":
 * `archive/internet-archive/<item-id>/pages/<logicalPage>-<sha256>.jpg`.
 */
export function pageMasterObjectKey(itemId: string, logicalPage: number, sha256: string): string {
  if (itemId.trim().length === 0) {
    throw new Error('pageMasterObjectKey: itemId is required.');
  }
  if (!Number.isInteger(logicalPage) || logicalPage < 1) {
    throw new Error(
      `pageMasterObjectKey: logicalPage must be a positive integer, got ${logicalPage}.`,
    );
  }
  if (sha256.trim().length === 0) {
    throw new Error('pageMasterObjectKey: sha256 is required.');
  }
  return `${KEY_PREFIX}/${itemId}/pages/${logicalPage}-${sha256}.jpg`;
}
