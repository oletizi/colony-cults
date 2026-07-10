import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAllSources, loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Rights } from '@/model/rights';
import type { Source } from '@/model/source';
import { runPromote } from '@/sourcegroup/promote';
import { runExcludeMember } from '@/sourcegroup/exclude-member';
import { runAcquire, type FetchSourceFn } from '@/sourcegroup/acquire';
import { runVerifyMember } from '@/sourcegroup/verify-member-command';
import type { ArkResolver, ExistingMemberRecord } from '@/sourcegroup/verify-member';

/**
 * T035 — fail-loud negative-path coverage sweep (spec SC-005 / FR-021).
 *
 * SC-005: "Every command fails loud with an informative message on its
 * defined error conditions (unresolved group, dead ARK, non-public-domain
 * rights, cross-domain status, unavailable discovery mechanism) — verified
 * with negative-path fixtures." Read together with FR-009a, "ambiguous copy"
 * is the sixth cross-command error condition (ambiguous RepositoryRecord
 * selection).
 *
 * This file does NOT re-implement coverage that already exists per-command
 * (see the "existing" column below) — it (a) closes two genuine gaps found
 * during the audit and (b) adds ONE cross-command consolidation proving
 * error messages actually name their subject (id/group/ark/archive/status),
 * not a bare "error". No production code was changed to write this file.
 *
 * ## Coverage matrix (command × SC-005 error condition)
 *
 * | Command                    | unresolved group                                          | dead ARK                                                              | non-public-domain rights                                                    | cross-domain status                                                              | ambiguous copy                                                          | discovery mechanism unavailable            |
 * |-----------------------------|------------------------------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|----------------------------------------------------------------------------|-----------------------------------------------|
 * | `inventory`                  | inventory.test.ts: "fails loud and creates nothing when --group does not resolve..." (x2, incl. non-source-group kind) | inventory.test.ts: "fails loud and creates nothing when the ark cannot be resolved" | inventory.test.ts: "non-public-domain: record is still created but flagged not-acquirable" — by design NOT fail-loud (FR-003); terminal path is `exclude-member` | n/a — inventory only writes, never re-reads an existing member's status            | n/a — inventory always creates exactly one RepositoryRecord                | n/a (not a discovery command)                  |
 * | `verify-member` (pure fn)    | n/a (no group concept)                                      | verify-member.test.ts: "fails identifierResolved... when the ark does not resolve" | verify-member.test.ts: "fails rights (and overall) when rights are not public-domain" (x2) | n/a (operates on already-loaded Source/RepositoryRecord in memory)                 | n/a (record already selected upstream)                                     | n/a                                             |
 * | `verify-member` (command)    | n/a                                                          | verify-member-command.test.ts: "prints a failing verdict... STILL exits 0" (verdict is data, not a thrown error — deliberate per module docs) | verify-member.test.ts (shared fn, above); verdict is data, not fail-loud       | loader-level rejection already thorough (`tests/unit/bibliography/load.test.ts`, incl. an `it.each` over every acquisition status); **NEW below** closes the narrower COMMAND-PROPAGATION gap — no test proved `verify-member` (command) surfaces this loader error verbatim rather than swallowing/misreporting it | verify-member-command.test.ts: "fails loud when the member has an ambiguous copy and no --archive is given" | n/a                                             |
 * | `promote`                     | promote.test.ts: "fails loud when partOf does not resolve to a source-group"; "...--group does not equal the existing partOf" | promote.test.ts: "aborts atomically on a failing check" (dead ark -> `identifierResolved` fails, rerun aborts) | verify-member.test.ts covers the shared rerun check; promote's abort mechanism is proven via the dead-ark case (same `verdict.result !== 'passed'` code path) — **not a gap** | same command-propagation gap as above; **NEW below** closes it for `promote` | promote.test.ts: "fails loud on an ambiguous copy when no --archive is given" | n/a                                             |
 * | `promote` (D-03 evidence tie) | —                                                            | —                                                                         | —                                                                               | —                                                                                     | —                                                                            | **NEW below** — "promote fails loud when the selected copy has no metadataSnapshot" (FR-010b/D-03; not itself an SC-005-named condition but a defined fail-loud precondition) |
 * | `exclude-member`              | n/a (exclude-member never re-supplies/validates a group)     | n/a                                                                       | n/a (exclude-member is the terminal path FOR a non-PD member, not a rights re-check) | n/a (loadSourceFile's cross-domain gate applies identically here; proven once via `promote`/`verify-member` above rather than re-proven per command) | n/a (exclude-member never selects a RepositoryRecord copy)                  | n/a                                             |
 * | `acquire`                      | n/a                                                          | n/a (acquire does not call `resolveArk`; it requires an ark identifier be present on the selected record, separately tested) | acquire.test.ts: "fails loud when the selected record is not public-domain" (x2, incl. absent rights) | n/a (same shared-gate note as `exclude-member`)                                     | acquire.test.ts: "fails loud when the member has more than one RepositoryRecord and no --archive is given" | n/a                                             |
 * | `discovery` (dispatcher)      | n/a                                                          | n/a                                                                       | n/a                                                                              | n/a                                                                                   | n/a                                                                          | discovery.test.ts: "throws DiscoveryUnavailableError when the mechanism is unavailable" (x4, incl. availability-check itself throwing, and no-fallback proof) |
 * | `bnf-sru` / `ark-resolver`    | n/a                                                          | bnf-sru.test.ts / ark-resolver.test.ts: zero-record response -> `null`/`[]`; HTTP/parse failures fail loud (support layer under inventory/verify-member's "dead ARK") | n/a                                                                              | n/a                                                                                   | n/a                                                                          | n/a (single documented mechanism; no fallback)  |
 * | cross-command                 | —                                                            | —                                                                         | —                                                                               | —                                                                                     | —                                                                            | **NEW below** — "error messages name their subject" sweep over promote/exclude-member/acquire's 'member not found' path (previously asserted only via bare `.rejects.toThrow()`) |
 *
 * ## Gaps found and filled here
 *
 * 1. **promote / D-03 evidence tie**: `runPromote` throws when the selected
 *    copy has no `metadataSnapshot` to record the verdict against (promote.ts
 *    lines ~259-265) — this precondition had NO test anywhere.
 * 2. **cross-domain status, command-propagation gap** (FR-022 "vice-versa"
 *    direction: Source.status carrying a RepositoryRecord-only acquisition
 *    value, e.g. `archived`). NOTE: the loader-level rejection itself
 *    (`@/bibliography/load.ts`'s `isStatusValue`) is already thoroughly
 *    tested in `tests/unit/bibliography/load.test.ts` ("throws a clear
 *    cross-domain error...", `it.each` over every acquisition status) — that
 *    is NOT the gap. The gap is narrower: no command-level test proved that a
 *    `sourcegroup` command actually PROPAGATES this loader error verbatim
 *    (rather than swallowing or misreporting it) when it routes through
 *    `loadSourceFile`/`loadAllSources` on a real member file. Filled here via
 *    two commands that use the two different loader entry points (`promote`
 *    -> `loadSourceFile` directly; `verify-member` (command) ->
 *    `loadAllSources` via its injected `loadMembers`), rather than
 *    re-proving it on all six.
 * 3. **Informative-message sweep**: `promote`/`exclude-member`/`acquire`'s
 *    existing "member does not exist" tests asserted only `.rejects.toThrow()`
 *    with no message-content check. Consolidated here into one assertion set
 *    per command confirming the unresolved id is actually named.
 */

