import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { ObjectStore, ObjectHead } from '@/archive/object-store';
import { writeFile } from 'node:fs/promises';
import { serializeSource } from '@/bibliography/migrate-serialize';
import { loadAllSources } from '@/bibliography/load';
import { runReconcile, type GatherProvenanceFn } from '@/sourcegroup/reconcile';

/**
 * Tests for `runReconcile` (TASK-21, spec-compliance for
 * specs/006-source-group-acquisition/contracts/cli-commands.md line 64):
 * fold the archive's per-page object_store provenance into the SSOT's
 * `repositoryRecords[].status`. The provenance gatherer is INJECTED so these
 * tests never touch a real archive on disk (mirroring how `runAcquire` injects
 * its fetcher).
 */

const ARK = 'ark:/12148/bpt6k1234567';
const ARCHIVE = 'Gallica / BnF';

function objectStore(key: string) {
  return {
    provider: 'backblaze-b2',
    bucket: 'colony-cults',
    key,
    endpoint: 'https://s3.us-west-004.backblazeb2.com',
  };
}

function pageImage(overrides: Partial<AssetProvenance> = {}): AssetProvenance {
  const key = overrides.local_path ?? 'archive/cases/x/books/y/f001.jpg';
  return {
    source_archive: ARCHIVE,
    local_path: key,
    type: 'page-image',
    sha256: 'a'.repeat(64),
    object_store: objectStore(key),
    format: 'image/jpeg',
    original_url: 'https://gallica.bnf.fr/iiif/x/f1/full/full/0/native.jpg',
    ...overrides,
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
    sourceArchive: ARCHIVE,
    status: 'to-collect',
    identifiers: [{ type: 'ark', value: ARK }],
    ...overrides,
  };
}

const MUSEUM_ARCHIVE = 'New Italy Museum';
const OBJ_KEY = 'archive/cases/new-italy/museum/nimi-0844/NIMI-0844.jpg';
const CHECKSUM = 'c'.repeat(64);

/** A recorded {@link AcquiredAsset} the museum acquire persisted (TASK-30). */
function acquiredAsset(overrides: Partial<AcquiredAsset> = {}): AcquiredAsset {
  return {
    sourceUrl: 'https://newitaly.org.au/CAT/000844.htm',
    mediaType: 'image/jpeg',
    objectStoreKey: OBJ_KEY,
    checksum: CHECKSUM,
    byteLength: 987654,
    provenancePath: 'archive/cases/new-italy/museum/nimi-0844/NIMI-0844.provenance.json',
    ...overrides,
  };
}

/** A museum copy: carries recorded object-store `assets` (no archive provenance). */
function museumRecord(
  overrides: Partial<AuthoredRepositoryRecord> = {},
): AuthoredRepositoryRecord {
  return {
    sourceArchive: MUSEUM_ARCHIVE,
    status: 'to-collect',
    identifiers: [{ type: 'accession', value: 'NIMI-0844' }],
    assets: [acquiredAsset()],
    ...overrides,
  };
}

/**
 * A fake {@link ObjectStore} whose `head` answers from an in-memory map keyed
 * by object-store key: `'missing'` -> `{ exists: false }`, a `{ sha256 }` ->
 * `{ exists: true, sha256 }`. `put`/`get`/`attachSha256Metadata` throw -- the
 * reconcile museum path never calls them.
 */
function fakeObjectStore(entries: Record<string, { sha256?: string } | 'missing'>): ObjectStore {
  return {
    async head(key: string): Promise<ObjectHead> {
      const entry = entries[key];
      if (entry === undefined || entry === 'missing') {
        return { exists: false };
      }
      return entry.sha256 === undefined
        ? { exists: true }
        : { exists: true, sha256: entry.sha256 };
    },
    async put() {
      throw new Error('fakeObjectStore.put: not used on the reconcile museum path');
    },
    async get() {
      throw new Error('fakeObjectStore.get: not used on the reconcile museum path');
    },
    async attachSha256Metadata() {
      throw new Error('fakeObjectStore.attachSha256Metadata: not used on the reconcile museum path');
    },
  };
}

async function seedSourcesDir(
  entries: { source: Source; records: AuthoredRepositoryRecord[] }[],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'reconcile-'));
  for (const entry of entries) {
    await writeFile(join(dir, `${entry.source.sourceId}.yml`), serializeSource(entry), 'utf-8');
  }
  return dir;
}

