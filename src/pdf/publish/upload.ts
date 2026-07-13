/**
 * Idempotent, immutable uploader for published edition artifacts over an
 * injected {@link ObjectStore} (spec 008, contract guarantees G-3 + G-4).
 *
 * Versioned publish keys are IMMUTABLE (FR-009/FR-011): a given key names one
 * exact set of bytes for all time. This module enforces that at the object
 * level, mirroring the archive-writer's head-then-put posture but without the
 * archive-root scoping of `storeAsset`:
 *
 *   - HEAD the key.
 *   - Absent  -> PUT and report `{ uploaded: true }`.
 *   - Present with the SAME sha256 -> skip the PUT, report `{ uploaded: false }`
 *     (idempotent re-run, G-4).
 *   - Present with a DIFFERENT sha256 (or no recorded sha256 to compare) ->
 *     THROW. A versioned key must never be overwritten (G-3). Failing loud is
 *     the whole point: a hash contradiction means either a bug in key
 *     derivation or an attempt to mutate a published artifact, and silently
 *     overwriting would destroy the immutability guarantee.
 */

import type { ObjectStore } from '@/archive/object-store';

/** MIME type recorded on every published edition artifact. */
const PDF_CONTENT_TYPE = 'application/pdf';

/** Outcome of an {@link uploadArtifact} call. */
export interface UploadResult {
  /** True when bytes were PUT; false when an identical object already existed. */
  uploaded: boolean;
}

/**
 * Upload `bytes` to `key` idempotently and immutably.
 *
 * @param store  Injected object store (real backend or an in-memory fake).
 * @param key    The versioned, immutable publish key.
 * @param bytes  The artifact bytes to persist.
 * @param sha256 Lowercase-hex SHA-256 of `bytes`, used as the identity check.
 * @throws When an object already exists at `key` whose recorded sha256 does not
 *   match `sha256` (including an existing object that carries no sha256
 *   metadata to compare) — an immutability contradiction that must never be
 *   silently overwritten.
 */
export async function uploadArtifact(
  store: ObjectStore,
  key: string,
  bytes: Uint8Array,
  sha256: string,
): Promise<UploadResult> {
  const existing = await store.head(key);

  if (!existing.exists) {
    await store.put(key, bytes, { sha256, contentType: PDF_CONTENT_TYPE });
    return { uploaded: true };
  }

  if (existing.sha256 === sha256) {
    return { uploaded: false };
  }

  throw new Error(
    `uploadArtifact: immutability violation at versioned key "${key}" — ` +
      `an object already exists with sha256 ${existing.sha256 ?? '(no recorded sha256 metadata)'} ` +
      `but the new bytes hash to ${sha256}. A versioned publish key must never be ` +
      `overwritten (G-3, FR-009/FR-011); refusing to PUT.`,
  );
}
