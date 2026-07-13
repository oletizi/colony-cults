import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { AssetProvenance } from '@/bibliography/provenance-read';
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
});
