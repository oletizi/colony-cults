import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Rights } from '@/model/rights';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import { serializeSource } from '@/bibliography/migrate-serialize';
import { loadAllSources } from '@/bibliography/load';
import { runAcquire, type FetchSourceFn } from '@/sourcegroup/acquire';
import { runReconcile, type GatherProvenanceFn } from '@/sourcegroup/reconcile';

/**
 * CHARACTERIZATION TESTS for the shipped Gallica acquisition path (spec 011,
 * SC-003 / FR-004). These PIN the CURRENT, pre-cutover observable behavior of
 * `runAcquire` (and the `runReconcile` handoff) so a later task can refactor
 * the Gallica path behind a `RepositoryAdapter` (`@/repository/adapter`) with
 * PROOF of no behavior change.
 *
 * These are DELIBERATELY duplicative of `src/sourcegroup/acquire.test.ts` and
 * `reconcile.test.ts`: the point of a characterization suite is to freeze the
 * invariants at the module boundary INDEPENDENTLY of the existing behavioral
 * tests, so the cutover can be validated even if those tests are rewritten. If
 * one of these assertions flips, the cutover changed observable behavior --
 * that is the signal this suite exists to raise.
 *
 * Dependency-injection style mirrors `acquire.test.ts`: the fetcher and the
 * provenance gatherer are INJECTED (fakes), the SSOT is an in-memory temp dir;
 * nothing here touches the network, B2, or a real archive on disk.
 */

const ARK = 'ark:/12148/bpt6k1234567';
const GALLICA = 'Gallica / BnF';

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

/** A Gallica member (monograph), approved-for-acquisition by default. */
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

/** A Gallica RepositoryRecord: public-domain, carries an ARK copy identifier. */
function authoredRecord(
  overrides: Partial<AuthoredRepositoryRecord> = {},
): AuthoredRepositoryRecord {
  return {
    sourceArchive: GALLICA,
    status: 'to-collect',
    identifiers: [{ type: 'ark', value: ARK }],
    rights: publicDomainRights(ARK),
    ...overrides,
  };
}

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
    source_archive: GALLICA,
    local_path: key,
    type: 'page-image',
    sha256: 'a'.repeat(64),
    object_store: objectStore(key),
    format: 'image/jpeg',
    original_url: 'https://gallica.bnf.fr/iiif/x/f1/full/full/0/native.jpg',
    ...overrides,
  };
}

/**
 * Gallica completion-tail machinery (spec 016): a `reconcileArchiveRoot` + a
 * `gather` returning valid page-image provenance, so a non-dry-run Gallica
 * acquire's inseparable completion tail can advance status. A non-dry-run
 * Gallica acquire now PREFLIGHTS these before dispatch (AUDIT-20260719-06), so
 * a characterization of the fetch path must inject them just as it injects the
 * fetcher; the fetch-arg PINS below are unchanged by their presence.
 */
function gallicaCompletion(): { reconcileArchiveRoot: string; gather: GatherProvenanceFn } {
  return { reconcileArchiveRoot: '/archive/root', gather: async () => [pageImage()] };
}

async function seedSourcesDir(
  entries: { source: Source; records: AuthoredRepositoryRecord[] }[],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gallica-char-'));
  for (const entry of entries) {
    await writeFile(
      join(dir, `${entry.source.sourceId}.yml`),
      serializeSource(entry),
      'utf-8',
    );
  }
  return dir;
}

