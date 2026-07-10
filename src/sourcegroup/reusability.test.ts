import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInventory } from '@/sourcegroup/inventory';
import type { ArkMetadata, ArkResolver as InventoryArkResolver } from '@/sourcegroup/inventory';
import { runVerifyMember } from '@/sourcegroup/verify-member-command';
import { runPromote } from '@/sourcegroup/promote';
import { loadAllSources, loadSourceFile } from '@/bibliography/load';
import type { ArkResolver, ExistingMemberRecord } from '@/sourcegroup/verify-member';

/**
 * T038 (SC-003/FR-023, reusability check): proves `inventory` / `verify-member`
 * / `promote` operate UNCHANGED on a second, different source-group -- not
 * special-cased to PB-P004 -- by driving the full pipeline end-to-end against
 * a synthetic group whose content mirrors
 * `src/sourcegroup/__fixtures__/PB-S901.yml` (sourceId `PB-S901`, per that
 * fixture's own README: "used to test pipeline reusability and ensure the
 * implementation is not special-cased to PB-P004").
 *
 * Per `@/model/source`'s own doc comment ("Colony Cults ID, e.g. `PB-P001`.
 * Primary key.") and the spec's Key Entities section ("Flat opaque `sourceId`
 * (`PB-P###`)"), the `PB-` prefix is a deliberate, repo-wide flat-namespace
 * convention for the ENTIRE bibliography SSOT -- it is not special-casing
 * PB-P004. Reusability is satisfied for ANY PB-namespace-conforming
 * source-group: the primary proof below drives the SAME second-group content
 * (case/language/creator/title/notes, mirroring the shipped
 * `__fixtures__/PB-S901.yml`) under a distinct group id (`PB-S900`, chosen so
 * it does not collide with the shipped fixture's `PB-S901`), and a further
 * describe block below loads the shipped `PB-S901.yml` fixture itself through
 * the real `loadSourceFile` / `loadAllSources` to prove the shipped artifact
 * -- not just an inline stand-in -- is a valid, loadable, distinct
 * source-group.
 */

const ARK = 'ark:/99999/reuse-test-0001';
const GROUP_ID = 'PB-S900';
const VERIFIED_AT = '2026-07-10T12:00:00.000Z';

/** Seed a temp repo root with a `bibliography/sources/` dir containing `files`. */
async function seedRepo(files: Record<string, string>): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), 'reusability-'));
  const sourcesDir = join(baseDir, 'bibliography', 'sources');
  await mkdir(sourcesDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(sourcesDir, name), contents, 'utf8');
  }
  return baseDir;
}

/**
 * The SECOND, DIFFERENT source-group -- content mirrors the shipped
 * `__fixtures__/PB-S901.yml` (case: test-case / language: English /
 * creator: test-author / synthetic-fixture notes) exactly, except for the
 * id: `PB-S900` here, so this inline stand-in does not collide with the
 * shipped `PB-S901` fixture loaded directly in the describe block below.
 * Deliberately NOT `port-breton` / not French / not the Marquis de Rays
 * corpus -- a wholly distinct case from PB-P004.
 */
const SECOND_GROUP_YML = [
  `sourceId: ${GROUP_ID}`,
  'kind: source-group',
  'case: test-case',
  'language: English',
  'creator: test-author',
  'titles:',
  '  - text: Test Source Group Collection',
  '    role: canonical',
  'notes: "SYNTHETIC TEST FIXTURE - mirrors __fixtures__/PB-S901.yml, an inline stand-in under a distinct id. Used to prove pipeline reusability (SC-003/FR-023)."',
  '',
].join('\n');

function secondGroupArkMetadata(overrides: Partial<ArkMetadata> = {}): ArkMetadata {
  return {
    titles: [{ text: 'A Synthetic Test Document', role: 'canonical' }],
    creator: 'test-author',
    identifiers: [],
    rightsRaw: 'Public domain',
    originalUrl: 'https://example-archive.test/ark:/99999/reuse-test-0001',
    rawResponse: '<record><title>A Synthetic Test Document</title></record>',
    endpoint: 'https://example-archive.test/services/OAIRecord',
    retrievedAt: '2026-07-10T00:00:00.000Z',
    normalizationVersion: 1,
    archive: 'Example Test Archive',
    ...overrides,
  };
}

