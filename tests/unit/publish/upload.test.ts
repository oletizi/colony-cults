import { describe, it, expect } from 'vitest';
import { sha256OfBytes } from '@/archive/checksum';
import { uploadArtifact } from '@/pdf/publish/upload';
import { FakeObjectStore } from '../archive/fake-object-store';
import type { PutOptions } from '@/archive/object-store';

/**
 * Counting FakeObjectStore that records how many times `put` was invoked, so
 * tests can prove "the immutable/idempotent uploader never re-wrote a key".
 */
class CountingStore extends FakeObjectStore {
  putCount = 0;

  override async put(
    key: string,
    bytes: Uint8Array,
    options: PutOptions,
  ): Promise<void> {
    this.putCount += 1;
    await super.put(key, bytes, options);
  }
}

const KEY = 'archive/editions/2026/report-v1.pdf';

describe('uploadArtifact — idempotent, immutable versioned upload (G-3/G-4)', () => {
  it('new key: puts once and reports uploaded', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 fresh edition');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingStore();

    const result = await uploadArtifact(store, KEY, bytes, sha256);

    expect(result).toEqual({ uploaded: true });
    expect(store.putCount).toBe(1);
    expect(store.has(KEY)).toBe(true);
    expect((await store.head(KEY)).sha256).toBe(sha256);
    expect(store.contentTypeOf(KEY)).toBe('application/pdf');
  });

  it('existing key with identical sha256: skips (zero put), reports not uploaded', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 already published');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingStore();
    // Seed the store with our sha256 metadata, mirroring a prior upload.
    await store.put(KEY, bytes, { sha256, contentType: 'application/pdf' });
    const seededPuts = store.putCount;

    const result = await uploadArtifact(store, KEY, bytes, sha256);

    expect(result).toEqual({ uploaded: false });
    expect(store.putCount).toBe(seededPuts);
  });

  it('existing key with DIFFERENT sha256: throws, never overwrites', async () => {
    const original = new TextEncoder().encode('%PDF-1.7 the published bytes');
    const originalSha = sha256OfBytes(original);
    const store = new CountingStore();
    await store.put(KEY, original, {
      sha256: originalSha,
      contentType: 'application/pdf',
    });
    const seededPuts = store.putCount;

    const different = new TextEncoder().encode('%PDF-1.7 tampered bytes');
    const differentSha = sha256OfBytes(different);
    expect(differentSha).not.toBe(originalSha);

    await expect(
      uploadArtifact(store, KEY, different, differentSha),
    ).rejects.toThrow(/immutab/i);

    // No overwrite happened: put count unchanged, bytes still the original.
    expect(store.putCount).toBe(seededPuts);
    expect((await store.head(KEY)).sha256).toBe(originalSha);
  });

  it('existing key without our sha256 metadata: throws (cannot prove identity)', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 externally placed');
    const sha256 = sha256OfBytes(bytes);
    const store = new CountingStore();
    // seedExternal places bytes WITHOUT our sha256 metadata.
    store.seedExternal(KEY, bytes);
    const seededPuts = store.putCount;

    await expect(uploadArtifact(store, KEY, bytes, sha256)).rejects.toThrow(
      /immutab/i,
    );
    expect(store.putCount).toBe(seededPuts);
  });
});
