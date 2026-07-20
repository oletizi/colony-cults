import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Rights } from '@/model/rights';
import type { RepositoryAdapter } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { ObjectStore, ObjectHead } from '@/archive/object-store';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import type { GatherProvenanceFn } from '@/sourcegroup/reconcile';
import { serializeSource } from '@/bibliography/migrate-serialize';
import { loadAllSources } from '@/bibliography/load';
import { runAcquire, type FetchSourceFn } from '@/sourcegroup/acquire';

/**
 * Tests for `runAcquire` (T029/T030, FR-014-017, D-08): acquire an approved
 * member's copy by REUSING the shipped `runFetchSource` fetcher -- resolving
 * the ARK from the selected RepositoryRecord and driving the fetcher with it.
 * NO new fetch code lives here; the fetcher itself is injected so these tests
 * never touch the network/B2 (US4 scenarios 1-5).
 */

const ARK = 'ark:/12148/bpt6k1234567';

function publicDomainRights(ark: string): Rights {
  return {
    ark,
    status: 'public-domain',
    rawResponse: '<record/>',
    dcRights: ['public domain'],
  };
}

function otherRights(ark: string): Rights {
  return {
    ark,
    status: 'other',
    rawResponse: '<record/>',
    dcRights: ['all rights reserved'],
  };
}

function member(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P100',
    titles: [{ text: 'Le Petit Journal', role: 'canonical' }],
    kind: 'monograph',
    partOf: 'PB-G001',
    status: 'approved-for-acquisition',
    creator: 'Anonyme',
    identifiers: [],
    ...overrides,
  };
}

function authoredRecord(
  overrides: Partial<AuthoredRepositoryRecord> = {},
): AuthoredRepositoryRecord {
  return {
    sourceArchive: 'Gallica / BnF',
    status: 'to-collect',
    identifiers: [{ type: 'ark', value: ARK }],
    rights: publicDomainRights(ARK),
    ...overrides,
  };
}

/** A New Italy Museum member (accession copy), approved-for-acquisition. */
function museumMember(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P200',
    titles: [{ text: 'Pioneers Group Photo', role: 'canonical' }],
    kind: 'monograph',
    partOf: 'PB-G001',
    status: 'approved-for-acquisition',
    identifiers: [],
    ...overrides,
  };
}

/** A museum RepositoryRecord: carries an `accession` copy identifier. */
function museumAuthoredRecord(
  overrides: Partial<AuthoredRepositoryRecord> = {},
): AuthoredRepositoryRecord {
  return {
    sourceArchive: 'New Italy Museum',
    status: 'to-collect',
    sourceUrl: 'https://newitaly.org.au/CAT/000844.htm',
    identifiers: [{ type: 'accession', value: 'NIMI-0844' }],
    rightsAssessment: {
      rightsStatus: 'public-domain',
      rightsBasis: 'Photograph created 1890; Australian pre-1955 term expired.',
      assessedBy: 'operator',
      assessedAt: '2026-07-14T00:00:00.000Z',
    },
    ...overrides,
  };
}

/**
 * A spy {@link RepositoryAdapter} for the museum path: records every `acquire`
 * call so a dispatch test can assert an accession record routed HERE (and the
 * Gallica fetcher was never touched). `resolve`/`collectRightsEvidence` throw
 * -- the acquire dispatch path never calls them.
 */
function spyMuseumAdapter(): { adapter: RepositoryAdapter; calls: RepositoryRecord[] } {
  const calls: RepositoryRecord[] = [];
  const adapter: RepositoryAdapter = {
    repository: 'new-italy-museum',
    async resolve() {
      throw new Error('spyMuseumAdapter.resolve: not used on the acquire dispatch path');
    },
    async collectRightsEvidence() {
      throw new Error('spyMuseumAdapter.collectRightsEvidence: not used on the acquire dispatch path');
    },
    async acquire(record) {
      calls.push(record);
      return {
        repositoryRecordId: `${record.sourceId} @ ${record.sourceArchive}`,
        assets: [],
        metadataSnapshot: { raw: '', retrievedAt: '2026-07-14T00:00:00.000Z' },
        complete: true,
        reconciliationRequired: true,
      };
    },
  };
  return { adapter, calls };
}

/** An Internet Archive member (`ia-item` copy), approved-for-acquisition. */
function internetArchiveMember(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P300',
    titles: [{ text: 'De Groote 1880', role: 'canonical' }],
    kind: 'monograph',
    partOf: 'PB-G001',
    status: 'approved-for-acquisition',
    identifiers: [],
    ...overrides,
  };
}