describe('Gallica acquisition path — characterization (pre-cutover baseline)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // 1. ARK resolution: the fetcher is invoked EXACTLY ONCE with the full
  //    `fetch-source` ParsedArgs shape carrying the record's ARK.
  // ---------------------------------------------------------------------------
  it('PINS: a public-domain, approved, ark-bearing Gallica record drives the fetcher exactly once with the exact fetch-source ParsedArgs', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    const result = await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      fetch,
      ...gallicaCompletion(),
    });

    // Observable RESULT contract.
    expect(result).toEqual({
      sourceId: 'PB-P100',
      ark: ARK,
      sourceArchive: GALLICA,
    });

    // Fetcher called exactly once ...
    expect(fetch).toHaveBeenCalledTimes(1);
    // ... with the EXACT ParsedArgs shape (the whole invariant a cutover must
    // preserve: command, positional=[ark], and the full flags/options block).
    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args).toEqual({
      command: 'fetch-source',
      positional: [ARK],
      flags: {
        dryRun: false,
        force: false,
        verify: false,
        ocr: false,
        enhanceContrast: false,
        objectStore: false,
        reconcileRemote: false,
        checkpoint: false,
      },
      options: {
        sourceId: 'PB-P100',
        checkpointEvery: undefined,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Public-domain gate: a non-public-domain Gallica record is refused loud,
  //    nothing fetched.
  // ---------------------------------------------------------------------------
  it('PINS: a non-public-domain Gallica record is refused (fail loud on /public-domain/) with no fetch', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ rights: otherRights(ARK) })] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch, ...gallicaCompletion() }),
    ).rejects.toThrow(/public-domain/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('PINS: a Gallica record with NO rights determination is refused on the same public-domain gate with no fetch', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ rights: undefined })] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch, ...gallicaCompletion() }),
    ).rejects.toThrow(/public-domain/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 3. No-ark: a public-domain record with no ark identifier fails loud before
  //    any fetch. T019 moved dispatch to the registry, so this now fails at
  //    `selectForRecord` (registry-level) rather than the Gallica adapter's own
  //    no-ark gate -- see the assertion's comment.
  // ---------------------------------------------------------------------------
  it('PINS: a public-domain Gallica record carrying no dispatchable copy identifier fails loud at the registry with no fetch', async () => {
    dir = await seedSourcesDir([
      { source: member(), records: [authoredRecord({ identifiers: [] })] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
      // T019: dispatch moved to the registry; a no-identifier record now fails at selectForRecord (registry-level) rather than the adapter's no-ark gate -- deliberate cutover consequence, still fail-loud, SC-003 observable acquisition behavior for VALID records unchanged.
    ).rejects.toThrow(/no supported copy identifier/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 4. Source-group guardrail: acquiring a `source-group` kind is refused
  //    BEFORE any fetch (the container is never fetchable).
  // ---------------------------------------------------------------------------
  it('PINS: acquiring a source-group (kind: source-group) is refused before any fetch', async () => {
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
    ).rejects.toThrow(/source-group|work-bundle|approved-for-acquisition/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 5. Not-approved: a member not `approved-for-acquisition` is refused.
  // ---------------------------------------------------------------------------
  it('PINS: a member not approved-for-acquisition (status: discovered) is refused with no fetch', async () => {
    dir = await seedSourcesDir([
      { source: member({ status: 'discovered' }), records: [authoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow(/approved-for-acquisition/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('PINS: a member with no status at all is refused on the same approved-for-acquisition gate with no fetch', async () => {
    dir = await seedSourcesDir([
      { source: member({ status: undefined }), records: [authoredRecord()] },
    ]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await expect(
      runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch }),
    ).rejects.toThrow(/approved-for-acquisition/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 6. Object-store / checkpoint passthrough: `--object-store`, `--checkpoint`,
  //    and `--checkpoint-every` forward correctly to the fetcher args.
  // ---------------------------------------------------------------------------
  it('PINS: --object-store forwards to fetcher flags.objectStore', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      objectStore: true,
      fetch,
      ...gallicaCompletion(),
    });

    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.flags.objectStore).toBe(true);
  });

  it('PINS: --checkpoint and --checkpoint-every forward to fetcher flags.checkpoint / options.checkpointEvery', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await runAcquire({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      checkpoint: true,
      checkpointEvery: 25,
      fetch,
      ...gallicaCompletion(),
    });

    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.flags.checkpoint).toBe(true);
    expect(args.options.checkpointEvery).toBe(25);
  });

  it('PINS: with no passthrough flags, objectStore/checkpoint default false and checkpointEvery undefined', async () => {
    dir = await seedSourcesDir([{ source: member(), records: [authoredRecord()] }]);
    const fetch: FetchSourceFn = vi.fn(async () => undefined);

    await runAcquire({ sourcesDir: dir, sourceId: 'PB-P100', fetch, ...gallicaCompletion() });

    const [args] = vi.mocked(fetch).mock.calls[0];
    expect(args.flags.objectStore).toBe(false);
    expect(args.flags.checkpoint).toBe(false);
    expect(args.options.checkpointEvery).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 7. Reconcile transition: reconcile advances a Gallica record's acquisition
  //    status from the archive provenance, exactly as it does today.
  //
  // characterization gap: a true end-to-end acquire -> reconcile handoff is NOT
  //    covered here. `runAcquire` drives an INJECTED fetcher (the whole point of
  //    the DI boundary) that writes NO real per-page provenance to a real
  //    archive, and `runReconcile` DERIVES its status purely from that
  //    on-disk provenance. Pinning the handoff would require the real fetcher +
  //    a real archive/object store, which this suite deliberately does not
  //    touch. So we characterize each half separately: (1) above pins the exact
  //    fetch-source args acquire hands off; here we pin reconcile's status
  //    derivation from provenance for the same Gallica copy.
  // ---------------------------------------------------------------------------
  it('PINS: reconcile advances a Gallica record to "archived" when every page-image master is object-store-backed', async () => {
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
    expect(result.sourceArchive).toBe(GALLICA);
    expect(result.changed).toBe(true);

    // The transition is persisted back to the SSOT (to-collect -> archived).
    const reloaded = loadAllSources(dir).find((l) => l.source.sourceId === 'PB-P100');
    expect(reloaded?.records[0]?.status).toBe('archived');
  });

  it('PINS: reconcile advances a Gallica record to "collected" when some masters are not yet object-store-backed', async () => {
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
    const reloaded = loadAllSources(dir).find((l) => l.source.sourceId === 'PB-P100');
    expect(reloaded?.records[0]?.status).toBe('collected');
  });
});
