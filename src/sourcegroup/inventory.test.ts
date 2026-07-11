import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInventory } from '@/sourcegroup/inventory';
import type { ArkMetadata, ArkResolver } from '@/sourcegroup/inventory';
import { loadSourceFile } from '@/bibliography/load';

/**
 * Tests for `runInventory` (T018, US1, FR-001-005): the MVP entry point that
 * turns a discovered ark into a source-group member Source + RepositoryRecord
 * (`status: wanted`) + an immutable metadata snapshot. All I/O is injected
 * (a temp `sourcesDir`/`baseDir` pair and a fake `resolveArk`) so nothing here
 * touches the network or the real `bibliography/` tree.
 */

/** Seed a temp repo root with a `bibliography/sources/` dir containing `files`. */
async function seedRepo(files: Record<string, string>): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), 'inventory-'));
  const sourcesDir = join(baseDir, 'bibliography', 'sources');
  await mkdir(sourcesDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(sourcesDir, name), contents, 'utf8');
  }
  return baseDir;
}

const GROUP_YML = [
  'sourceId: PB-S001',
  'kind: source-group',
  'titles:',
  '  - text: Port-Breton',
  '    role: canonical',
].join('\n');

const NOT_A_GROUP_YML = [
  'sourceId: PB-001',
  'kind: monograph',
  'titles:',
  '  - text: Some Monograph',
  '    role: canonical',
].join('\n');

function publicDomainMetadata(overrides: Partial<ArkMetadata> = {}): ArkMetadata {
  return {
    titles: [{ text: 'Le Petit Journal', role: 'canonical' }],
    creator: 'Jane Doe',
    identifiers: [],
    rightsRaw: 'Public domain',
    originalUrl: 'https://gallica.bnf.fr/ark:/12148/bpt6k1234567',
    rawResponse: '<record><title>Le Petit Journal</title></record>',
    endpoint: 'https://gallica.bnf.fr/services/OAIRecord',
    retrievedAt: '2026-07-10T00:00:00.000Z',
    normalizationVersion: 1,
    archive: 'Gallica / BnF',
    language: 'French',
    ...overrides,
  };
}

function resolverFor(metadata: ArkMetadata | null): ArkResolver {
  return async () => metadata;
}

