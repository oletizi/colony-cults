import { mkdtemp, writeFile } from 'node:fs/promises';
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


/**
 * Tests for `runAcquire` (T029/T030, FR-014-017, D-08): acquire an approved
 * member's copy by REUSING the shipped `runFetchSource` fetcher -- resolving
 * the ARK from the selected RepositoryRecord and driving the fetcher with it.
 * NO new fetch code lives here; the fetcher itself is injected so these tests
 * never touch the network/B2 (US4 scenarios 1-5).
 */

export const ARK = 'ark:/12148/bpt6k1234567';

export function publicDomainRights(ark: string): Rights {
  return {
    ark,
    status: 'public-domain',
    rawResponse: '<record/>',
    dcRights: ['public domain'],
  };
}

export function otherRights(ark: string): Rights {
  return {
    ark,
    status: 'other',
    rawResponse: '<record/>',
    dcRights: ['all rights reserved'],
  };
}

export function member(overrides: Partial<Source> = {}): Source {
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

export function authoredRecord(
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
export function museumMember(overrides: Partial<Source> = {}): Source {
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
export function museumAuthoredRecord(
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
export function spyMuseumAdapter(): { adapter: RepositoryAdapter; calls: RepositoryRecord[] } {
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
export function internetArchiveMember(overrides: Partial<Source> = {}): Source {
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
export function internetArchiveAuthoredRecord(
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
export function spyInternetArchiveAdapter(): { adapter: RepositoryAdapter; calls: RepositoryRecord[] } {
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
export function papersPastMember(overrides: Partial<Source> = {}): Source {
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
export function papersPastAuthoredRecord(
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
export function spyPapersPastAdapter(): { adapter: RepositoryAdapter; calls: RepositoryRecord[] } {
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
export function sampleAsset(overrides: Partial<AcquiredAsset> = {}): AcquiredAsset {
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
export function acquiringMuseumAdapter(assets: AcquiredAsset[]): RepositoryAdapter {
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
export function fakeObjectStore(
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
export function pageImage(sourceArchive: string, seq: number, backed: boolean): AssetProvenance {
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
export function gallicaCompletionDeps(
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
export function idempotentMuseumAdapter(
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

export async function seedSourcesDir(
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