const ARK = 'ark:/12148/bpt6k1234567';
const GROUP_ID = 'PB-G001';
const MEMBER_ID = 'PB-P100';

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
      path: 'bibliography/repository-responses/PB-P100/bpt6k1234567-abc.json',
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
  const dir = await mkdtemp(join(tmpdir(), 'negative-paths-'));
  for (const entry of entries) {
    await writeFile(
      join(dir, `${entry.source.sourceId}.yml`),
      serializeSource({ source: entry.source, records: entry.records }),
      'utf-8',
    );
  }
  return dir;
}

/**
 * Write a raw YAML SSOT file directly (bypassing `Source`'s TS-narrowed
 * `status?: SourceLifecycleStatus` type), the same technique
 * `inventory.test.ts` uses for its group fixtures. This is the ONLY way to
 * author a cross-domain (RepositoryRecord-acquisition-only) status value on a
 * Source in a test without an `as`/`any` cast — the loader's fail-loud gate
 * is a RUNTIME check specifically because the on-disk YAML is untyped.
 */
async function seedRawYaml(dir: string, sourceId: string, yaml: string): Promise<void> {
  await writeFile(join(dir, `${sourceId}.yml`), yaml, 'utf-8');
}

/** A member SSOT file whose `status` is `archived` -- a RepositoryRecord-only acquisition value, never valid on a Source (FR-022 cross-domain rejection). */
const CROSS_DOMAIN_STATUS_MEMBER_YML = [
  `sourceId: ${MEMBER_ID}`,
  'kind: monograph',
  `partOf: ${GROUP_ID}`,
  'status: archived',
  'creator: Anonyme',
  'titles:',
  '  - text: Le Petit Journal',
  '    role: canonical',
  'repositoryRecords:',
  '  - sourceArchive: Gallica / BnF',
  '    status: wanted',
  '    identifiers:',
  '      - type: ark',
  `        value: ${ARK}`,
  '    rights:',
  `      ark: ${ARK}`,
  '      status: public-domain',
  '      rawResponse: "<record/>"',
  '      dcRights:',
  '        - public domain',
  '',
].join('\n');

const resolvesLive: ArkResolver = async (ark) => ({ ark });