/** An Internet Archive RepositoryRecord: carries an `ia-item` copy identifier. */
function internetArchiveAuthoredRecord(
  overrides: Partial<AuthoredRepositoryRecord> = {},
): AuthoredRepositoryRecord {
  return {
    sourceArchive: 'Internet Archive',
    status: 'to-collect',
    identifiers: [{ type: 'ia-item', value: 'nouvellefrancec00groogoog' }],
    ...overrides,
  };
}

/**
 * A spy {@link RepositoryAdapter} for the Internet Archive path (T026):
 * records every `acquire` call so a dispatch test can assert an `ia-item`
 * record routed HERE (and neither the Gallica fetcher nor the museum adapter
 * was ever touched). `resolve`/`collectRightsEvidence` throw -- the acquire
 * dispatch path never calls them.
 */
function spyInternetArchiveAdapter(): { adapter: RepositoryAdapter; calls: RepositoryRecord[] } {
  const calls: RepositoryRecord[] = [];
  const adapter: RepositoryAdapter = {
    repository: 'internet-archive',
    async resolve() {
      throw new Error('spyInternetArchiveAdapter.resolve: not used on the acquire dispatch path');
    },
    async collectRightsEvidence() {
      throw new Error(
        'spyInternetArchiveAdapter.collectRightsEvidence: not used on the acquire dispatch path',
      );
    },
    async acquire(record) {
      calls.push(record);
      return {
        repositoryRecordId: `${record.sourceId} @ ${record.sourceArchive}`,
        assets: [],
        metadataSnapshot: { raw: '', retrievedAt: '2026-07-16T00:00:00.000Z' },
        complete: true,
        reconciliationRequired: true,
      };
    },
  };
  return { adapter, calls };
}

/** A Papers Past member (`papers-past` copy), approved-for-acquisition. */
function papersPastMember(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P400',
    titles: [{ text: 'Otago Daily Times, 1880-01-01', role: 'canonical' }],
    kind: 'archival-item',
    partOf: 'PB-G001',
    status: 'approved-for-acquisition',
    identifiers: [],
    ...overrides,
  };
}

/** A Papers Past RepositoryRecord: carries a `papers-past` copy identifier. */
function papersPastAuthoredRecord(
  overrides: Partial<AuthoredRepositoryRecord> = {},
): AuthoredRepositoryRecord {
  return {
    sourceArchive: 'Papers Past',
    status: 'to-collect',
    identifiers: [{ type: 'papers-past', value: 'ODT18800101.2.10' }],
    ...overrides,
  };
}

/**
 * A spy {@link RepositoryAdapter} for the Papers Past path (T013/T014):
 * records every `acquire` call so a dispatch test can assert a `papers-past`
 * record routed HERE (and neither the Gallica fetcher nor the museum/IA
 * adapters were ever touched). `resolve`/`collectRightsEvidence` throw -- the
 * acquire dispatch path never calls them.
 */
function spyPapersPastAdapter(): { adapter: RepositoryAdapter; calls: RepositoryRecord[] } {
  const calls: RepositoryRecord[] = [];
  const adapter: RepositoryAdapter = {
    repository: 'papers-past',
    async resolve() {
      throw new Error('spyPapersPastAdapter.resolve: not used on the acquire dispatch path');
    },
    async collectRightsEvidence() {
      throw new Error(
        'spyPapersPastAdapter.collectRightsEvidence: not used on the acquire dispatch path',
      );
    },
    async acquire(record) {
      calls.push(record);
      return {
        repositoryRecordId: `${record.sourceId} @ ${record.sourceArchive}`,
        assets: [],
        metadataSnapshot: { raw: '', retrievedAt: '2026-07-18T00:00:00.000Z' },
        complete: true,
        reconciliationRequired: true,
      };
    },
  };
  return { adapter, calls };
}

/** A sample master mirrored to B2, as the museum adapter would return it. */
function sampleAsset(overrides: Partial<AcquiredAsset> = {}): AcquiredAsset {
  return {
    sourceUrl: 'https://newitaly.org.au/CAT/000844.htm',
    mediaType: 'image/jpeg',
    objectStoreKey: 'archive/cases/new-italy/museum/nimi-0844/NIMI-0844.jpg',
    checksum: 'c'.repeat(64),
    byteLength: 987654,
    provenancePath: 'archive/cases/new-italy/museum/nimi-0844/NIMI-0844.provenance.json',
    role: 'front',
    sequence: 1,
    representationChoice: 'max-resolution',
    ...overrides,
  };
}

