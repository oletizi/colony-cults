import { describe, it, expect } from 'vitest';
import type { ObjectStore, ObjectHead } from '@/archive/object-store';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RepositoryRecord } from '@/model/repository-record';
import { verifyRecordComplete } from '@/sourcegroup/acquire-completeness';

/**
 * Tests for `verifyRecordComplete` (T002/T003, FR-002/FR-008/FR-009): the pure,
 * per-repository completeness verifier `runAcquire` calls before reporting
 * success. It fails loud (throws) rather than returning a boolean, so an
 * incomplete record can never slip past acquire (Principle XV, Principle V).
 * Pure over its injected inputs (the object store is injected; a fake answers
 * heads from an in-memory map) -- no network, no real object-store mutation
 * (FR-010).
 */

const CHECKSUM = 'c'.repeat(64);

/**
 * A fake {@link ObjectStore} whose `head` answers from an in-memory map keyed
 * by object-store key: absent -> `{ exists: false }`, a `{ sha256 }` ->
 * `{ exists: true, sha256 }`. `put`/`get`/`attachSha256Metadata` throw -- the
 * verifier only ever HEADs.
 */
function fakeObjectStore(entries: Record<string, { sha256?: string }>): ObjectStore {
  return {
    async head(key: string): Promise<ObjectHead> {
      const entry = entries[key];
      if (entry === undefined) {
        return { exists: false };
      }
      return entry.sha256 === undefined
        ? { exists: true }
        : { exists: true, sha256: entry.sha256 };
    },
    async put() {
      throw new Error('fakeObjectStore.put: the completeness verifier never PUTs');
    },
    async get() {
      throw new Error('fakeObjectStore.get: the completeness verifier never GETs');
    },
    async attachSha256Metadata() {
      throw new Error('fakeObjectStore.attachSha256Metadata: the completeness verifier never rewrites metadata');
    },
  };
}

/** A B2-direct master, as an adapter (museum / IA / papers-past) would record it. */
function master(overrides: Partial<AcquiredAsset> = {}): AcquiredAsset {
  return {
    sourceUrl: 'https://example.org/item',
    mediaType: 'image/jpeg',
    objectStoreKey: 'archive/cases/x/museum/y/Y-0001.jpg',
    checksum: CHECKSUM,
    byteLength: 12345,
    provenancePath: 'archive/cases/x/museum/y/Y-0001.provenance.json',
    role: 'primary',
    sequence: 1,
    ...overrides,
  };
}

/** A B2-direct record (recorded object-store masters). */
function b2Record(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'PB-P200',
    sourceArchive: 'New Italy Museum',
    status: 'archived',
    assets: [master()],
    ...overrides,
  };
}

/** A Gallica-shaped record: no object-store assets (masters are per-page provenance). */
function gallicaRecord(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'PB-P100',
    sourceArchive: 'Gallica / BnF',
    status: 'collected',
    assets: [],
    ...overrides,
  };
}

