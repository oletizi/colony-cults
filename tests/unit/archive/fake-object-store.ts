import { ObjectStore, ObjectHead, PutOptions } from '@/archive/object-store';

interface StoredObject {
  bytes: Uint8Array;
  sha256: string;
  contentType?: string;
}

/**
 * In-memory ObjectStore implementation for testing.
 *
 * Stores objects in a Map, backing all ObjectStore methods with
 * deterministic behavior. Designed for unit tests that need to inject
 * an ObjectStore without hitting a real backend.
 */
export class FakeObjectStore implements ObjectStore {
  private store: Map<string, StoredObject> = new Map();

  /**
   * Fetch metadata for a key.
   *
   * Returns `{ exists: false }` if the key is absent; returns
   * `{ exists: true, sha256, size }` if present.
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
    };
  }

  /**
   * Store bytes at a key with metadata.
   *
   * Creates a copy of the input bytes to isolate from caller mutations.
   * Overwrites any existing object at the key.
   */
  async put(key: string, bytes: Uint8Array, options: PutOptions): Promise<void> {
    this.store.set(key, {
      bytes: new Uint8Array(bytes),
      sha256: options.sha256,
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