/**
 * A museum {@link RepositoryAdapter} whose `acquire` mirrors a master and
 * returns it as a non-empty `assets` array (unlike {@link spyMuseumAdapter},
 * whose `acquire` returns none) -- so a test can assert `runAcquire` persists
 * the acquired asset back onto the SSOT record (TASK-30).
 */
function acquiringMuseumAdapter(assets: AcquiredAsset[]): RepositoryAdapter {
  return {
    repository: 'new-italy-museum',
    async resolve() {
      throw new Error('acquiringMuseumAdapter.resolve: not used on the acquire dispatch path');
    },
    async collectRightsEvidence() {
      throw new Error('acquiringMuseumAdapter.collectRightsEvidence: not used on the acquire dispatch path');
    },
    async acquire(record) {
      return {
        repositoryRecordId: `${record.sourceId} @ ${record.sourceArchive}`,
        assets,
        metadataSnapshot: { raw: '', retrievedAt: '2026-07-14T00:00:00.000Z' },
        complete: true,
        reconciliationRequired: true,
      };
    },
  };
}

/**
 * A head-capable fake {@link ObjectStore} for the completion tail (spec 016):
 * `head` answers from an in-memory map keyed by object-store key. A `put`
 * counter lets a test assert idempotency (0 duplicate writes on a re-run);
 * `put`/`get`/`attachSha256Metadata` otherwise throw -- the acquire completion
 * tail only HEADs.
 */
function fakeObjectStore(
  entries: Record<string, { sha256?: string }>,
): ObjectStore & { putCount: number } {
  const store = {
    putCount: 0,
    async head(key: string): Promise<ObjectHead> {
      const entry = entries[key];
      if (entry === undefined) {
        return { exists: false };
      }
      return entry.sha256 === undefined ? { exists: true } : { exists: true, sha256: entry.sha256 };
    },
    async put() {
      store.putCount += 1;
      throw new Error('fakeObjectStore.put: the acquire completion tail never PUTs (heads-only)');
    },
    async get(): Promise<Uint8Array> {
      throw new Error('fakeObjectStore.get: the acquire completion tail never GETs');
    },
    async attachSha256Metadata() {
      throw new Error('fakeObjectStore.attachSha256Metadata: the acquire completion tail never rewrites metadata');
    },
  };
  return store;
}

/** One archive-provenance page-image entry (Gallica per-page master). */
function pageImage(sourceArchive: string, seq: number, backed: boolean): AssetProvenance {
  const key = `archive/x/gallica/y/f${String(seq).padStart(3, '0')}.jpg`;
  return {
    source_archive: sourceArchive,
    local_path: key,
    type: 'page-image',
    sha256: `${seq}`.repeat(64).slice(0, 64),
    object_store: backed
      ? { provider: 'backblaze-b2', bucket: 'colony-cults', key, endpoint: 'https://s3' }
      : null,
    format: 'image/jpeg',
    original_url: 'https://gallica.bnf.fr/ark:/x',
  };
}

/**
 * Completion-tail machinery for a Gallica (per-page-provenance) acquire: a fake
 * `gather` returning object-store-backed page-image provenance for the given
 * archive(s) (so the reconcile advances to an acquired status) plus a stand-in
 * `reconcileArchiveRoot`. A non-dry-run Gallica acquire now FAILS LOUD without
 * these (spec 016, AUDIT-20260719-01), so a dispatch test that drives a real
 * Gallica acquire must inject them -- just as it injects `fetch`.
 */
function gallicaCompletionDeps(
  archives: string[] = ['Gallica / BnF', 'State Library of Queensland'],
): { reconcileArchiveRoot: string; gather: GatherProvenanceFn } {
  const gather: GatherProvenanceFn = async () =>
    archives.flatMap((archive) => [pageImage(archive, 1, true), pageImage(archive, 2, true)]);
  return { reconcileArchiveRoot: '/archive/root', gather };
}

