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
