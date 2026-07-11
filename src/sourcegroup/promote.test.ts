import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Source } from '@/model/source';
import type { Rights } from '@/model/rights';
import { serializeSource } from '@/bibliography/migrate-serialize';
import { loadSourceFile } from '@/bibliography/load';
import type { ArkResolver, ExistingMemberRecord } from '@/sourcegroup/verify-member';
import { runPromote } from '@/sourcegroup/promote';

/**
 * Tests for `runPromote` (T024/T025, US3, FR-009a/FR-010a/FR-010b/FR-011,
 * D-03): research approval that RE-RUNS the deterministic verification,
 * RECORDS the verdict, and advances the lifecycle. Every test writes
 * real SSOT-shaped fixtures (a `source-group` plus its member(s)) to a temp
 * `bibliography/sources`-style directory and re-reads them via
 * `loadSourceFile` after the call, so the persisted-on-disk shape (or its
 * ABSENCE after an abort) is verified, not just the return value.
 *
 * Verification I/O is injected -- an `ArkResolver` and a duplicate-lookup set
 * -- and the recorded verdict's timestamp is injected, so every run is
 * deterministic without touching the network.
 */

const ARK = 'ark:/12148/bpt6k1234567';
const GROUP_ID = 'PB-G001';
const MEMBER_ID = 'PB-P100';
const VERIFIED_AT = '2026-07-10T12:00:00.000Z';
const SNAPSHOT_PATH = 'bibliography/repository-responses/PB-P100/bpt6k1234567-abc.json';

/** An ark resolver that resolves every ark (records live). */
const resolvesLive: ArkResolver = async (ark) => ({ ark });
/** An ark resolver that resolves nothing (a dead ark -> identifierResolved fails). */
const resolvesDead: ArkResolver = async () => null;

function publicDomainRights(ark: string): Rights {
  return {
    ark,
    status: 'public-domain',
    rawResponse: '<record/>',
    dcRights: ['public domain'],
  };
}

function group(): Source {
  return {
    sourceId: GROUP_ID,
    titles: [{ text: 'French trial proceedings (Marquis de Rays)', role: 'canonical' }],
    kind: 'source-group',
    case: 'port-breton',
    identifiers: [],
  };
}

function member(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: MEMBER_ID,
    titles: [{ text: 'Le Petit Journal', role: 'canonical' }],
    kind: 'monograph',
    partOf: GROUP_ID,
    status: 'discovered',
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
    status: 'wanted',
    identifiers: [{ type: 'ark', value: ARK }],
    rights: publicDomainRights(ARK),
    metadataSnapshot: {
      path: SNAPSHOT_PATH,
      retrievedAt: '2026-07-01T00:00:00.000Z',
      endpoint: 'https://gallica.bnf.fr/oai',
      normalizationVersion: 1,
    },
    ...overrides,
  };
}

interface Entry {
  source: Source;
  records: AuthoredRepositoryRecord[];
}

async function seed(entries: Entry[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'promote-'));
  for (const entry of entries) {
    await writeFile(
      join(dir, `${entry.source.sourceId}.yml`),
      serializeSource({ source: entry.source, records: entry.records }),
      'utf-8',
    );
  }
  return dir;
}

/** The canonical happy-path fixture: a group plus one discovered member with one record. */
function happyEntries(memberOverrides: Partial<Source> = {}, records = [authoredRecord()]): Entry[] {
  return [
    { source: group(), records: [] },
    { source: member(memberOverrides), records },
  ];
}

function baseInput(dir: string) {
  return {
    sourcesDir: dir,
    sourceId: MEMBER_ID,
    resolveArk: resolvesLive,
    existingMembers: [] as ExistingMemberRecord[],
    verifiedAt: VERIFIED_AT,
  };
}