/**
 * A museum {@link RepositoryAdapter} that MODELS the shipped adapter's
 * content-addressed idempotency (INV-E): on `acquire`, if the record already
 * records the master AND it heads present with a matching checksum in the
 * adapter's own object store, it returns the recorded asset WITHOUT re-mirroring
 * (no fetch, no PUT). Otherwise it "mirrors" (increments `mirrorCount`). Used to
 * assert that an orphan-healing RE-RUN does not re-mirror already-held bytes --
 * instrumenting the ADAPTER-side write path, not the completion store's
 * heads-only tail (AUDIT-20260720-06).
 */
function idempotentMuseumAdapter(
  asset: AcquiredAsset,
  store: ObjectStore,
): { adapter: RepositoryAdapter; mirrorCount: () => number } {
  let mirrors = 0;
  const adapter: RepositoryAdapter = {
    repository: 'new-italy-museum',
    async resolve() {
      throw new Error('idempotentMuseumAdapter.resolve: not used on the acquire dispatch path');
    },
    async collectRightsEvidence() {
      throw new Error('idempotentMuseumAdapter.collectRightsEvidence: not used on the acquire dispatch path');
    },
    async acquire(record) {
      const recorded = (record.assets ?? []).find((a) => a.objectStoreKey === asset.objectStoreKey);
      if (recorded !== undefined) {
        const head = await store.head(asset.objectStoreKey);
        if (head.exists && head.sha256 === asset.checksum) {
          // Already held -- return it without re-fetching or re-PUTting (INV-E).
          return {
            repositoryRecordId: `${record.sourceId} @ ${record.sourceArchive}`,
            assets: [asset],
            metadataSnapshot: { raw: '', retrievedAt: '2026-07-14T00:00:00.000Z' },
            complete: true,
            reconciliationRequired: true,
          };
        }
      }
      mirrors += 1; // a real fetch + PUT would happen here
      return {
        repositoryRecordId: `${record.sourceId} @ ${record.sourceArchive}`,
        assets: [asset],
        metadataSnapshot: { raw: '', retrievedAt: '2026-07-14T00:00:00.000Z' },
        complete: true,
        reconciliationRequired: true,
      };
    },
  };
  return { adapter, mirrorCount: () => mirrors };
}

async function seedSourcesDir(
  entries: { source: Source; records: AuthoredRepositoryRecord[] }[],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'acquire-'));
  for (const entry of entries) {
    await writeFile(
      join(dir, `${entry.source.sourceId}.yml`),
      serializeSource(entry),
      'utf-8',
    );
  }
  return dir;
}

