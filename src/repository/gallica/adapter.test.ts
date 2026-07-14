import { describe, it, expect, vi } from 'vitest';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Rights } from '@/model/rights';
import type { ArkMetadata, ArkResolver } from '@/sourcegroup/inventory';
import type { FetchSourceFn } from '@/sourcegroup/acquire';
import type {
  RepositoryLocator,
  ResolutionContext,
  ResolvedRepositoryItem,
} from '@/repository/adapter';
import { GallicaAdapter, type GallicaAdapterDeps } from '@/repository/gallica/adapter';
import {
  GALLICA_ARCHIVE_NAME,
  GALLICA_NORMALIZATION_VERSION,
} from '@/sourcegroup/gallica-ark-resolver';

/**
 * Tests for `GallicaAdapter` (spec 011, T011): the `RepositoryAdapter` wrapping
 * the shipped Gallica fetcher + OAIRecord resolver. The `acquire` tests assert
 * the adapter drives the injected fetcher with the SAME `fetch-source`
 * `ParsedArgs` the T010 characterization suite pins for `runAcquire`, and
 * enforces the SAME record-level fail-loud gates -- injected fakes only,
 * nothing touches the network or B2.
 */

const ARK = 'ark:/12148/bpt6k1234567';
const GALLICA = GALLICA_ARCHIVE_NAME; // 'Gallica / BnF'

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

/** A Gallica RepositoryRecord: public-domain, carries an ARK copy identifier. */
function record(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'PB-P100',
    sourceArchive: GALLICA,
    status: 'to-collect',
    identifiers: [{ type: 'ark', value: ARK }],
    rights: publicDomainRights(ARK),
    ...overrides,
  };
}

/** A resolved Gallica OAIRecord metadata payload. */
function arkMetadata(overrides: Partial<ArkMetadata> = {}): ArkMetadata {
  return {
    titles: [{ text: 'Le Petit Journal', role: 'archive' }],
    creator: 'Anonyme',
    date: '1889',
    rawResponse: '<record><dc:date>1889</dc:date></record>',
    endpoint: 'https://gallica.bnf.fr/services/OAIRecord?ark=bpt6k1234567',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    normalizationVersion: GALLICA_NORMALIZATION_VERSION,
    archive: GALLICA,
    ...overrides,
  };
}