describe('runPromote', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('re-runs verification, records a passing verdict, and advances both statuses', async () => {
    dir = await seed(happyEntries());

    const result = await runPromote(baseInput(dir));

    expect(result.status).toBe('approved-for-acquisition');
    expect(result.recordStatus).toBe('to-collect');
    expect(result.verdict.result).toBe('passed');

    const { source, records } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
    // Source lifecycle advanced discovered -> approved-for-acquisition.
    expect(source.status).toBe('approved-for-acquisition');
    // The selected RepositoryRecord advanced wanted -> to-collect.
    expect(records[0].status).toBe('to-collect');
    // The passing verdict was recorded, tied to the record's snapshot as evidence.
    expect(records[0].verification).toEqual({
      result: 'passed',
      verifiedAt: VERIFIED_AT,
      checks: {
        identifierResolved: 'passed',
        rights: 'passed',
        requiredMetadata: 'passed',
        hardDuplicate: 'passed',
        possibleDuplicate: 'passed',
      },
      snapshotRef: SNAPSHOT_PATH,
    });
  });

  it('aborts atomically on a failing check: records nothing, changes no status, fails loud', async () => {
    dir = await seed(happyEntries());

    // A dead ark fails the `identifierResolved` hard check -> the rerun aborts.
    await expect(
      runPromote({ ...baseInput(dir), resolveArk: resolvesDead }),
    ).rejects.toThrow(/identifierResolved/i);

    // No partial write: the member is untouched on disk.
    const { source, records } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
    expect(source.status).toBe('discovered');
    expect(records[0].status).toBe('wanted');
    expect(records[0].verification).toBeUndefined();
  });

  it('never rewrites partOf -- membership is authoritative and untouched', async () => {
    dir = await seed(happyEntries());

    await runPromote(baseInput(dir));

    const { source } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
    expect(source.partOf).toBe(GROUP_ID);
  });

  it('accepts a --group flag that equals the existing partOf', async () => {
    dir = await seed(happyEntries());

    const result = await runPromote({ ...baseInput(dir), group: GROUP_ID });

    expect(result.status).toBe('approved-for-acquisition');
    const { source } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
    expect(source.partOf).toBe(GROUP_ID);
  });

  it('fails loud when --group does not equal the existing partOf (never alters membership)', async () => {
    dir = await seed(happyEntries());

    await expect(
      runPromote({ ...baseInput(dir), group: 'PB-G999' }),
    ).rejects.toThrow(/partOf|group|PB-G999/i);

    // Membership and status are untouched.
    const { source } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
    expect(source.partOf).toBe(GROUP_ID);
    expect(source.status).toBe('discovered');
  });

  it('fails loud on an ambiguous copy when no --archive is given', async () => {
    dir = await seed(
      happyEntries({}, [
        authoredRecord({ sourceArchive: 'Gallica / BnF' }),
        authoredRecord({ sourceArchive: 'State Library of Queensland' }),
      ]),
    );

    await expect(runPromote(baseInput(dir))).rejects.toThrow(/ambiguous|--archive/i);

    // Nothing advanced.
    const { source } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
    expect(source.status).toBe('discovered');
  });

  it('selects the right copy with --archive when the member has more than one record', async () => {
    dir = await seed(
      happyEntries({}, [
        authoredRecord({ sourceArchive: 'Gallica / BnF' }),
        authoredRecord({
          sourceArchive: 'State Library of Queensland',
          identifiers: [{ type: 'ark', value: ARK }],
        }),
      ]),
    );

    const result = await runPromote({ ...baseInput(dir), archive: 'State Library of Queensland' });

    expect(result.sourceArchive).toBe('State Library of Queensland');
    const { records } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
    const slq = records.find((r) => r.sourceArchive === 'State Library of Queensland');
    const gallica = records.find((r) => r.sourceArchive === 'Gallica / BnF');
    expect(slq?.status).toBe('to-collect');
    expect(slq?.verification?.result).toBe('passed');
    // The unselected copy is untouched.
    expect(gallica?.status).toBe('wanted');
    expect(gallica?.verification).toBeUndefined();
  });

  it('fails loud when the member is not in discovered status', async () => {
    dir = await seed(happyEntries({ status: 'approved-for-acquisition' }));

    await expect(runPromote(baseInput(dir))).rejects.toThrow(/discovered/i);
  });

  it('fails loud when the member has no status at all', async () => {
    dir = await seed(happyEntries({ status: undefined }));

    await expect(runPromote(baseInput(dir))).rejects.toThrow(/discovered/i);
  });

  it('fails loud when partOf does not resolve to a source-group', async () => {
    // Seed the member but NOT the group file -> partOf is unresolved.
    dir = await seed([{ source: member(), records: [authoredRecord()] }]);

    await expect(runPromote(baseInput(dir))).rejects.toThrow(/partOf|source-group|PB-G001/i);

    const { source } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
    expect(source.status).toBe('discovered');
  });

  it('fails loud when partOf resolves to a non-group source', async () => {
    dir = await seed([
      { source: member({ sourceId: GROUP_ID, kind: 'monograph', partOf: undefined, status: undefined }), records: [] },
      { source: member(), records: [authoredRecord()] },
    ]);

    await expect(runPromote(baseInput(dir))).rejects.toThrow(/source-group/i);
  });

  it('fails loud when the member does not exist', async () => {
    dir = await seed([{ source: group(), records: [] }]);

    await expect(
      runPromote({ ...baseInput(dir), sourceId: 'PB-P999' }),
    ).rejects.toThrow();
  });

  it('fails loud on malformed input (missing resolver)', async () => {
    dir = await seed(happyEntries());
    const bad = { ...baseInput(dir) };
    Reflect.deleteProperty(bad, 'resolveArk');

    await expect(runPromote(bad)).rejects.toThrow(/resolve/i);
  });
});
