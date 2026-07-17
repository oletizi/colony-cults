import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMuseumInventory } from '@/sourcegroup/museum-inventory';
import type { RepositoryRegistry } from '@/sourcegroup/museum-inventory';
import { loadSourceFile } from '@/bibliography/load';
import type {
  RepositoryAdapter,
  RepositoryLocator,
  ResolutionContext,
  ResolvedRepositoryItem,
  AcquisitionContext,
  AcquisitionResult,
  RightsEvidence,
} from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import type { GroundedExtraction, MuseumItemFields } from '@/extraction/structured-extractor';

/**
 * Tests for `runMuseumInventory` (T017, specs/011-museum-acquisition-path,
 * US1): the `--repository`-routed sibling of `runInventory` for a RAW
 * repository locator (never an ark). All I/O is injected (a temp
 * `sourcesDir`/`baseDir` pair and a fake `RepositoryRegistry`/
 * `RepositoryAdapter`) so nothing here touches the network, the engine, or
 * the real `bibliography/` tree.
 */

/** Seed a temp repo root with a `bibliography/sources/` dir containing `files`. */
async function seedRepo(files: Record<string, string>): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), 'museum-inventory-'));
  const sourcesDir = join(baseDir, 'bibliography', 'sources');
  await mkdir(sourcesDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(sourcesDir, name), contents, 'utf8');
  }
  return baseDir;
}

const GROUP_YML = [
  'sourceId: PB-S006',
  'kind: source-group',
  'titles:',
  '  - text: Museum leads',
  '    role: canonical',
].join('\n');

const NOT_A_GROUP_YML = [
  'sourceId: PB-001',
  'kind: monograph',
  'titles:',
  '  - text: Some Monograph',
  '    role: canonical',
].join('\n');

const PAGE_URL = 'https://newitaly.org.au/CAT/000844.htm';

function groundedExtraction(
  overrides: Partial<GroundedExtraction<MuseumItemFields>> = {},
): GroundedExtraction<MuseumItemFields> {
  const provenance = {
    modelAssisted: true as const,
    engine: 'fake-engine',
    model: 'fake-model',
    promptVersion: 'fake-v1',
    at: '2026-07-14T00:00:00.000Z',
  };
  return {
    date: {
      value: '1890',
      evidence: { excerpt: 'Pioneers Group Photo 1890' },
      interpretation: "the photograph's creation year",
      provenance,
    },
    description: {
      value: 'Pioneers Group Photo 1890',
      evidence: { excerpt: 'Pioneers Group Photo 1890' },
      interpretation: 'a short caption of the item',
      provenance,
    },
    ...overrides,
  };
}

function resolvedItem(overrides: Partial<ResolvedRepositoryItem> = {}): ResolvedRepositoryItem {
  return {
    repository: 'new-italy-museum',
    identifiers: [{ type: 'accession', value: 'NIMI-0844' }],
    sourceUrl: PAGE_URL,
    // The deterministic DOM-direct title (mirrors `parseMusarchItem`'s
    // `#objectdesc`), distinct from the optional LLM-grounded
    // `metadata.description` set below.
    title: 'Pioneers Group Photo 1890',
    assetLocators: [{ url: `${PAGE_URL.replace('.htm', '')}-master.jpg`, role: 'primary' }],
    metadata: groundedExtraction(),
    ...overrides,
  };
}

/** A fake `RepositoryAdapter` whose `resolve` returns a canned item (or throws). */
function fakeAdapter(opts: {
  item?: ResolvedRepositoryItem;
  resolveError?: Error;
}): { adapter: RepositoryAdapter; locators: RepositoryLocator[] } {
  const locators: RepositoryLocator[] = [];
  const adapter: RepositoryAdapter = {
    repository: 'new-italy-museum',
    async resolve(locator: RepositoryLocator, _ctx: ResolutionContext): Promise<ResolvedRepositoryItem> {
      locators.push(locator);
      if (opts.resolveError !== undefined) {
        throw opts.resolveError;
      }
      if (opts.item === undefined) {
        throw new Error('fakeAdapter.resolve: no canned item');
      }
      return opts.item;
    },
    async collectRightsEvidence(_item: ResolvedRepositoryItem): Promise<RightsEvidence> {
      throw new Error('fakeAdapter.collectRightsEvidence: not used by runMuseumInventory');
    },
    async acquire(_record: RepositoryRecord, _ctx: AcquisitionContext): Promise<AcquisitionResult> {
      throw new Error('fakeAdapter.acquire: not used by runMuseumInventory');
    },
  };
  return { adapter, locators };
}

/** A fake `RepositoryRegistry` (structurally satisfies `@/repository/registry`'s real one). */
function fakeRegistry(adapter: RepositoryAdapter | undefined): RepositoryRegistry {
  return {
    selectByName(name) {
      if (adapter === undefined || adapter.repository !== name) {
        throw new Error(`RepositoryAdapterRegistry: no adapter registered for repository "${name}"`);
      }
      return adapter;
    },
  };
}

