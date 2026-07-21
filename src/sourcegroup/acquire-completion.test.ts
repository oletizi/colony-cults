import { describe, it, expect, afterEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { RepositoryAdapter } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { ObjectStore, ObjectHead } from '@/archive/object-store';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import type { GatherProvenanceFn } from '@/sourcegroup/reconcile';
import { loadAllSources } from '@/bibliography/load';
import { runAcquire, type FetchSourceFn } from '@/sourcegroup/acquire';
import {
  ARK,
  publicDomainRights,
  otherRights,
  member,
  authoredRecord,
  museumMember,
  museumAuthoredRecord,
  spyMuseumAdapter,
  internetArchiveMember,
  internetArchiveAuthoredRecord,
  spyInternetArchiveAdapter,
  papersPastMember,
  papersPastAuthoredRecord,
  spyPapersPastAdapter,
  sampleAsset,
  acquiringMuseumAdapter,
  fakeObjectStore,
  pageImage,
  gallicaCompletionDeps,
  idempotentMuseumAdapter,
  seedSourcesDir,
} from './acquire-fixtures';

describe('runAcquire — spec 016 completion (Principle XV)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // --- Spec 016: acquire completes the SSOT record (Principle XV) ---

  it('T005/US1: a B2-direct acquire advances the record status to archived INLINE (no separate reconcile)', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const asset = sampleAsset();
    const adapter = acquiringMuseumAdapter([asset]);
    const objectStore = fakeObjectStore({ [asset.objectStoreKey]: { sha256: asset.checksum } });

    // Only runAcquire is invoked -- NO separate runReconcile call.
    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P200',
      fetch,
      museumAdapter: adapter,
      completionObjectStore: objectStore,
    });

    const loaded = loadAllSources(dir);
    const record = loaded
      .find((l) => l.source.sourceId === 'PB-P200')
      ?.records.find((r) => r.sourceArchive === 'New Italy Museum');
    // Status advanced from `to-collect` to `archived` as part of the SAME acquire.
    expect(record?.status).toBe('archived');
    expect(record?.status).not.toBe('to-collect');
    expect(record?.assets).toEqual([asset]);
  });

  it('T007/US2: a B2-direct acquire whose recorded master is MISSING from the store fails loud and does NOT report success', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const asset = sampleAsset();
    const adapter = acquiringMuseumAdapter([asset]);
    const objectStore = fakeObjectStore({}); // master key absent -> head { exists: false }

    await expect(
      runAcquire({
        sourcesDir: dir,
        sourceId: 'PB-P200',
        fetch,
        museumAdapter: adapter,
        completionObjectStore: objectStore,
      }),
    ).rejects.toThrow(/status|archived|missing|advance/i);

    // The failure must NOT leave a falsely-advanced status on disk
    // (AUDIT-20260720-10): the record stays `to-collect`, never `archived`.
    const record = loadAllSources(dir)
      .find((l) => l.source.sourceId === 'PB-P200')
      ?.records.find((r) => r.sourceArchive === 'New Italy Museum');
    expect(record?.status).toBe('to-collect');
  });

  it('T007/US2: a B2-direct acquire whose stored checksum MISMATCHES the recorded master fails loud', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const asset = sampleAsset();
    const adapter = acquiringMuseumAdapter([asset]);
    const objectStore = fakeObjectStore({ [asset.objectStoreKey]: { sha256: 'd'.repeat(64) } });

    await expect(
      runAcquire({
        sourcesDir: dir,
        sourceId: 'PB-P200',
        fetch,
        museumAdapter: adapter,
        completionObjectStore: objectStore,
      }),
    ).rejects.toThrow(/mismatch|checksum|sha256/i);

    // A mismatched master must never advance the status (AUDIT-20260720-10).
    const record = loadAllSources(dir)
      .find((l) => l.source.sourceId === 'PB-P200')
      ?.records.find((r) => r.sourceArchive === 'New Italy Museum');
    expect(record?.status).toBe('to-collect');
  });

  it('T007/US2: re-running acquire over an assets-recorded-but-unadvanced record heals it with 0 duplicate object-store writes', async () => {
    // Seed a record that already carries the mirrored asset but is still
    // `to-collect` (an orphan from a prior acquire that mirrored bytes but did
    // not complete) -- the exact PB-P061 regression.
    const asset = sampleAsset();
    dir = await seedSourcesDir([
      {
        source: museumMember(),
        records: [museumAuthoredRecord({ status: 'to-collect', assets: [asset] })],
      },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    // The master is already held in the object store (a prior acquire mirrored
    // it); the adapter models INV-E, so a re-run must NOT re-mirror it.
    const objectStore = fakeObjectStore({ [asset.objectStoreKey]: { sha256: asset.checksum } });
    const { adapter, mirrorCount } = idempotentMuseumAdapter(asset, objectStore);

    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P200',
      fetch,
      museumAdapter: adapter,
      completionObjectStore: objectStore,
    });

    const loaded = loadAllSources(dir);
    const record = loaded
      .find((l) => l.source.sourceId === 'PB-P200')
      ?.records.find((r) => r.sourceArchive === 'New Italy Museum');
    expect(record?.status).toBe('archived');
    // The ADAPTER short-circuited (already-held master) -- no re-fetch/re-upload
    // (AUDIT-20260720-06: assert the adapter-side write path, not the heads-only
    // completion store).
    expect(mirrorCount()).toBe(0);
    // And the completion tail itself is heads-only (no PUTs).
    expect(objectStore.putCount).toBe(0);
  });

  it('T006/US2: --dry-run skips the completion tail + verification (no status change, no writes, reports success)', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    // A dry-run adapter mirrors nothing (returns empty assets), mirroring the
    // real adapters' `ctx.dryRun` behavior.
    const adapter = acquiringMuseumAdapter([]);
    // A store whose head would THROW if ever consulted -- proving the tail is
    // skipped on dry-run.
    const objectStore: ObjectStore = {
      async head() {
        throw new Error('dry-run must not HEAD the object store');
      },
      async put() {
        throw new Error('unused');
      },
      async get(): Promise<Uint8Array> {
        throw new Error('unused');
      },
      async attachSha256Metadata() {
        throw new Error('unused');
      },
    };

    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P200',
      dryRun: true,
      fetch,
      museumAdapter: adapter,
      completionObjectStore: objectStore,
    });

    const loaded = loadAllSources(dir);
    const record = loaded
      .find((l) => l.source.sourceId === 'PB-P200')
      ?.records.find((r) => r.sourceArchive === 'New Italy Museum');
    // Untouched: dry-run mirrored nothing, so there is nothing to complete.
    expect(record?.status).toBe('to-collect');
  });

  it('T008/US3: a Gallica-shaped acquire (assets: []) completes via the archive-provenance path to status collected -- not failed for empty assets', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    // A fake provenance gatherer standing in for the archive per-page masters
    // the fetcher wrote: two page images, one object-store-backed and one not,
    // so reconcile yields `collected` (the Gallica-complete status, not archived).
    const gather: GatherProvenanceFn = async () => [
      pageImage('Gallica / BnF', 1, false),
      pageImage('Gallica / BnF', 2, true),
    ];

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      fetch,
      reconcileArchiveRoot: '/archive/root',
      gather,
    });

    expect(result.ark).toBe(ARK);
    const loaded = loadAllSources(dir);
    const record = loaded
      .find((l) => l.source.sourceId === 'PB-P100')
      ?.records.find((r) => r.sourceArchive === 'Gallica / BnF');
    // Advanced to `collected` (per-page provenance path), NOT failed for empty assets.
    expect(record?.status).toBe('collected');
  });

  it('AUDIT-01: a B2-direct acquire that mirrored masters but was given NO completionObjectStore fails loud (never silently skips completion)', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const asset = sampleAsset();
    const adapter = acquiringMuseumAdapter([asset]);

    // No completionObjectStore injected: the acquire mirrored a master, so the
    // completion is REQUIRED and cannot be skipped -- it must fail loud.
    await expect(
      runAcquire({
        sourcesDir: dir,
        sourceId: 'PB-P200',
        fetch,
        museumAdapter: adapter,
      }),
    ).rejects.toThrow(/completionObjectStore|complete \+ verify|Principle XV/i);
  });

  it('AUDIT-01: a non-dry-run Gallica acquire given NO reconcileArchiveRoot/gather fails loud (never silently skips status advancement)', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    // No completion machinery injected for a Gallica acquire: refuse to report
    // success for a fetched copy whose status was never advanced.
    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow(/reconcileArchiveRoot|gather|Principle XV/i);
  });

  it('AUDIT-03/AUDIT-20260720-01: a B2-direct acquire with a metadataSnapshotRef but ZERO masters RECORDS the snapshot (never orphaned) and succeeds', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const snapshotRef = {
      path: 'bibliography/snapshots/PB-P200.json',
      retrievedAt: '2026-07-14T00:00:00.000Z',
      endpoint: 'https://newitaly.org.au/CAT/000844.htm',
      normalizationVersion: 1,
    };
    // A B2-direct adapter that recorded a durable snapshot but mirrored no
    // page-image masters (assets: []). Not produced by any shipped adapter --
    // the persist decoupling records the snapshot so it can never be orphaned.
    const adapter: RepositoryAdapter = {
      repository: 'new-italy-museum',
      async resolve() {
        throw new Error('unused on the acquire dispatch path');
      },
      async collectRightsEvidence() {
        throw new Error('unused on the acquire dispatch path');
      },
      async acquire(record) {
        return {
          repositoryRecordId: `${record.sourceId} @ ${record.sourceArchive}`,
          assets: [],
          metadataSnapshot: { raw: '', retrievedAt: '2026-07-14T00:00:00.000Z' },
          metadataSnapshotRef: snapshotRef,
          complete: true,
          reconciliationRequired: true,
        };
      },
    };
    const objectStore = fakeObjectStore({});

    // Succeeds -- and the durable snapshot IS recorded on the SSOT (no orphan),
    // not left unrecorded behind a fail-loud that fires after the adapter already
    // wrote it (AUDIT-20260720-01).
    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P200',
      fetch,
      museumAdapter: adapter,
      completionObjectStore: objectStore,
    });

    const loaded = loadAllSources(dir);
    const record = loaded
      .find((l) => l.source.sourceId === 'PB-P200')
      ?.records.find((r) => r.sourceArchive === 'New Italy Museum');
    expect(record?.metadataSnapshot).toEqual(snapshotRef);
    expect(record?.assets).toBeUndefined();
  });

  it('AUDIT-02/AUDIT-05: a zero-asset B2-direct acquire the adapter AFFIRMS complete (museum HTML-only) succeeds, is NOT misrouted to Gallica, and leaves status untouched', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    // The DOCUMENTED museum HTML-only outcome: `masterImageUrl === null` ->
    // `assets: [], complete: true` (src/repository/new-italy-museum/adapter.ts).
    // This is a legitimate catalog-only acquire (mirror nothing), NOT an
    // incomplete acquire -- succeeding is correct because `complete: true` is
    // affirmed and there are no object-store bytes to orphan (AUDIT-20260720-05).
    // `acquiringMuseumAdapter` returns `complete: true`.
    const adapter = acquiringMuseumAdapter([]);
    // A store whose head THROWS if consulted -- proving we neither run the B2
    // completion (nothing mirrored) nor misroute to the Gallica provenance path
    // (which would throw "archiveRoot required").
    const objectStore: ObjectStore = {
      async head() {
        throw new Error('zero-asset B2-direct must not HEAD the store');
      },
      async put() {
        throw new Error('unused');
      },
      async get(): Promise<Uint8Array> {
        throw new Error('unused');
      },
      async attachSha256Metadata() {
        throw new Error('unused');
      },
    };

    // Must NOT throw a misleading Gallica-provenance error (AUDIT-20260719-02).
    await expect(
      runAcquire({
        sourcesDir: dir,
        sourceId: 'PB-P200',
        fetch,
        museumAdapter: adapter,
        completionObjectStore: objectStore,
      }),
    ).resolves.toMatchObject({ sourceId: 'PB-P200', accession: 'NIMI-0844' });

    // No master mirrored ⇒ nothing to complete ⇒ status stays as authored.
    const loaded = loadAllSources(dir);
    const record = loaded
      .find((l) => l.source.sourceId === 'PB-P200')
      ?.records.find((r) => r.sourceArchive === 'New Italy Museum');
    expect(record?.status).toBe('to-collect');
  });

  it('AUDIT-05: a zero-master B2-direct acquire the adapter did NOT affirm complete (complete: false) fails loud -- not blessed as success', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    // A B2-direct adapter that mirrored no master AND did not report the item
    // complete -- an incomplete acquire, not a deliberate catalog-only outcome.
    const adapter: RepositoryAdapter = {
      repository: 'new-italy-museum',
      async resolve() {
        throw new Error('unused');
      },
      async collectRightsEvidence() {
        throw new Error('unused');
      },
      async acquire(record) {
        return {
          repositoryRecordId: `${record.sourceId} @ ${record.sourceArchive}`,
          assets: [],
          metadataSnapshot: { raw: '', retrievedAt: '2026-07-14T00:00:00.000Z' },
          complete: false,
          reconciliationRequired: true,
        };
      },
    };

    await expect(
      runAcquire({
        sourcesDir: dir,
        sourceId: 'PB-P200',
        fetch,
        museumAdapter: adapter,
        completionObjectStore: fakeObjectStore({}),
      }),
    ).rejects.toThrow(/ZERO object-store masters|not report the item complete|Principle XV/i);

    // The failure leaves the record unadvanced (AUDIT-20260720-10).
    const record = loadAllSources(dir)
      .find((l) => l.source.sourceId === 'PB-P200')
      ?.records.find((r) => r.sourceArchive === 'New Italy Museum');
    expect(record?.status).toBe('to-collect');
  });
});