/** Build an adapter with injected fakes; overridable per test. */
function makeAdapter(overrides: Partial<GallicaAdapterDeps> = {}): {
  adapter: GallicaAdapter;
  fetch: FetchSourceFn;
  resolveArk: ArkResolver;
} {
  const fetch: FetchSourceFn = vi.fn(async () => undefined);
  const resolveArk: ArkResolver = vi.fn(async () => arkMetadata());
  const deps: GallicaAdapterDeps = {
    fetch,
    resolveArk,
    now: () => '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
  return { adapter: new GallicaAdapter(deps), fetch: deps.fetch, resolveArk: deps.resolveArk };
}

describe('GallicaAdapter', () => {
  describe('acquire', () => {
    it('drives the injected fetcher exactly once with the exact fetch-source ParsedArgs (matches the T010 pin)', async () => {
      const { adapter, fetch } = makeAdapter();

      const result = await adapter.acquire(record(), {});

      // Fetcher called exactly once with the EXACT ParsedArgs shape the
      // characterization suite pins for `runAcquire`.
      expect(fetch).toHaveBeenCalledTimes(1);
      const [args] = vi.mocked(fetch).mock.calls[0];
      expect(args).toEqual({
        command: 'fetch-source',
        positional: [ARK],
        flags: {
          dryRun: false,
          force: false,
          verify: false,
          ocr: false,
          objectStore: false,
          reconcileRemote: false,
          checkpoint: false,
        },
        options: {
          sourceId: 'PB-P100',
          checkpointEvery: undefined,
        },
      });

      // Typed AcquisitionResult: identity + honest reconcile-deferred shape.
      expect(result.repositoryRecordId).toBe(`PB-P100 @ ${GALLICA}`);
      expect(result.assets).toEqual([]);
      expect(result.metadataSnapshot.raw).toBe('<record/>');
      expect(result.metadataSnapshot.retrievedAt).toBe('2026-07-14T00:00:00.000Z');
      expect(result.complete).toBe(false);
      expect(result.reconciliationRequired).toBe(true);
    });

    it('prefers the record retrievedAt for the metadata snapshot when present', async () => {
      const { adapter } = makeAdapter();

      const result = await adapter.acquire(
        record({ retrievedAt: '2025-05-05T12:00:00.000Z' }),
        {},
      );

      expect(result.metadataSnapshot.retrievedAt).toBe('2025-05-05T12:00:00.000Z');
    });

    it('forwards --object-store to the fetcher flags.objectStore', async () => {
      const { adapter, fetch } = makeAdapter();

      await adapter.acquire(record(), { objectStore: true });

      const [args] = vi.mocked(fetch).mock.calls[0];
      expect(args.flags.objectStore).toBe(true);
    });

    it('forwards --checkpoint / --checkpoint-every to the fetcher', async () => {
      const { adapter, fetch } = makeAdapter();

      await adapter.acquire(record(), { checkpoint: true, checkpointEvery: 25 });

      const [args] = vi.mocked(fetch).mock.calls[0];
      expect(args.flags.checkpoint).toBe(true);
      expect(args.options.checkpointEvery).toBe(25);
    });

    it('forwards --dry-run without defaulting it true', async () => {
      const { adapter, fetch } = makeAdapter();

      await adapter.acquire(record(), { dryRun: true });

      const [args] = vi.mocked(fetch).mock.calls[0];
      expect(args.flags.dryRun).toBe(true);
    });

    it('defaults objectStore/checkpoint false and checkpointEvery undefined with no ctx flags', async () => {
      const { adapter, fetch } = makeAdapter();

      await adapter.acquire(record(), {});

      const [args] = vi.mocked(fetch).mock.calls[0];
      expect(args.flags.objectStore).toBe(false);
      expect(args.flags.checkpoint).toBe(false);
      expect(args.options.checkpointEvery).toBeUndefined();
    });

    it('fails loud on a non-public-domain record (no fetch)', async () => {
      const { adapter, fetch } = makeAdapter();

      await expect(
        adapter.acquire(record({ rights: otherRights(ARK) }), {}),
      ).rejects.toThrow(/public-domain/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fails loud on a record with no rights determination at all (same public-domain gate, no fetch)', async () => {
      const { adapter, fetch } = makeAdapter();

      await expect(
        adapter.acquire(record({ rights: undefined }), {}),
      ).rejects.toThrow(/public-domain/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fails loud on a public-domain record carrying no ark identifier ("nothing to fetch", no fetch)', async () => {
      const { adapter, fetch } = makeAdapter();

      await expect(
        adapter.acquire(record({ identifiers: [] }), {}),
      ).rejects.toThrow(/nothing to fetch/i);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('construction', () => {
    it('fails loud without an injected fetcher', () => {
      const deps: GallicaAdapterDeps = {
        fetch: vi.fn(async () => undefined),
        resolveArk: vi.fn(async () => arkMetadata()),
      };
      Reflect.deleteProperty(deps, 'fetch');

      expect(() => new GallicaAdapter(deps)).toThrow(/fetch/i);
    });

    it('fails loud without an injected ark resolver', () => {
      const deps: GallicaAdapterDeps = {
        fetch: vi.fn(async () => undefined),
        resolveArk: vi.fn(async () => arkMetadata()),
      };
      Reflect.deleteProperty(deps, 'resolveArk');

      expect(() => new GallicaAdapter(deps)).toThrow(/resolveArk/i);
    });
  });

  describe('resolve', () => {
    const locator: RepositoryLocator = { repository: 'gallica', value: ARK };
    const ctx: ResolutionContext = {};

    it('resolves an ark to identifiers + canonical sourceUrl + grounded metadata', async () => {
      const { adapter, resolveArk } = makeAdapter();

      const item: ResolvedRepositoryItem = await adapter.resolve(locator, ctx);

      expect(resolveArk).toHaveBeenCalledWith(ARK);
      expect(item.repository).toBe('gallica');
      expect(item.identifiers).toEqual([{ type: 'ark', value: ARK }]);
      expect(item.sourceUrl).toBe('https://gallica.bnf.fr/ark:/12148/bpt6k1234567');
      expect(item.assetLocators).toEqual([]);
      // Grounded date: real value + verbatim excerpt from the OAIRecord response.
      expect(item.metadata.date.value).toBe('1889');
      expect(item.metadata.date.evidence.excerpt).toBe('1889');
      expect(item.metadata.creator?.value).toBe('Anonyme');
    });

    it('fails loud (INV-A: no invented identifier) when the ark resolves to nothing', async () => {
      const resolveArk: ArkResolver = vi.fn(async () => null);
      const { adapter } = makeAdapter({ resolveArk });

      await expect(adapter.resolve(locator, ctx)).rejects.toThrow(/no OAIRecord/i);
    });

    it('fails loud rather than fabricating a required grounded date when dc:date is absent', async () => {
      const resolveArk: ArkResolver = vi.fn(async () => arkMetadata({ date: undefined }));
      const { adapter } = makeAdapter({ resolveArk });

      await expect(adapter.resolve(locator, ctx)).rejects.toThrow(/no dc:date/i);
    });

    it('fails loud on an empty locator value', async () => {
      const { adapter } = makeAdapter();

      await expect(
        adapter.resolve({ repository: 'gallica', value: '  ' }, ctx),
      ).rejects.toThrow(/ark.*required/i);
    });
  });

  describe('collectRightsEvidence', () => {
    it('proposes the grounded date as evidence (never authors a judgment)', async () => {
      const { adapter } = makeAdapter();
      const item = await adapter.resolve({ repository: 'gallica', value: ARK }, {});

      const evidence = await adapter.collectRightsEvidence(item);

      expect(evidence.date?.value).toBe('1889');
    });
  });
});