describe('runMuseumInventory', () => {
  let baseDir: string;

  afterEach(async () => {
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it('happy path: creates an archival-item member + RepositoryRecord (wanted) + snapshot', async () => {
    baseDir = await seedRepo({ 'PB-S006.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const { adapter, locators } = fakeAdapter({ item: resolvedItem() });

    const result = await runMuseumInventory({
      locator: PAGE_URL,
      repository: 'new-italy-museum',
      groupId: 'PB-S006',
      sourcesDir,
      baseDir,
      registry: fakeRegistry(adapter),
    });

    expect(result.sourceId).toMatch(/^PB-P\d{3}$/);
    expect(result.source.sourceId).toBe(result.sourceId);
    expect(result.source.kind).toBe('archival-item');
    expect(result.source.partOf).toBe('PB-S006');
    expect(result.source.status).toBe('discovered');
    expect(result.source.titles).toEqual([
      { text: 'Pioneers Group Photo 1890', role: 'archive' },
    ]);

    expect(result.record.sourceId).toBe(result.sourceId);
    expect(result.record.sourceArchive).toBe('New Italy Museum');
    expect(result.record.status).toBe('wanted');
    expect(result.record.identifiers).toEqual([{ type: 'accession', value: 'NIMI-0844' }]);
    expect(result.record.sourceUrl).toBe(PAGE_URL);
    // No rights judgment is made by inventory (rights-assess is a later step).
    expect(result.record.rights).toBeUndefined();
    expect(result.record.metadataSnapshot).toBeDefined();

    // The adapter was dispatched with the raw locator, not sniffed/parsed.
    expect(locators).toEqual([{ repository: 'new-italy-museum', value: PAGE_URL }]);

    // Persisted to disk, loadable by the shipped loader.
    const onDiskPath = join(sourcesDir, `${result.sourceId}.yml`);
    const loaded = loadSourceFile(onDiskPath);
    expect(loaded.source.kind).toBe('archival-item');
    expect(loaded.source.partOf).toBe('PB-S006');
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0].status).toBe('wanted');
    expect(loaded.records[0].sourceUrl).toBe(PAGE_URL);
    expect(loaded.records[0].identifiers).toEqual([{ type: 'accession', value: 'NIMI-0844' }]);

    // Snapshot written and readable, carrying the resolved item's metadata.
    const snapshotAbsPath = join(baseDir, result.record.metadataSnapshot?.path ?? '');
    const snapshotBody = JSON.parse(await readFile(snapshotAbsPath, 'utf8')) as { raw: string };
    expect(JSON.parse(snapshotBody.raw)).toEqual(resolvedItem().metadata);
  });

  it('an explicit --archive overrides the fixed per-repository display name', async () => {
    baseDir = await seedRepo({ 'PB-S006.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const { adapter } = fakeAdapter({ item: resolvedItem() });

    const result = await runMuseumInventory({
      locator: PAGE_URL,
      repository: 'new-italy-museum',
      groupId: 'PB-S006',
      archive: 'New Italy Museum, Lismore',
      sourcesDir,
      baseDir,
      registry: fakeRegistry(adapter),
    });

    expect(result.record.sourceArchive).toBe('New Italy Museum, Lismore');
  });

  it('carries the grounded creator through to the member Source when present', async () => {
    baseDir = await seedRepo({ 'PB-S006.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const provenance = {
      modelAssisted: true as const,
      engine: 'fake-engine',
      model: 'fake-model',
      promptVersion: 'fake-v1',
      at: '2026-07-14T00:00:00.000Z',
    };
    const { adapter } = fakeAdapter({
      item: resolvedItem({
        metadata: groundedExtraction({
          creator: {
            value: 'Jane Doe',
            evidence: { excerpt: 'Photograph by Jane Doe' },
            interpretation: 'the photographer',
            provenance,
          },
        }),
      }),
    });

    const result = await runMuseumInventory({
      locator: PAGE_URL,
      repository: 'new-italy-museum',
      groupId: 'PB-S006',
      sourcesDir,
      baseDir,
      registry: fakeRegistry(adapter),
    });

    expect(result.source.creator).toBe('Jane Doe');
  });

  it('fails loud and creates nothing when --group does not resolve to any Source', async () => {
    baseDir = await seedRepo({});
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const { adapter, locators } = fakeAdapter({ item: resolvedItem() });

    await expect(
      runMuseumInventory({
        locator: PAGE_URL,
        repository: 'new-italy-museum',
        groupId: 'PB-S999',
        sourcesDir,
        baseDir,
        registry: fakeRegistry(adapter),
      }),
    ).rejects.toThrow(/PB-S999/);

    expect(await readdir(sourcesDir)).toEqual([]);
    // The group is validated BEFORE the adapter is ever dispatched.
    expect(locators).toEqual([]);
  });

  it('fails loud and creates nothing when --group resolves to a Source that is not a source-group', async () => {
    baseDir = await seedRepo({ 'PB-001.yml': NOT_A_GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const { adapter } = fakeAdapter({ item: resolvedItem() });

    await expect(
      runMuseumInventory({
        locator: PAGE_URL,
        repository: 'new-italy-museum',
        groupId: 'PB-001',
        sourcesDir,
        baseDir,
        registry: fakeRegistry(adapter),
      }),
    ).rejects.toThrow(/not a source-group|kind "monograph"/i);

    expect(await readdir(sourcesDir)).toEqual(['PB-001.yml']);
  });

  it('fails loud on an unknown/unregistered --repository (registry throws)', async () => {
    baseDir = await seedRepo({ 'PB-S006.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');

    await expect(
      runMuseumInventory({
        locator: PAGE_URL,
        repository: 'new-italy-museum',
        groupId: 'PB-S006',
        sourcesDir,
        baseDir,
        // No adapter registered at all -- selectByName must throw.
        registry: fakeRegistry(undefined),
      }),
    ).rejects.toThrow(/no adapter registered for repository "new-italy-museum"/);

    expect(await readdir(sourcesDir)).toEqual(['PB-S006.yml']);
  });

  it('fails loud and creates nothing when the locator is unverifiable (adapter.resolve throws, e.g. missing accession)', async () => {
    baseDir = await seedRepo({ 'PB-S006.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const { adapter } = fakeAdapter({
      resolveError: new Error('NewItalyMuseumAdapter.resolve: missing #objectaccession'),
    });

    await expect(
      runMuseumInventory({
        locator: PAGE_URL,
        repository: 'new-italy-museum',
        groupId: 'PB-S006',
        sourcesDir,
        baseDir,
        registry: fakeRegistry(adapter),
      }),
    ).rejects.toThrow(/objectaccession/);

    expect(await readdir(sourcesDir)).toEqual(['PB-S006.yml']);
  });

  it('fails loud and creates nothing when the resolved item carries an empty deterministic title', async () => {
    baseDir = await seedRepo({ 'PB-S006.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const { adapter } = fakeAdapter({
      item: resolvedItem({ title: '   ' }),
    });

    await expect(
      runMuseumInventory({
        locator: PAGE_URL,
        repository: 'new-italy-museum',
        groupId: 'PB-S006',
        sourcesDir,
        baseDir,
        registry: fakeRegistry(adapter),
      }),
    ).rejects.toThrow(/carries an empty deterministic title/);

    expect(await readdir(sourcesDir)).toEqual(['PB-S006.yml']);
  });

  it('inventories successfully from the deterministic title when the LLM extractor omits description entirely', async () => {
    baseDir = await seedRepo({ 'PB-S006.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    // The LLM-grounded `metadata.description` is absent (an extractor that
    // chose not to ground it), but the adapter's deterministic DOM-direct
    // `title` (e.g. Musarch's `#objectdesc`) is always present on a
    // successfully resolved item -- inventory must still succeed from it.
    const { adapter } = fakeAdapter({
      item: resolvedItem({ metadata: groundedExtraction({ description: undefined }) }),
    });

    const result = await runMuseumInventory({
      locator: PAGE_URL,
      repository: 'new-italy-museum',
      groupId: 'PB-S006',
      sourcesDir,
      baseDir,
      registry: fakeRegistry(adapter),
    });

    expect(result.source.titles).toEqual([
      { text: 'Pioneers Group Photo 1890', role: 'archive' },
    ]);
  });

  it('re-inventory (running inventory again) appends a NEW distinct snapshot, leaving the first untouched', async () => {
    baseDir = await seedRepo({ 'PB-S006.yml': GROUP_YML });
    const sourcesDir = join(baseDir, 'bibliography', 'sources');
    const { adapter: adapter1 } = fakeAdapter({ item: resolvedItem() });
    const { adapter: adapter2 } = fakeAdapter({
      item: resolvedItem({
        metadata: groundedExtraction({
          date: {
            value: '1890',
            evidence: { excerpt: 'Pioneers Group Photo 1890' },
            interpretation: "the photograph's creation year",
            provenance: {
              modelAssisted: true,
              engine: 'fake-engine',
              model: 'fake-model',
              promptVersion: 'fake-v1',
              at: '2026-07-14T01:00:00.000Z',
            },
          },
        }),
      }),
    });

    const first = await runMuseumInventory({
      locator: PAGE_URL,
      repository: 'new-italy-museum',
      groupId: 'PB-S006',
      sourcesDir,
      baseDir,
      registry: fakeRegistry(adapter1),
    });

    const second = await runMuseumInventory({
      locator: PAGE_URL,
      repository: 'new-italy-museum',
      groupId: 'PB-S006',
      sourcesDir,
      baseDir,
      registry: fakeRegistry(adapter2),
    });

    expect(second.sourceId).not.toBe(first.sourceId);
    expect(second.record.metadataSnapshot?.path).not.toBe(first.record.metadataSnapshot?.path);
  });
});