describe('runInventory', () => {
  let baseDir: string;

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('happy path: creates a member Source + RepositoryRecord (wanted) + snapshot', async () => {
    baseDir = await seedRepo({ 'PB-S001.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const ark = 'ark:/12148/bpt6k1234567';

    const result = await runInventory({
      ark,
      groupId: 'PB-S001',
      sourcesDir,
      baseDir,
      resolveArk: resolverFor(publicDomainMetadata()),
    });

    expect(result.sourceId).toMatch(/^PB-P\d{3}$/);
    expect(result.source.sourceId).toBe(result.sourceId);
    expect(result.source.kind).toBe('monograph');
    expect(result.source.partOf).toBe('PB-S001');
    expect(result.source.status).toBe('discovered');
    expect(result.source.titles).toEqual([{ text: 'Le Petit Journal', role: 'canonical' }]);
    expect(result.source.creator).toBe('Jane Doe');
    expect(result.source.language).toBe('French');

    expect(result.record.sourceId).toBe(result.sourceId);
    expect(result.record.sourceArchive).toBe('Gallica / BnF');
    expect(result.record.status).toBe('wanted');
    expect(result.record.identifiers).toEqual([{ type: 'ark', value: ark }]);
    expect(result.record.rights?.status).toBe('public-domain');
    expect(result.record.rights?.raw).toBe('Public domain');
    expect(result.record.metadataSnapshot).toBeDefined();
    expect(result.acquirable).toBe(true);

    // Persisted to disk, loadable by the shipped loader.
    const onDiskPath = join(sourcesDir, `${result.sourceId}.yml`);
    const loaded = loadSourceFile(onDiskPath);
    expect(loaded.source.partOf).toBe('PB-S001');
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0].status).toBe('wanted');
    expect(loaded.records[0].metadataSnapshot?.path).toBe(result.record.metadataSnapshot?.path);

    // Snapshot written under bibliography/repository-responses/<id>/ and readable.
    const snapshotAbsPath = join(baseDir, result.record.metadataSnapshot?.path ?? '');
    const snapshotBody = JSON.parse(await readFile(snapshotAbsPath, 'utf8')) as { raw: string };
    expect(snapshotBody.raw).toBe('<record><title>Le Petit Journal</title></record>');
  });

  it('defaults kind to monograph and honors an explicit --kind periodical', async () => {
    baseDir = await seedRepo({ 'PB-S001.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    const result = await runInventory({
      ark: 'ark:/12148/bpt6k1234567',
      groupId: 'PB-S001',
      kind: 'periodical',
      sourcesDir,
      baseDir,
      resolveArk: resolverFor(publicDomainMetadata()),
    });

    expect(result.source.kind).toBe('periodical');
  });

  it('an explicit --archive overrides the resolver-supplied archive hint', async () => {
    baseDir = await seedRepo({ 'PB-S001.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    const result = await runInventory({
      ark: 'ark:/12148/bpt6k1234567',
      groupId: 'PB-S001',
      archive: 'State Library of Queensland',
      sourcesDir,
      baseDir,
      resolveArk: resolverFor(publicDomainMetadata()),
    });

    expect(result.record.sourceArchive).toBe('State Library of Queensland');
  });

  it('fails loud and creates nothing when --group does not resolve to any Source', async () => {
    baseDir = await seedRepo({});
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    await expect(
      runInventory({
        ark: 'ark:/12148/bpt6k1234567',
        groupId: 'PB-S999',
        sourcesDir,
        baseDir,
        resolveArk: resolverFor(publicDomainMetadata()),
      }),
    ).rejects.toThrow(/PB-S999/);

    expect(await readdir(sourcesDir)).toEqual([]);
  });

  it('fails loud and creates nothing when --group resolves to a Source that is not a source-group', async () => {
    baseDir = await seedRepo({ 'PB-001.yml': NOT_A_GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    await expect(
      runInventory({
        ark: 'ark:/12148/bpt6k1234567',
        groupId: 'PB-001',
        sourcesDir,
        baseDir,
        resolveArk: resolverFor(publicDomainMetadata()),
      }),
    ).rejects.toThrow(/not a source-group|kind "monograph"/i);

    // Nothing new was written -- only the seed file remains.
    expect(await readdir(sourcesDir)).toEqual(['PB-001.yml']);
  });

  it('fails loud and creates nothing when the ark cannot be resolved', async () => {
    baseDir = await seedRepo({ 'PB-S001.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    await expect(
      runInventory({
        ark: 'ark:/does/not/exist',
        groupId: 'PB-S001',
        sourcesDir,
        baseDir,
        resolveArk: resolverFor(null),
      }),
    ).rejects.toThrow(/ark/i);

    expect(await readdir(sourcesDir)).toEqual(['PB-S001.yml']);
  });

  it('non-public-domain: record is still created but flagged not-acquirable (rights.status other)', async () => {
    baseDir = await seedRepo({ 'PB-S001.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    const result = await runInventory({
      ark: 'ark:/12148/bpt6k7654321',
      groupId: 'PB-S001',
      sourcesDir,
      baseDir,
      resolveArk: resolverFor(
        publicDomainMetadata({ rightsRaw: 'Copyrighted -- access restricted' }),
      ),
    });

    expect(result.record.status).toBe('wanted');
    expect(result.record.rights?.status).toBe('other');
    expect(result.record.rights?.raw).toBe('Copyrighted -- access restricted');
    expect(result.acquirable).toBe(false);
  });

  it('re-inventory (running inventory again) appends a NEW distinct snapshot, leaving the first untouched', async () => {
    baseDir = await seedRepo({ 'PB-S001.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const ark = 'ark:/12148/bpt6k1234567';

    const first = await runInventory({
      ark,
      groupId: 'PB-S001',
      sourcesDir,
      baseDir,
      resolveArk: resolverFor(publicDomainMetadata()),
    });

    const second = await runInventory({
      ark,
      groupId: 'PB-S001',
      sourcesDir,
      baseDir,
      resolveArk: resolverFor(
        publicDomainMetadata({ retrievedAt: '2026-07-11T00:00:00.000Z' }),
      ),
    });

    expect(second.sourceId).not.toBe(first.sourceId);
    expect(second.record.metadataSnapshot?.path).not.toBe(first.record.metadataSnapshot?.path);

    const firstSnapshot = JSON.parse(
      await readFile(join(baseDir, first.record.metadataSnapshot?.path ?? ''), 'utf8'),
    ) as { raw: string };
    expect(firstSnapshot.raw).toBe('<record><title>Le Petit Journal</title></record>');
  });

  it('leaves source.language undefined (never fabricated) when the resolver supplies no language', async () => {
    baseDir = await seedRepo({ 'PB-S001.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    const result = await runInventory({
      ark: 'ark:/12148/bpt6k1234567',
      groupId: 'PB-S001',
      sourcesDir,
      baseDir,
      resolveArk: resolverFor(publicDomainMetadata({ language: undefined })),
    });

    expect(result.source.language).toBeUndefined();
  });

  it('fails loud when no --archive is given and the resolver supplies no archive hint', async () => {
    baseDir = await seedRepo({ 'PB-S001.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    await expect(
      runInventory({
        ark: 'ark:/12148/bpt6k1234567',
        groupId: 'PB-S001',
        sourcesDir,
        baseDir,
        resolveArk: resolverFor(publicDomainMetadata({ archive: undefined })),
      }),
    ).rejects.toThrow(/archive/i);

    expect(await readdir(sourcesDir)).toEqual(['PB-S001.yml']);
  });
});
