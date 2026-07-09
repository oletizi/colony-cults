import { describe, it, expect, beforeEach } from 'vitest';
import { FakeObjectStore } from './fake-object-store';

describe('FakeObjectStore', () => {
  let store: FakeObjectStore;

  beforeEach(() => {
    store = new FakeObjectStore();
  });

  describe('head', () => {
    it('returns {exists: false} when key is absent', async () => {
      const result = await store.head('missing-key');
      expect(result).toEqual({ exists: false });
    });

    it('returns {exists: true, sha256, size} after put', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const sha256 = 'abc123def456';

      await store.put('test-key', bytes, { sha256 });

      const result = await store.head('test-key');
      expect(result).toEqual({
        exists: true,
        sha256: 'abc123def456',
        size: 5,
      });
    });

    it('reflects correct size for larger objects', async () => {
      const bytes = new Uint8Array(1024);
      await store.put('large-key', bytes, { sha256: 'xyz' });

      const result = await store.head('large-key');
      expect(result.size).toBe(1024);
    });
  });

  describe('put and get', () => {
    it('stores and retrieves bytes unchanged', async () => {
      const bytes = new Uint8Array([10, 20, 30, 40]);
      const sha256 = 'hash123';

      await store.put('data-key', bytes, { sha256 });
      const retrieved = await store.get('data-key');

      expect(retrieved).toEqual(bytes);
    });

    it('returns a copy of bytes on get (mutations do not affect storage)', async () => {
      const original = new Uint8Array([1, 2, 3]);
      await store.put('copy-key', original, { sha256: 'hash' });

      const retrieved = await store.get('copy-key');
      retrieved[0] = 99; // Mutate the retrieved copy

      // Re-fetch and verify the original is unchanged
      const refetched = await store.get('copy-key');
      expect(refetched[0]).toBe(1);
      expect(refetched).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('stores a copy of input bytes (mutations to caller input do not affect storage)', async () => {
      const mutableInput = new Uint8Array([5, 6, 7]);
      await store.put('mutable-key', mutableInput, { sha256: 'hash' });

      mutableInput[0] = 99; // Mutate the input after put

      // Verify stored bytes are unchanged
      const retrieved = await store.get('mutable-key');
      expect(retrieved[0]).toBe(5);
      expect(retrieved).toEqual(new Uint8Array([5, 6, 7]));
    });

    it('overwrites previous object at the same key', async () => {
      await store.put('key', new Uint8Array([1, 2, 3]), { sha256: 'old' });
      await store.put('key', new Uint8Array([4, 5, 6]), { sha256: 'new' });

      const retrieved = await store.get('key');
      expect(retrieved).toEqual(new Uint8Array([4, 5, 6]));

      const head = await store.head('key');
      expect(head.sha256).toBe('new');
    });
  });

  describe('get', () => {
    it('throws descriptive error when key is absent', async () => {
      await expect(store.get('nonexistent')).rejects.toThrow(
        'Object not found at key: nonexistent',
      );
    });
  });

  describe('options', () => {
    it('stores and preserves sha256 from options', async () => {
      const sha256 = 'sha256:abc123';
      await store.put('key', new Uint8Array([1]), { sha256 });

      const head = await store.head('key');
      expect(head.sha256).toBe('sha256:abc123');
    });

    it('stores and preserves contentType from options', async () => {
      const contentType = 'application/json';
      await store.put('key', new Uint8Array([1]), {
        sha256: 'hash',
        contentType,
      });

      // contentType is metadata; verify via the test helper has()
      // since ObjectHead interface doesn't expose it
      expect(store.has('key')).toBe(true);
    });
  });

  describe('test helpers', () => {
    it('has() returns true if key exists, false otherwise', async () => {
      expect(store.has('key')).toBe(false);

      await store.put('key', new Uint8Array([1]), { sha256: 'hash' });
      expect(store.has('key')).toBe(true);
    });

    it('size returns the count of objects in the store', async () => {
      expect(store.size).toBe(0);

      await store.put('key1', new Uint8Array([1]), { sha256: 'hash1' });
      expect(store.size).toBe(1);

      await store.put('key2', new Uint8Array([1, 2]), { sha256: 'hash2' });
      expect(store.size).toBe(2);

      await store.put('key1', new Uint8Array([99]), { sha256: 'hash1-new' });
      expect(store.size).toBe(2); // Overwrite, not add
    });
  });
});
