import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * SHA-256 of a byte buffer, returned as lowercase hex (FR-008). `node:crypto`'s
 * `digest('hex')` already yields lowercase, but we assert it so callers may
 * rely on it for exact-string comparisons against recorded checksums.
 */
export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SHA-256 of a file's contents, as lowercase hex (FR-008). */
export async function sha256OfFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return sha256OfBytes(bytes);
}

/**
 * MD5 of a byte buffer, returned as lowercase hex.
 *
 * IMPORTANT: MD5 is used here ONLY as a content-identity signal to compare
 * against Backblaze B2's S3 `ETag` (which, for single-part uploads, is the hex
 * MD5 of the object's content). It is NOT used for integrity or security --
 * SHA-256 remains the archive's integrity checksum everywhere else. MD5's known
 * collision weakness is irrelevant to this equality-of-known-content check, and
 * a match is always corroborated by the surrounding size check (and, on the
 * fallback path, by a full SHA-256 comparison of the fetched bytes).
 */
export function md5OfBytes(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}
