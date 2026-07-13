import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { Rights } from '@/model/rights';
import type { Source } from '@/model/source';
import { runPromote } from '@/sourcegroup/promote';
import { runAcquire, type FetchSourceFn } from '@/sourcegroup/acquire';
import type { ArkResolver, ExistingMemberRecord } from '@/sourcegroup/verify-member';

/**
 * T016/T017 (spec 010, US3/FR-007; contracts/scope-model.md INV-APPROVE,
 * INV-3): the approve (`promote`) and `acquire` paths are gated on the SAME
 * explicit predicate, `isFetchableWork` (`@/bibliography/scope`) -- a
 * work-bundle (`kind: 'source-group'`) MUST be rejected loud on either path,
 * and a fetchable work MUST NOT be rejected by this guard.
 *
 * These tests prove the guard is a genuinely explicit, kind-based predicate
 * -- not a side effect of `status` happening to never be set on a group --
 * by forcing a `status` value onto the group fixture that would otherwise
 * satisfy the pre-existing precondition (`discovered` for promote,
 * `approved-for-acquisition` for acquire) and confirming the container is
 * STILL rejected, on account of its `kind`.
 */

const ARK = 'ark:/12148/bpt6k1234567';
const GROUP_ID = 'PB-G001';
const MEMBER_ID = 'PB-P100';
const VERIFIED_AT = '2026-07-10T12:00:00.000Z';
const SNAPSHOT_PATH = 'bibliography/repository-responses/PB-P100/bpt6k1234567-abc.json';

const resolvesLive: ArkResolver = async (ark) => ({ ark });

function publicDomainRights(ark: string): Rights {
  return {
    ark,
    status: 'public-domain',
    rawResponse: '<record/>',
    dcRights: ['public domain'],
  };
}

function group(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: GROUP_ID,
    titles: [{ text: 'French trial proceedings (Marquis de Rays)', role: 'canonical' }],
    kind: 'source-group',
    identifiers: [],
    ...overrides,
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
  const dir = await mkdtemp(join(tmpdir(), 'approve-gate-'));
  for (const entry of entries) {
    await writeFile(
      join(dir, `${entry.source.sourceId}.yml`),
      serializeSource({ source: entry.source, records: entry.records }),
      'utf-8',
    );
  }
  return dir;
}

describe('approve/acquire gate on isFetchableWork (INV-APPROVE, INV-3)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('runPromote (approve path)', () => {
    it('allows promoting a fetchable work (monograph) -- not rejected by this guard', async () => {
      dir = await seed([
        { source: group(), records: [] },
        { source: member(), records: [authoredRecord()] },
      ]);

      const result = await runPromote({
        sourcesDir: dir,
        sourceId: MEMBER_ID,
        resolveArk: resolvesLive,
        existingMembers: [] as ExistingMemberRecord[],
        verifiedAt: VERIFIED_AT,
      });

      expect(result.status).toBe('approved-for-acquisition');
    });

    it('rejects loud when the target is a source-group, even if it were somehow "discovered" (INV-3)', async () => {
      // Force status: 'discovered' onto the group fixture -- if the guard
      // were merely piggybacking on the status precondition, this would slip
      // through. The explicit isFetchableWork predicate must reject it on
      // account of its kind regardless.
      dir = await seed([{ source: group({ status: 'discovered' }), records: [] }]);

      await expect(
        runPromote({
          sourcesDir: dir,
          sourceId: GROUP_ID,
          resolveArk: resolvesLive,
          existingMembers: [] as ExistingMemberRecord[],
          verifiedAt: VERIFIED_AT,
        }),
      ).rejects.toThrow(/source-group|work-bundle/i);
    });
  });

  describe('runAcquire (acquisition path)', () => {
    it('allows acquiring a fetchable work (monograph) -- not rejected by this guard', async () => {
      dir = await seed([
        { source: member({ status: 'approved-for-acquisition' }), records: [authoredRecord({ status: 'to-collect' })] },
      ]);
      const fetch: FetchSourceFn = vi.fn(async () => undefined);

      const result = await runAcquire({ sourcesDir: dir, sourceId: MEMBER_ID, fetch });

      expect(result.ark).toBe(ARK);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('rejects loud when the target is a source-group, even if it were somehow "approved-for-acquisition" (INV-3)', async () => {
      // Force status: 'approved-for-acquisition' onto the group fixture --
      // if the guard were merely piggybacking on the status precondition,
      // this would slip through. The explicit isFetchableWork predicate must
      // reject it on account of its kind regardless.
      dir = await seed([{ source: group({ status: 'approved-for-acquisition' }), records: [] }]);
      const fetch: FetchSourceFn = vi.fn(async () => undefined);

      await expect(
        runAcquire({ sourcesDir: dir, sourceId: GROUP_ID, fetch }),
      ).rejects.toThrow(/source-group|work-bundle/i);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