describe('verifyRecordComplete', () => {
  it('RESOLVES a B2-direct record whose masters all HEAD present with a matching checksum and status archived', async () => {
    const store = fakeObjectStore({ [master().objectStoreKey]: { sha256: CHECKSUM } });
    await expect(
      verifyRecordComplete(b2Record(), {
        objectStore: store,
        reconciled: { status: 'archived', advanced: true },
      }),
    ).resolves.toBeUndefined();
  });

  it('THROWS naming the key when a recorded B2 master is MISSING from the object store', async () => {
    const store = fakeObjectStore({}); // key absent -> head { exists: false }
    await expect(
      verifyRecordComplete(b2Record(), {
        objectStore: store,
        reconciled: { status: 'archived', advanced: true },
      }),
    ).rejects.toThrow(/archive\/cases\/x\/museum\/y\/Y-0001\.jpg/);
  });

  it('THROWS when a recorded B2 master HEADs present but its stored sha256 does not match the recorded checksum', async () => {
    const store = fakeObjectStore({ [master().objectStoreKey]: { sha256: 'd'.repeat(64) } });
    await expect(
      verifyRecordComplete(b2Record(), {
        objectStore: store,
        reconciled: { status: 'archived', advanced: true },
      }),
    ).rejects.toThrow(/sha256|checksum|mismatch/i);
  });

  it('THROWS when a B2-direct record has masters present but its reconciled status did NOT advance to archived', async () => {
    const store = fakeObjectStore({ [master().objectStoreKey]: { sha256: CHECKSUM } });
    await expect(
      verifyRecordComplete(b2Record({ status: 'to-collect' }), {
        objectStore: store,
        reconciled: { status: 'to-collect', advanced: false },
      }),
    ).rejects.toThrow(/status|archived|advanced/i);
  });

  it('RESOLVES a Gallica-shaped record (assets: []) reconciled to collected -- NOT failed for its empty asset list', async () => {
    const store = fakeObjectStore({});
    await expect(
      verifyRecordComplete(gallicaRecord(), {
        objectStore: store,
        reconciled: { status: 'collected', advanced: true },
      }),
    ).resolves.toBeUndefined();
  });

  it('THROWS when a Gallica-shaped record was left unadvanced (status to-collect)', async () => {
    const store = fakeObjectStore({});
    await expect(
      verifyRecordComplete(gallicaRecord({ status: 'to-collect' }), {
        objectStore: store,
        reconciled: { status: 'to-collect', advanced: false },
      }),
    ).rejects.toThrow(/status|advance|collected|archived/i);
  });

  it('THROWS when the adapter emitted a metadataSnapshot but the record has none', async () => {
    const store = fakeObjectStore({ [master().objectStoreKey]: { sha256: CHECKSUM } });
    await expect(
      verifyRecordComplete(b2Record({ metadataSnapshot: undefined }), {
        objectStore: store,
        reconciled: { status: 'archived', advanced: true },
        expectsMetadataSnapshot: true,
      }),
    ).rejects.toThrow(/metadataSnapshot|snapshot/i);
  });

  it('RESOLVES when the adapter emits NO metadataSnapshot even though the record has none (best-effort per-adapter)', async () => {
    const store = fakeObjectStore({ [master().objectStoreKey]: { sha256: CHECKSUM } });
    await expect(
      verifyRecordComplete(b2Record({ metadataSnapshot: undefined }), {
        objectStore: store,
        reconciled: { status: 'archived', advanced: true },
        expectsMetadataSnapshot: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('RESOLVES when the adapter emitted a metadataSnapshot and the record carries one', async () => {
    const store = fakeObjectStore({ [master().objectStoreKey]: { sha256: CHECKSUM } });
    await expect(
      verifyRecordComplete(
        b2Record({
          metadataSnapshot: {
            path: 'bibliography/snapshots/PB-P200.json',
            retrievedAt: '2026-07-14T00:00:00.000Z',
            endpoint: 'https://newitaly.org.au/CAT/000844.htm',
            normalizationVersion: 1,
          },
        }),
        {
          objectStore: store,
          reconciled: { status: 'archived', advanced: true },
          expectsMetadataSnapshot: true,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('AUDIT-04: THROWS when isB2Direct is explicitly true but the record recorded ZERO masters (not reinterpreted as Gallica)', async () => {
    const store = fakeObjectStore({});
    await expect(
      verifyRecordComplete(gallicaRecord({ status: 'collected' }), {
        objectStore: store,
        reconciled: { status: 'collected', advanced: true },
        isB2Direct: true,
      }),
    ).rejects.toThrow(/B2-direct|ZERO|master/i);
  });

  it('AUDIT-04: an explicit isB2Direct:false verifies a zero-asset record via the per-page-provenance rule (empty assets OK)', async () => {
    const store = fakeObjectStore({});
    await expect(
      verifyRecordComplete(gallicaRecord(), {
        objectStore: store,
        reconciled: { status: 'collected', advanced: true },
        isB2Direct: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('AUDIT-04: an explicit isB2Direct:true still verifies present masters against the store', async () => {
    const store = fakeObjectStore({ [master().objectStoreKey]: { sha256: CHECKSUM } });
    await expect(
      verifyRecordComplete(b2Record(), {
        objectStore: store,
        reconciled: { status: 'archived', advanced: true },
        isB2Direct: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('verifies EVERY recorded master, not just the first (a later missing master still THROWS)', async () => {
    const second = master({
      objectStoreKey: 'archive/cases/x/museum/y/Y-0002.jpg',
      checksum: 'e'.repeat(64),
      role: 'page-master',
      sequence: 2,
    });
    const store = fakeObjectStore({ [master().objectStoreKey]: { sha256: CHECKSUM } }); // second absent
    await expect(
      verifyRecordComplete(b2Record({ assets: [master(), second] }), {
        objectStore: store,
        reconciled: { status: 'archived', advanced: true },
      }),
    ).rejects.toThrow(/Y-0002\.jpg/);
  });
});
