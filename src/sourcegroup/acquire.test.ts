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
    });

    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.flags.checkpoint).toBe(true);
    expect(args.options.checkpointEvery).toBe(25);
  });

  it('defaults checkpoint to false and checkpointEvery to undefined when omitted', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch });

    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.flags.checkpoint).toBe(false);
    expect(args.options.checkpointEvery).toBeUndefined();
  });

  it('infers the sole RepositoryRecord when no --archive is given', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    const result = await runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch });

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
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow(/public-domain/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails loud when the selected record has no rights determination at all (no fetch)', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ rights: undefined })] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
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

    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P200',
      fetch,
      museumAdapter: adapter,
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

    await runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch });

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
