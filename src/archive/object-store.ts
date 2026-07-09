/**
 * `ObjectStore` is the injected, S3-compatible object storage abstraction
 * that the archive-writer depends on. It exposes only the primitives the
 * writer needs (head/put/get) so that concrete backends (e.g. Backblaze B2,
 * AWS S3, an in-memory fake for tests) can be swapped via dependency
 * injection without the writer knowing which backend is in play.
 *
 * This module is types-only: it declares the contract, not an
 * implementation. Concrete implementations live in sibling modules and must
 * throw descriptive `Error`s on failure rather than returning fallback or
 * mock data.
 */

/**
 * Result of a HEAD against an object key.
 *
 * `exists: false` is a normal, non-error outcome representing "no object at
 * this key yet" — callers use it to decide whether a PUT is needed. Only
 * transport- or auth-level failures should cause `head` to throw.
 */
export interface ObjectHead {
  /** Whether an object currently exists at the requested key. */
  exists: boolean;
  /** sha256 stored as object metadata on PUT, when present. */
  sha256?: string;
  /** Object size in bytes, when the store reports it. */
  size?: number;
}

/** Options for a PUT. */
export interface PutOptions {
  /** sha256 to persist as object metadata (drives idempotent skip). */
  sha256: string;
  /** MIME type, e.g. image/jpeg. */
  contentType?: string;
}

/**
 * S3-compatible object store the archive-writer depends on (injected).
 *
 * Implementations must throw descriptive `Error`s on failure — no silent
 * success, no fallback values, and no mock data outside of test doubles.
 */
export interface ObjectStore {
  /**
   * Fetch metadata for a key.
   *
   * Returns `{ exists: false }` when no object is present at `key`; this is
   * not an error condition. Throws on transport or authentication errors.
   */
  head(key: string): Promise<ObjectHead>;

  /**
   * Upload bytes at `key` with the given metadata.
   *
   * Throws on failure — a resolved promise must mean the object was
   * actually persisted (no silent success).
   */
  put(key: string, bytes: Uint8Array, options: PutOptions): Promise<void>;

  /**
   * Fetch bytes stored at `key`.
   *
   * Throws when the object is missing or on transport error.
   */
  get(key: string): Promise<Uint8Array>;
}
