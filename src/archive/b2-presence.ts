import { sha256OfBytes, md5OfBytes } from '@/archive/checksum';
import type { ObjectStore } from '@/archive/object-store';

/**
 * Whether an object is already present in the store at a key with content
 * identical to a set of local bytes, and whether that presence was established
 * WITHOUT our `sha256` metadata (so a server-side metadata backfill is needed
 * to make the next run hit the cheap fast path).
 */
export interface B2Presence {
  /** True when the store already holds byte-identical content at the key. */
  present: boolean;
  /**
   * True when presence was proven by content (ETag or full-body hash) rather
   * than by our `sha256` metadata -- the object was placed without it and
   * should be metadata-backfilled.
   */
  needMetaBackfill: boolean;
}

/**
 * Tiered, content-based presence check for the object-store idempotent skip
 * (FR-006). Cheapest signals first, escalating only when needed:
 *
 * 1. `head` reports no object -> NOT present (upload).
 * 2. `head.sha256 === localSha256` -> present via OUR metadata (fast path, no
 *    backfill). This is the state every run converges to.
 * 3. size matches AND a single-part ETag (no `-`) equals the content MD5 ->
 *    present by content, cheaply, for an object placed WITHOUT our metadata
 *    (e.g. a bulk rclone copy). Needs a metadata backfill. (MD5 is only an
 *    identity signal here, corroborated by the size match -- see md5OfBytes.)
 * 4. Otherwise (metadata mismatch, missing/multipart ETag, or size mismatch)
 *    fetch the bytes and compare full SHA-256. Match -> present, backfill;
 *    mismatch or a failed fetch -> NOT present (upload). This never treats a
 *    size collision or a genuinely-different object as "already done".
 */
export async function resolveB2Presence(
  store: ObjectStore,
  key: string,
  bytes: Uint8Array,
  localSha256: string,
): Promise<B2Presence> {
  const head = await store.head(key);

  if (head.exists !== true) {
    return { present: false, needMetaBackfill: false };
  }
  if (head.sha256 === localSha256) {
    return { present: true, needMetaBackfill: false };
  }
  if (
    head.size === bytes.length &&
    head.etag !== undefined &&
    !head.etag.includes('-') &&
    md5OfBytes(bytes) === head.etag
  ) {
    return { present: true, needMetaBackfill: true };
  }

  // Fallback: authoritative full-body SHA-256 comparison. A missing object or
  // any transport error here is treated as "not present" -> upload, never a
  // silent skip.
  try {
    const remote = await store.get(key);
    if (sha256OfBytes(remote) === localSha256) {
      return { present: true, needMetaBackfill: true };
    }
    return { present: false, needMetaBackfill: false };
  } catch {
    return { present: false, needMetaBackfill: false };
  }
}
