import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Rights } from '@/model/rights';
import { serializeSource } from '@/bibliography/migrate-serialize';
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