function inventoryResolverFor(metadata: ArkMetadata | null): InventoryArkResolver {
  return async () => metadata;
}

/** Every ark resolves live -- used by both verify-member and promote's rerun. */
const resolvesLive: ArkResolver = async (ark) => ({ ark });

describe('reusability (T038, SC-003/FR-023): inventory -> verify-member -> promote on a SECOND, DIFFERENT source-group', () => {
  let baseDir: string;

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('runs the unmodified pipeline end-to-end against a non-PB-P004 group, with injected I/O and no live network', async () => {
    baseDir = await seedRepo({ [`${GROUP_ID}.yml`]: SECOND_GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    // --- Step 1: inventory -- a member is created under the SECOND group. ---
    const inventoryResult = await runInventory({
      ark: ARK,
      groupId: GROUP_ID,
      sourcesDir,
      baseDir,
      resolveArk: inventoryResolverFor(secondGroupArkMetadata()),
    });

    expect(inventoryResult.source.partOf).toBe(GROUP_ID);
    expect(inventoryResult.source.status).toBe('discovered');
    expect(inventoryResult.source.kind).toBe('monograph');
    expect(inventoryResult.record.status).toBe('wanted');
    expect(inventoryResult.record.rights?.status).toBe('public-domain');
    expect(inventoryResult.acquirable).toBe(true);

    const memberId = inventoryResult.sourceId;

    // --- Step 2: verify-member -- a passing verdict, same code path as PB-P004. ---
    const verifyResult = await runVerifyMember({
      id: memberId,
      sourcesDir,
      loadMembers: (dir) => loadAllSources(dir),
      resolveArk: resolvesLive,
    });

    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.verdict?.result).toBe('passed');
    expect(verifyResult.verdict?.checks).toEqual({
      identifierResolved: 'passed',
      rights: 'passed',
      requiredMetadata: 'passed',
      hardDuplicate: 'passed',
      possibleDuplicate: 'passed',
    });

    // verify-member is READ-ONLY -- confirm it changed nothing on disk before promoting.
    const preVerified = loadSourceFile(join(sourcesDir, `${memberId}.yml`));
    expect(preVerified.source.status).toBe('discovered');
    expect(preVerified.records[0].status).toBe('wanted');

    // --- Step 3: promote -- discovered -> approved-for-acquisition, wanted -> to-collect. ---
    const existingMembers: ExistingMemberRecord[] = [];
    const promoteResult = await runPromote({
      sourcesDir,
      sourceId: memberId,
      resolveArk: resolvesLive,
      existingMembers,
      verifiedAt: VERIFIED_AT,
    });

    expect(promoteResult.status).toBe('approved-for-acquisition');
    expect(promoteResult.recordStatus).toBe('to-collect');
    expect(promoteResult.verdict.result).toBe('passed');

    // --- Final on-disk state: assert the full lifecycle advanced correctly, ---
    // --- membership (partOf) was never altered, and the verdict was recorded. ---
    const finalState = loadSourceFile(join(sourcesDir, `${memberId}.yml`));
    expect(finalState.source.partOf).toBe(GROUP_ID);
    expect(finalState.source.status).toBe('approved-for-acquisition');
    expect(finalState.records).toHaveLength(1);
    expect(finalState.records[0].status).toBe('to-collect');
    expect(finalState.records[0].verification).toEqual({
      result: 'passed',
      verifiedAt: VERIFIED_AT,
      checks: {
        identifierResolved: 'passed',
        rights: 'passed',
        requiredMetadata: 'passed',
        hardDuplicate: 'passed',
        possibleDuplicate: 'passed',
      },
      snapshotRef: finalState.records[0].metadataSnapshot?.path,
    });

    // Sanity: the group id used here is genuinely NOT PB-P004 -- proving the
    // SAME code path (no PB-P004-specific branch) produced a correct result
    // for a wholly different source-group.
    expect(GROUP_ID).not.toBe('PB-P004');
    expect(memberId).not.toMatch(/^PB-P004$/);
  });

  it('a --group assertion against the SAME second group succeeds identically to PB-P004\'s pipeline', async () => {
    baseDir = await seedRepo({ [`${GROUP_ID}.yml`]: SECOND_GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    const inventoryResult = await runInventory({
      ark: ARK,
      groupId: GROUP_ID,
      sourcesDir,
      baseDir,
      resolveArk: inventoryResolverFor(secondGroupArkMetadata()),
    });

    const promoteResult = await runPromote({
      sourcesDir,
      sourceId: inventoryResult.sourceId,
      group: GROUP_ID,
      resolveArk: resolvesLive,
      existingMembers: [],
      verifiedAt: VERIFIED_AT,
    });

    expect(promoteResult.status).toBe('approved-for-acquisition');
  });
});

/**
 * Explicit grep-style check for any hardcoded `"PB-P004"` LITERAL in the
 * production (non-test) source-group pipeline modules. Finding one here would
 * directly violate SC-003/FR-023 (special-casing the pipeline to the v1
 * validation group) and must be REPORTED, not silently fixed.
 *
 * As of this writing the ONLY repo-wide occurrence of the literal string
 * `PB-P004` outside `__fixtures__/PB-P004.yml`, tests, and
 * `bibliography/sources/PB-P004.yml` itself is a DOC COMMENT in
 * `@/bibliography/migrate.ts` ("Convert a PB-P004-shaped monograph Source to
 * a source-group") describing `migrateSourceToGroup`'s original motivating
 * example -- that function is a generic, one-time migration helper operating
 * on any `Source`, has no runtime branch on the literal id, and is outside
 * the `inventory` / `verify-member` / `promote` pipeline this task targets.
 */
describe('production code has no PB-P004 literal special-casing (T038 grep check)', () => {
  const pipelineFiles = [
    'inventory.ts',
    'verify-member.ts',
    'verify-member-command.ts',
    'promote.ts',
    'id-alloc.ts',
    'record-select.ts',
    'ark-resolver.ts',
    'snapshot.ts',
    'acquire.ts',
    'exclude-member.ts',
    'index.ts',
  ];

  it('none of the pipeline modules contain the literal "PB-P004"', async () => {
    const dir = join(process.cwd(), 'src', 'sourcegroup');
    const offenders: string[] = [];
    for (const file of pipelineFiles) {
      const contents = await readFile(join(dir, file), 'utf8');
      if (contents.includes('PB-P004')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no NON-test file directly under src/sourcegroup/ contains the literal "PB-P004"', async () => {
    const dir = join(process.cwd(), 'src', 'sourcegroup');
    const entries = await readdir(dir, { withFileTypes: true });
    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        continue;
      }
      const contents = await readFile(join(dir, entry.name), 'utf8');
      if (contents.includes('PB-P004')) {
        offenders.push(entry.name);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Positive proof (not just an inline stand-in) that the SHIPPED second
 * source-group fixture, `__fixtures__/PB-S901.yml`, is itself a valid,
 * loadable artifact: it LOADS through the real `loadSourceFile` /
 * `loadAllSources` -- no relaxed pattern, no special-casing -- and is a
 * distinct `kind: source-group` from `PB-P004.yml`, which ships alongside it
 * in the same fixtures directory. Reusability (SC-003/FR-023) holds for any
 * PB-namespace-conforming source-group; this fixture is the concrete evidence
 * that the pipeline's "second source-group" test data is not merely
 * asserted-in-comments but is itself a conforming artifact under the shipped
 * loader.
 */
describe('shipped second-group fixture (__fixtures__/PB-S901.yml) loads via the real loader', () => {
  const fixturesDir = join(process.cwd(), 'src', 'sourcegroup', '__fixtures__');

  it('loadSourceFile loads PB-S901.yml directly as a valid source-group, distinct from PB-P004', () => {
    const loaded = loadSourceFile(join(fixturesDir, 'PB-S901.yml'));

    expect(loaded.source.sourceId).toBe('PB-S901');
    expect(loaded.source.kind).toBe('source-group');
    expect(loaded.source.sourceId).not.toBe('PB-P004');
  });

  it('loadAllSources scans the fixtures dir and includes both PB-P004 and PB-S901 as distinct source-groups', () => {
    const loaded = loadAllSources(fixturesDir);
    const ids = loaded.map((l) => l.source.sourceId);

    expect(ids).toContain('PB-P004');
    expect(ids).toContain('PB-S901');

    const secondGroup = loaded.find((l) => l.source.sourceId === 'PB-S901');
    expect(secondGroup?.source.kind).toBe('source-group');
    expect(secondGroup?.source.sourceId).not.toBe(
      loaded.find((l) => l.source.sourceId === 'PB-P004')?.source.sourceId,
    );
  });
});