describe('negative-path sweep: gaps found and filled (T035)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('GAP 1 — promote: missing metadataSnapshot (FR-010b/D-03)', () => {
    it('fails loud, naming metadataSnapshot, and writes nothing when the selected copy carries no metadataSnapshot', async () => {
      dir = await seed([
        { source: group(), records: [] },
        {
          source: member(),
          records: [authoredRecord({ metadataSnapshot: undefined })],
        },
      ]);

      await expect(
        runPromote({
          sourcesDir: dir,
          sourceId: MEMBER_ID,
          resolveArk: resolvesLive,
          existingMembers: [] as ExistingMemberRecord[],
          verifiedAt: '2026-07-10T12:00:00.000Z',
        }),
      ).rejects.toThrow(/metadataSnapshot/i);

      // No partial write: the member is untouched on disk.
      const { source, records } = loadSourceFile(join(dir, `${MEMBER_ID}.yml`));
      expect(source.status).toBe('discovered');
      expect(records[0].status).toBe('wanted');
      expect(records[0].verification).toBeUndefined();
    });
  });

  describe('GAP 2 — cross-domain status (FR-022, "vice-versa" direction: an acquisition value on Source.status)', () => {
    it('promote fails loud, naming the offending status, when the member SSOT carries a cross-domain status value', async () => {
      dir = await seed([{ source: group(), records: [] }]);
      await seedRawYaml(dir, MEMBER_ID, CROSS_DOMAIN_STATUS_MEMBER_YML);

      await expect(
        runPromote({
          sourcesDir: dir,
          sourceId: MEMBER_ID,
          resolveArk: resolvesLive,
          existingMembers: [] as ExistingMemberRecord[],
          verifiedAt: '2026-07-10T12:00:00.000Z',
        }),
      ).rejects.toThrow(/archived.*Source lifecycle|Source lifecycle.*archived/is);
    });

    it('verify-member (command) fails loud, naming the offending status, when a loaded member carries a cross-domain status value', async () => {
      dir = await seed([{ source: group(), records: [] }]);
      await seedRawYaml(dir, MEMBER_ID, CROSS_DOMAIN_STATUS_MEMBER_YML);

      const result = await runVerifyMember({
        id: MEMBER_ID,
        sourcesDir: dir,
        loadMembers: (sourcesDir) => loadAllSources(sourcesDir),
        resolveArk: resolvesLive,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.verdict).toBeUndefined();
      expect(result.error).toMatch(/archived/i);
      expect(result.error).toMatch(/Source lifecycle/i);
    });
  });

  describe('cross-command consolidation — error messages name their subject, never a bare "error"', () => {
    const UNKNOWN_ID = 'PB-P999';

    it('promote names the unresolved id when the member does not exist', async () => {
      dir = await seed([{ source: group(), records: [] }]);

      await expect(
        runPromote({
          sourcesDir: dir,
          sourceId: UNKNOWN_ID,
          resolveArk: resolvesLive,
          existingMembers: [] as ExistingMemberRecord[],
          verifiedAt: '2026-07-10T12:00:00.000Z',
        }),
      ).rejects.toThrow(new RegExp(UNKNOWN_ID));
    });

    it('exclude-member names the unresolved id when the member does not exist', async () => {
      dir = await seed([{ source: group(), records: [] }]);

      await expect(
        runExcludeMember({ sourcesDir: dir, sourceId: UNKNOWN_ID, reason: 'n/a' }),
      ).rejects.toThrow(new RegExp(UNKNOWN_ID));
    });

    it('acquire names the unresolved id when the member does not exist', async () => {
      dir = await seed([{ source: group(), records: [] }]);
      const fetch: FetchSourceFn = vi.fn(async () => undefined);

      await expect(
        runAcquire({ sourcesDir: dir, sourceId: UNKNOWN_ID, fetch }),
      ).rejects.toThrow(new RegExp(UNKNOWN_ID));
      expect(fetch).not.toHaveBeenCalled();
    });

    // verify-member (command) already asserts this (verify-member-command.test.ts,
    // "fails loud when the member is missing") -- not duplicated here.

    it('promote names the mismatched --group and the actual partOf on a group assertion failure', async () => {
      dir = await seed([{ source: group(), records: [] }, { source: member(), records: [authoredRecord()] }]);

      await expect(
        runPromote({
          sourcesDir: dir,
          sourceId: MEMBER_ID,
          group: 'PB-G999',
          resolveArk: resolvesLive,
          existingMembers: [] as ExistingMemberRecord[],
          verifiedAt: '2026-07-10T12:00:00.000Z',
        }),
      ).rejects.toThrow(/PB-G999/);
    });

    it('acquire names the selected sourceArchive when the copy is not public-domain', async () => {
      dir = await seed([
        {
          source: member({ status: 'approved-for-acquisition' }),
          records: [
            authoredRecord({
              sourceArchive: 'State Library of Queensland',
              rights: { ...publicDomainRights(ARK), status: 'other' },
            }),
          ],
        },
      ]);
      const fetch: FetchSourceFn = vi.fn(async () => undefined);

      await expect(
        runAcquire({ sourcesDir: dir, sourceId: MEMBER_ID, fetch }),
      ).rejects.toThrow(/State Library of Queensland/);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
