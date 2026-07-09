import { ObjectStore, ObjectHead, PutOptions } from '@/archive/object-store';
import { md5OfBytes } from '@/archive/checksum';

interface StoredObject {
  bytes: Uint8Array;
  /** Our `sha256` metadata -- absent for objects placed without it (rclone). */
  sha256?: string;
  /** Hex MD5 of the bytes, surfaced as the ETag (single-part identity). */
  etag: string;
  contentType?: string;
}

/**
 * In-memory ObjectStore implementation for testing.
 *
 * Stores objects in a Map, backing all ObjectStore methods with
 * deterministic behavior. Designed for unit tests that need to inject
 * an ObjectStore without hitting a real backend.
 *
 * Every stored object carries a hex-MD5 `etag` (mirroring B2's single-part
 * ETag). Objects written via {@link put} additionally carry our `sha256`
 * metadata; objects written via {@link seedExternal} carry NO sha256, modelling
 * an object placed by another tool (e.g. a bulk rclone copy) so tests can
 * exercise the ETag/content-identity skip and metadata-backfill paths.
 */
export class FakeObjectStore implements ObjectStore {
  private store: Map<string, StoredObject> = new Map();

  /**
   * Fetch metadata for a key.
   *
   * Returns `{ exists: false }` if the key is absent; otherwise returns
   * `{ exists: true, size, etag }` plus `sha256` only when the object was
   * stored with our sha256 metadata (a `seedExternal` object reports
   * `sha256: undefined`, like an rclone-placed object in B2).
   */
  async head(key: string): Promise<ObjectHead> {
    const obj = this.store.get(key);
    if (!obj) {
      return { exists: false };
    }
    return {
      exists: true,
      sha256: obj.sha256,
      size: obj.bytes.length,
      etag: obj.etag,
    };
  }

  /**
   * Store bytes at a key with metadata.
   *
   * Creates a copy of the input bytes to isolate from caller mutations.
   * Overwrites any existing object at the key. Records the ETag as the hex MD5
   * of the bytes, matching a B2 single-part upload.
   */
  async put(key: string, bytes: Uint8Array, options: PutOptions): Promise<void> {
    const copy = new Uint8Array(bytes);
    this.store.set(key, {
      bytes: copy,
      sha256: options.sha256,
      etag: md5OfBytes(copy),
      contentType: options.contentType,
    });
  }

  /**
   * Fetch bytes stored at a key.
   *
   * Returns a copy of the stored bytes to isolate from caller mutations.
   * Throws if the key is absent.
   */
  async get(key: string): Promise<Uint8Array> {
    const obj = this.store.get(key);
    if (!obj) {
      throw new Error(`Object not found at key: ${key}`);
    }
    return new Uint8Array(obj.bytes);
  }

  /**
   * Set/replace the object's `sha256` metadata without re-uploading bytes,
   * mirroring the server-side metadata rewrite the real backend performs.
   * Throws if the key is absent (there is nothing to rewrite).
   */
  async attachSha256Metadata(
    key: string,
    sha256: string,
    contentType?: string,
  ): Promise<void> {
    const obj = this.store.get(key);
    if (!obj) {
      throw new Error(
        `FakeObjectStore.attachSha256Metadata: no object at key: ${key}`,
      );
    }
    obj.sha256 = sha256;
    if (contentType !== undefined) {
      obj.contentType = contentType;
    }
  }

  /**
   * Test helper: place bytes at a key WITHOUT our sha256 metadata, computing
   * the ETag (hex MD5) as B2 would for a single-part upload. Simulates an
   * object placed by another tool (e.g. a bulk rclone copy of masters): a
   * subsequent `head` returns `sha256: undefined` with the `etag` present.
   */
  seedExternal(key: string, bytes: Uint8Array): void {
    const copy = new Uint8Array(bytes);
    this.store.set(key, {
      bytes: copy,
      etag: md5OfBytes(copy),
    });
  }

  /**
   * Test helper: force a specific ETag for a key (e.g. a multipart-style
   * `<hash>-<N>` value that does NOT equal the content MD5), so tests can
   * exercise the fallback get()+hash path. Throws if the key is absent.
   */
  overrideEtag(key: string, etag: string): void {
    const obj = this.store.get(key);
    if (!obj) {
      throw new Error(`FakeObjectStore.overrideEtag: no object at key: ${key}`);
    }
    obj.etag = etag;
  }

  /**
   * Test helper: check if a key exists in the store.
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Test helper: return the contentType stored for a key, or undefined if
   * the key is absent or was put without a contentType. Not part of the
   * ObjectStore interface (contentType is write-only metadata there) --
   * exists solely so tests can assert put() actually persisted it.
   */
  contentTypeOf(key: string): string | undefined {
    return this.store.get(key)?.contentType;
  }

  /**
   * Test helper: remove an object, simulating it going missing from the
   * backend (e.g. a deleted or never-completed upload) so callers can
   * exercise the "object missing in B2" verification path.
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Test helper: count of objects in the store.
   */
  get size(): number {
    return this.store.size;
  }
}