describe('runAcquire', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves the ARK from the selected record and calls the injected fetcher with --source-id/--object-store', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      objectStore: true,
      fetch,
      ...gallicaCompletionDeps(),
    });

    expect(result.ark).toBe(ARK);
    expect(result.sourceArchive).toBe('Gallica / BnF');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.command).toBe('fetch-source');
    expect(args.positional).toEqual([ARK]);
    expect(args.options.sourceId).toBe('PB-P100');
    expect(args.flags.objectStore).toBe(true);
    expect(args.flags.dryRun).toBe(false);
  });

  it('passes --dry-run through to the fetcher without defaulting it true', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      dryRun: true,
      fetch,
    });

    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.flags.dryRun).toBe(true);
  });

  it('forwards --checkpoint/--checkpoint-every to the fetcher when provided', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      checkpoint: true,
      checkpointEvery: 25,
      fetch,
      ...gallicaCompletionDeps(),
    });

    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.flags.checkpoint).toBe(true);
    expect(args.options.checkpointEvery).toBe(25);
  });

  it('defaults checkpoint to false and checkpointEvery to undefined when omitted', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch, ...gallicaCompletionDeps() });

    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.flags.checkpoint).toBe(false);
    expect(args.options.checkpointEvery).toBeUndefined();
  });

  it('infers the sole RepositoryRecord when no --archive is given', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    const result = await runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch, ...gallicaCompletionDeps() });

    expect(result.sourceArchive).toBe('Gallica / BnF');
  });

  it('selects the record matching --archive when more than one exists', async () => {
    const otherArk = 'ark:/12148/other999';
    dir = await seedSourcesDir([
      {
        source: member(),
        records: [
          authoredRecord(),
          authoredRecord({
            sourceArchive: 'State Library of Queensland',
            identifiers: [{ type: 'ark', value: otherArk }],
            rights: publicDomainRights(otherArk),
          }),
        ],
      },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      archive: 'State Library of Queensland',
      fetch,
      ...gallicaCompletionDeps(),
    });

    expect(result.ark).toBe(otherArk);
    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.positional).toEqual([otherArk]);
  });

  it('fails loud when the member has more than one RepositoryRecord and no --archive is given (no fetch)', async () => {
    dir = await seedSourcesDir([
      {
        source: member(),
        records: [
          authoredRecord(),
          authoredRecord({ sourceArchive: 'State Library of Queensland' }),
        ],
      },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow(/ambiguous|--archive/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud when the member is not approved-for-acquisition (no fetch)', async () => {
    dir = await seedSourcesDir([
      { source: member({ status: 'discovered' }), records: [authoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow(/approved-for-acquisition/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud when the member has no status at all (no fetch)', async () => {
    dir = await seedSourcesDir([
      { source: member({ status: undefined }), records: [authoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow(/approved-for-acquisition/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud when the selected record is not public-domain (no fetch)', async () => {
    dir = await seedSourcesDir([
      {
        source: member(),
        records: [authoredRecord({ rights: otherRights(ARK) })],
      },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch, ...gallicaCompletionDeps() }),
    ).rejects.toThrow(/public-domain/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud when the selected record has no rights determination at all (no fetch)', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ rights: undefined })] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch, ...gallicaCompletionDeps() }),
    ).rejects.toThrow(/public-domain/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud when the selected RepositoryRecord carries no ark identifier (no fetch)', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ identifiers: [] })] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow(/ark/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud when the member does not exist (no fetch)', async () => {
    dir = await seedSourcesDir([]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P999', fetch }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud when the member has zero RepositoryRecords (no fetch)', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud on malformed input (missing sourceId) without calling the fetcher', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const bad = { sourcesDir: dir, sourceId: 'PB-P100', fetch };
    Reflect.deleteProperty(bad, 'sourceId');

    await expect(runAcquire(bad)).rejects.toThrow(/sourceId/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud on malformed input (missing fetch) without ever throwing from within the fetcher call', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const bad = { sourcesDir: dir, sourceId: 'PB-P100', fetch };
    Reflect.deleteProperty(bad, 'fetch');

    await expect(runAcquire(bad)).rejects.toThrow(/fetch/i);
  });

  it('T019: dispatches an accession record to the injected museum adapter (Gallica fetcher untouched)', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const { adapter, calls } = spyMuseumAdapter();

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P200',
      fetch,
      museumAdapter: adapter,
      completionObjectStore: fakeObjectStore({}),
    });

    // Routed to the museum adapter, never the Gallica fetcher.
    expect(calls).toHaveLength(1);
    expect(calls[0].sourceArchive).toBe('New Italy Museum');
    expect(fetch).not.toHaveBeenCalled();
    // Observable result carries the accession (not an ark) for a museum copy.
    expect(result).toEqual({
      sourceId: 'PB-P200',
      accession: 'NIMI-0844',
      sourceArchive: 'New Italy Museum',
    });
  });

  it('TASK-30: persists the museum acquire\'s AcquiredAsset onto the SSOT record and round-trips it through load', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const asset = sampleAsset();
    const adapter = acquiringMuseumAdapter([asset]);
    // The completion tail (spec 016) HEADs the recorded master, so give it a
    // store where the master is present + matching -- this test still asserts
    // the round-trip persistence (the tail's status advancement is asserted by
    // the US1 test below).
    const objectStore = fakeObjectStore({ [asset.objectStoreKey]: { sha256: asset.checksum } });

    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P200',
      fetch,
      museumAdapter: adapter,
      completionObjectStore: objectStore,
    });

    // Re-load the SSOT: the acquired master is now recorded on the copy, and
    // survives serialize -> load unchanged (round-trip wiring).
    const loaded = loadAllSources(dir);
    const entry = loaded.find((l) => l.source.sourceId === 'PB-P200');
    if (entry === undefined) {
      throw new Error('test: PB-P200 not found after acquire');
    }
    const record = entry.records.find((r) => r.sourceArchive === 'New Italy Museum');
    if (record === undefined) {
      throw new Error('test: PB-P200 has no New Italy Museum record after acquire');
    }
    expect(record.assets).toEqual([asset]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('TASK-30: a Gallica acquire (adapter returns no assets) records NO assets on the SSOT record', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch, ...gallicaCompletionDeps() });

    const loaded = loadAllSources(dir);
    const entry = loaded.find((l) => l.source.sourceId === 'PB-P100');
    const record = entry?.records.find((r) => r.sourceArchive === 'Gallica / BnF');
    expect(record?.assets).toBeUndefined();
  });

  it('T019: dispatches an ark record to Gallica even when a museum adapter is also registered', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const { adapter, calls } = spyMuseumAdapter();

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      fetch,
      museumAdapter: adapter,
      ...gallicaCompletionDeps(),
    });

    // Behavior unchanged: ark -> Gallica fetcher; the museum adapter is untouched.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect(result.ark).toBe(ARK);
    expect(result.sourceArchive).toBe('Gallica / BnF');
  });

  it('T026: dispatches an ia-item record to the injected Internet Archive adapter (Gallica fetcher + museum adapter untouched)', async () => {
    dir = await seedSourcesDir([
      { source: internetArchiveMember(), records: [internetArchiveAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const { adapter: iaAdapter, calls: iaCalls } = spyInternetArchiveAdapter();
    const { adapter: museumAdapter, calls: museumCalls } = spyMuseumAdapter();

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P300',
      fetch,
      museumAdapter,
      internetArchiveAdapter: iaAdapter,
      completionObjectStore: fakeObjectStore({}),
    });

    // Routed to the IA adapter only.
    expect(iaCalls).toHaveLength(1);
    expect(iaCalls[0].sourceArchive).toBe('Internet Archive');
    expect(museumCalls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    // Observable result carries the ia-item id (not an ark/accession).
    expect(result).toEqual({
      sourceId: 'PB-P300',
      iaItem: 'nouvellefrancec00groogoog',
      sourceArchive: 'Internet Archive',
    });
  });

  it('T026: an ark record still dispatches to Gallica when an IA adapter is also registered', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const { adapter: iaAdapter, calls: iaCalls } = spyInternetArchiveAdapter();

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      fetch,
      internetArchiveAdapter: iaAdapter,
      ...gallicaCompletionDeps(),
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(iaCalls).toHaveLength(0);
    expect(result.ark).toBe(ARK);
    expect(result.sourceArchive).toBe('Gallica / BnF');
  });

  it('T026: an accession record still dispatches to the museum adapter when an IA adapter is also registered', async () => {
    dir = await seedSourcesDir([
      { source: museumMember(), records: [museumAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const { adapter: museumAdapter, calls: museumCalls } = spyMuseumAdapter();
    const { adapter: iaAdapter, calls: iaCalls } = spyInternetArchiveAdapter();

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P200',
      fetch,
      museumAdapter,
      internetArchiveAdapter: iaAdapter,
      completionObjectStore: fakeObjectStore({}),
    });

    expect(museumCalls).toHaveLength(1);
    expect(iaCalls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.accession).toBe('NIMI-0844');
  });

  it('T014: dispatches a papers-past record to the injected Papers Past adapter (Gallica fetcher + museum/IA adapters untouched)', async () => {
    dir = await seedSourcesDir([
      { source: papersPastMember(), records: [papersPastAuthoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);
    const { adapter: papersPastAdapter, calls: papersPastCalls } = spyPapersPastAdapter();
    const { adapter: museumAdapter, calls: museumCalls } = spyMuseumAdapter();
    const { adapter: iaAdapter, calls: iaCalls } = spyInternetArchiveAdapter();

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P400',
      fetch,
      museumAdapter,
      internetArchiveAdapter: iaAdapter,
      papersPastAdapter,
      completionObjectStore: fakeObjectStore({}),
    });

    // Routed to the Papers Past adapter only.
    expect(papersPastCalls).toHaveLength(1);
    expect(papersPastCalls[0].sourceArchive).toBe('Papers Past');
    expect(museumCalls).toHaveLength(0);
    expect(iaCalls).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    // Observable result carries the papers-past article code (not an ark/accession/iaItem).
    expect(result).toEqual({
      sourceId: 'PB-P400',
      papersPast: 'ODT18800101.2.10',
      sourceArchive: 'Papers Past',
    });
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
  });

  it('scenario 4: the source-group itself (e.g. PB-P004) is refused before any fetch is attempted, relying on the approved-status precondition -- no guardrail is reimplemented here', async () => {
    const group: Source = {
      sourceId: 'PB-P004',
      titles: [{ text: 'A source group', role: 'canonical' }],
      kind: 'source-group',
      identifiers: [],
    };
    dir = await seedSourcesDir([{ source: group, records: [] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P004', fetch }),
    ).rejects.toThrow(/approved-for-acquisition/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