/** Read back one source's sole record status from the written SSOT file. */
async function statusOf(dir: string, sourceId: string, archive = ARCHIVE): Promise<string> {
  const loaded = loadAllSources(dir);
  const entry = loaded.find((l) => l.source.sourceId === sourceId);
  if (entry === undefined) {
    throw new Error(`test: ${sourceId} not found`);
  }
  const record = entry.records.find((r) => r.sourceArchive === archive);
  if (record === undefined) {
    throw new Error(`test: ${sourceId} has no record for ${archive}`);
  }
  return record.status;
}

describe('runReconcile', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('advances the record to archived when every page-image master is object-store-backed', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ local_path: 'archive/cases/x/books/y/f001.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f002.jpg' }),
    ]);

    const result = await runReconcile({
      sourcesDir: dir,
      archiveRoot: '/unused',
      sourceId: 'PB-P100',
      gather,
    });

    expect(result.status).toBe('archived');
    expect(result.sourceArchive).toBe(ARCHIVE);
    expect(result.pageCount).toBe(2);
    expect(result.storedCount).toBe(2);
    expect(result.changed).toBe(true);
    expect(await statusOf(dir, 'PB-P100')).toBe('archived');
  });

  it('advances to collected when some page-image masters are not yet object-store-backed', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ local_path: 'archive/cases/x/books/y/f001.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f002.jpg', object_store: null }),
    ]);

    const result = await runReconcile({
      sourcesDir: dir,
      archiveRoot: '/unused',
      sourceId: 'PB-P100',
      gather,
    });

    expect(result.status).toBe('collected');
    expect(result.pageCount).toBe(2);
    expect(result.storedCount).toBe(1);
    expect(await statusOf(dir, 'PB-P100')).toBe('collected');
  });

  it('ignores non-page-image assets (translations/OCR are object_store:null) when deriving status', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ local_path: 'archive/cases/x/books/y/f001.jpg' }),
      // A translation sidecar: not a master, always object_store:null -- must not drag status to collected.
      {
        source_archive: ARCHIVE,
        local_path: 'archive/cases/x/books/y/translation/p001.en.txt',
        type: 'english-translation',
        sha256: 'b'.repeat(64),
        object_store: null,
        format: 'text/plain',
        original_url: '',
      },
    ]);

    const result = await runReconcile({
      sourcesDir: dir,
      archiveRoot: '/unused',
      sourceId: 'PB-P100',
      gather,
    });

    expect(result.status).toBe('archived');
    expect(result.pageCount).toBe(1);
    expect(result.storedCount).toBe(1);
  });

  it('is idempotent: re-running on an already-archived record reports changed:false and rewrites byte-identical YAML', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ local_path: 'archive/cases/x/books/y/f001.jpg' }),
    ]);

    const first = await runReconcile({ sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P100', gather });
    expect(first.changed).toBe(true);
    const afterFirst = await readFile(join(dir, 'PB-P100.yml'), 'utf-8');

    const second = await runReconcile({ sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P100', gather });
    expect(second.changed).toBe(false);
    expect(second.status).toBe('archived');
    const afterSecond = await readFile(join(dir, 'PB-P100.yml'), 'utf-8');
    expect(afterSecond).toBe(afterFirst);
  });

  it('selects the record matching --archive and only considers that archive\'s provenance', async () => {
    dir = await seedSourcesDir([
      {
        source: member(),
        records: [
          authoredRecord(),
          authoredRecord({ sourceArchive: 'State Library of Queensland' }),
        ],
      },
    ]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ source_archive: 'State Library of Queensland', local_path: 'archive/slq/f001.jpg' }),
      // Gallica has provenance too, but only the selected archive should be read.
      pageImage({ source_archive: ARCHIVE, local_path: 'archive/gallica/f001.jpg', object_store: null }),
    ]);

    const result = await runReconcile({
      sourcesDir: dir,
      archiveRoot: '/unused',
      sourceId: 'PB-P100',
      archive: 'State Library of Queensland',
      gather,
    });

    expect(result.sourceArchive).toBe('State Library of Queensland');
    expect(result.status).toBe('archived');
    expect(await statusOf(dir, 'PB-P100', 'State Library of Queensland')).toBe('archived');
    // The other copy is untouched.
    expect(await statusOf(dir, 'PB-P100', ARCHIVE)).toBe('to-collect');
  });

  it('fails loud (writes nothing) when there is no page-image provenance for the copy', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => []);

    await expect(
      runReconcile({ sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P100', gather }),
    ).rejects.toThrow(/nothing acquired to reconcile/i);
    expect(await statusOf(dir, 'PB-P100')).toBe('to-collect');
  });

  it('fails loud when the member is unknown (no gather)', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => []);

    await expect(
      runReconcile({ sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P999', gather }),
    ).rejects.toThrow(/unknown sourceId/i);
    expect(gather).not.toHaveBeenCalled();
  });

  it('fails loud when the member has zero RepositoryRecords (no gather)', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => []);

    await expect(
      runReconcile({ sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P100', gather }),
    ).rejects.toThrow(/nothing to select/i);
    expect(gather).not.toHaveBeenCalled();
  });

  it('fails loud on ambiguous copy (multiple records, no --archive) before gathering', async () => {
    dir = await seedSourcesDir([
      {
        source: member(),
        records: [authoredRecord(), authoredRecord({ sourceArchive: 'State Library of Queensland' })],
      },
    ]);
    const gather: GatherProvenanceFn = vi.fn(async () => []);

    await expect(
      runReconcile({ sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P100', gather }),
    ).rejects.toThrow(/ambiguous|--archive/i);
    expect(gather).not.toHaveBeenCalled();
  });

  it('fails loud on malformed input (missing sourceId) without gathering', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => []);
    const bad = { sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P100', gather };
    Reflect.deleteProperty(bad, 'sourceId');

    await expect(runReconcile(bad)).rejects.toThrow(/sourceId/i);
    expect(gather).not.toHaveBeenCalled();
  });

  it('fails loud on malformed input (missing archiveRoot)', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => []);
    const bad = { sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P100', gather };
    Reflect.deleteProperty(bad, 'archiveRoot');

    await expect(runReconcile(bad)).rejects.toThrow(/archiveRoot/i);
    expect(gather).not.toHaveBeenCalled();
  });

  // --- Museum (pure-B2) path (TASK-30): reconcile against the object store ---

  it('TASK-30: advances a museum record to archived when its recorded asset heads present with a matching checksum', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [museumRecord()] }]);
    const store = fakeObjectStore({ [OBJ_KEY]: { sha256: CHECKSUM } });

    const result = await runReconcile({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      objectStore: store,
    });

    expect(result.status).toBe('archived');
    expect(result.sourceArchive).toBe(MUSEUM_ARCHIVE);
    expect(result.pageCount).toBe(1);
    expect(result.storedCount).toBe(1);
    expect(result.changed).toBe(true);
    expect(await statusOf(dir, 'PB-P100', MUSEUM_ARCHIVE)).toBe('archived');
  });

  it('TASK-30: does NOT advance a museum record when the recorded object is missing from the store', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [museumRecord()] }]);
    const store = fakeObjectStore({}); // key absent -> head { exists: false }

    const result = await runReconcile({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      objectStore: store,
    });

    expect(result.status).toBe('to-collect'); // unchanged, never overstated
    expect(result.pageCount).toBe(1);
    expect(result.storedCount).toBe(0);
    expect(result.changed).toBe(false);
    expect(await statusOf(dir, 'PB-P100', MUSEUM_ARCHIVE)).toBe('to-collect');
  });

  it('TASK-30: does NOT advance when only some of several recorded assets are backed', async () => {
    const secondKey = 'archive/cases/new-italy/museum/nimi-0844/NIMI-0844-reverse.jpg';
    const secondSum = 'e'.repeat(64);
    dir = await seedSourcesDir([
      {
        source: member(),
        records: [
          museumRecord({
            assets: [
              acquiredAsset(),
              acquiredAsset({ objectStoreKey: secondKey, checksum: secondSum, role: 'reverse' }),
            ],
          }),
        ],
      },
    ]);
    // Only the first master is present in the store; the reverse is missing.
    const store = fakeObjectStore({ [OBJ_KEY]: { sha256: CHECKSUM } });

    const result = await runReconcile({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      objectStore: store,
    });

    expect(result.status).toBe('to-collect');
    expect(result.pageCount).toBe(2);
    expect(result.storedCount).toBe(1);
    expect(result.changed).toBe(false);
  });

  it('TASK-30: fails loud (writes nothing) on a checksum MISMATCH for a museum asset', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [museumRecord()] }]);
    const store = fakeObjectStore({ [OBJ_KEY]: { sha256: 'd'.repeat(64) } });

    await expect(
      runReconcile({ sourcesDir: dir, sourceId: 'PB-P100', objectStore: store }),
    ).rejects.toThrow(/checksum MISMATCH/i);
    // The record is left untouched -- a wrong master is an error, not an advance.
    expect(await statusOf(dir, 'PB-P100', MUSEUM_ARCHIVE)).toBe('to-collect');
  });

  it('TASK-30: fails loud when a museum record is reconciled without an injected object store', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [museumRecord()] }]);

    await expect(
      runReconcile({ sourcesDir: dir, sourceId: 'PB-P100' }),
    ).rejects.toThrow(/objectStore is required/i);
    expect(await statusOf(dir, 'PB-P100', MUSEUM_ARCHIVE)).toBe('to-collect');
  });

  // --- Excerpt folios (specs/012, T010/T014): declared-folio-aware verification ---

  it('verifies a folios excerpt against the declared set and reports N/N declared folios, marking it archived', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ folios: [48, 49, 50] })] },
    ]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ local_path: 'archive/cases/x/books/y/f048.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f049.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f050.jpg' }),
    ]);

    const result = await runReconcile({
      sourcesDir: dir,
      archiveRoot: '/unused',
      sourceId: 'PB-P100',
      gather,
    });

    expect(result.status).toBe('archived');
    expect(result.pageCount).toBe(3);
    expect(result.storedCount).toBe(3);
    expect(result.folios).toEqual([48, 49, 50]);
    expect(result.changed).toBe(true);
    expect(await statusOf(dir, 'PB-P100')).toBe('archived');
  });

  it('does not let page-image masters outside the declared folios inflate or depress an excerpt\'s count', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ folios: [48, 49, 50] })] },
    ]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      // Declared folios: all three backed.
      pageImage({ local_path: 'archive/cases/x/books/y/f048.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f049.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f050.jpg' }),
      // A sibling folio of the same document, outside the excerpt, not backed.
      pageImage({ local_path: 'archive/cases/x/books/y/f051.jpg', object_store: null }),
    ]);

    const result = await runReconcile({
      sourcesDir: dir,
      archiveRoot: '/unused',
      sourceId: 'PB-P100',
      gather,
    });

    // The excerpt is complete once its OWN 3 declared folios verify -- the
    // unrelated, unbacked f051 must not prevent archived (no held===pageCount
    // whole-document gate).
    expect(result.status).toBe('archived');
    expect(result.pageCount).toBe(3);
    expect(result.storedCount).toBe(3);
  });

  it('reports a partially-backed excerpt as collected, counting only the declared folios', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ folios: [48, 49, 50] })] },
    ]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ local_path: 'archive/cases/x/books/y/f048.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f049.jpg', object_store: null }),
      // f050 never fetched at all -- no provenance entry for it.
    ]);

    const result = await runReconcile({
      sourcesDir: dir,
      archiveRoot: '/unused',
      sourceId: 'PB-P100',
      gather,
    });

    expect(result.status).toBe('collected');
    expect(result.pageCount).toBe(3);
    expect(result.storedCount).toBe(1);
    expect(result.folios).toEqual([48, 49, 50]);
  });

  it('round-trips: reconciling a folios excerpt preserves folios in the rewritten SSOT YAML', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ folios: [48, 49, 50] })] },
    ]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ local_path: 'archive/cases/x/books/y/f048.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f049.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f050.jpg' }),
    ]);

    await runReconcile({ sourcesDir: dir, archiveRoot: '/unused', sourceId: 'PB-P100', gather });

    const loaded = loadAllSources(dir);
    const entry = loaded.find((l) => l.source.sourceId === 'PB-P100');
    expect(entry).toBeDefined();
    expect(entry?.records[0]?.folios).toEqual([48, 49, 50]);
    expect(entry?.records[0]?.status).toBe('archived');

    const rewritten = await readFile(join(dir, 'PB-P100.yml'), 'utf-8');
    expect(rewritten).toContain('folios:');
    expect(rewritten).toMatch(/folios:\s*\n\s*- 48\s*\n\s*- 49\s*\n\s*- 50/);
  });

  it('a whole-document record (no folios) reconciles exactly as before -- regression', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => [
      pageImage({ local_path: 'archive/cases/x/books/y/f001.jpg' }),
      pageImage({ local_path: 'archive/cases/x/books/y/f002.jpg' }),
    ]);

    const result = await runReconcile({
      sourcesDir: dir,
      archiveRoot: '/unused',
      sourceId: 'PB-P100',
      gather,
    });

    expect(result.status).toBe('archived');
    expect(result.pageCount).toBe(2);
    expect(result.storedCount).toBe(2);
    expect(result.folios).toBeUndefined();
  });

  it('TASK-30: the museum path needs no archiveRoot/gather (its truth is B2 + the recorded asset)', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [museumRecord()] }]);
    const gather: GatherProvenanceFn = vi.fn(async () => []);
    const store = fakeObjectStore({ [OBJ_KEY]: { sha256: CHECKSUM } });

    // No archiveRoot passed at all; gather is injected but must never be called.
    const result = await runReconcile({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      objectStore: store,
      gather,
    });

    expect(result.status).toBe('archived');
    expect(gather).not.toHaveBeenCalled();
  });
});
