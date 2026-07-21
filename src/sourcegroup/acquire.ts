import { loadAllSources } from '@/bibliography/load';
import type { CompanionObjectStore } from '@/archive/write-record-companions';
import { isFetchableWork } from '@/bibliography/scope';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { RepositoryAdapterRegistry } from '@/repository/registry';
import { GallicaAdapter, type GallicaAcquisitionContext } from '@/repository/gallica/adapter';
import type { GatherProvenanceFn } from '@/sourcegroup/reconcile';
import {
  preflightCompletion,
  persistAcquisition,
  completeAcquisition,
} from '@/sourcegroup/acquire-complete';
import type { ParsedArgs } from '@/cli/parse';
import type { RepositoryAdapter } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import type { ObjectStore } from '@/archive/object-store';
import type { ArkResolver } from '@/sourcegroup/inventory';

/**
 * Acquire an approved member's copy by dispatching through the
 * {@link RepositoryAdapterRegistry} to the adapter chosen for the SELECTED
 * record's copy-identifier type (spec 011, T019 cutover): an `ark` record
 * routes to the {@link GallicaAdapter} (which wraps the SHIPPED `runFetchSource`
 * fetcher, `@/cli/fetch-source`, unchanged), an `accession` record routes to
 * the injected museum adapter ({@link NewItalyMuseumAdapter}). This module owns
 * NO fetch code and constructs no `fetch-source` `ParsedArgs` itself.
 *
 * The Gallica fetcher is INJECTED (see {@link FetchSourceFn}) and threaded into
 * the `GallicaAdapter` this function builds; the museum adapter is injected
 * whole ({@link AcquireInput.museumAdapter}), so tests never touch the network
 * or B2 -- production wiring (`src/cli/bib-sourcegroup.ts`) builds the registry
 * with BOTH adapters (the real `runFetchSource`, a real `HttpClient` +
 * `createMusarchExtractor` + `ObjectStore` for the museum path).
 *
 * The operator supplies only the member's source id -- NEVER a copy identifier
 * directly (FR-014); the identifier is always resolved from the selected
 * RepositoryRecord (by the adapter).
 *
 * Gate split (behavior-preserving cutover):
 *   - SOURCE-level gates stay HERE, in the caller, because they read the
 *     `Source` (source-group guardrail via `isFetchableWork`, FR-007/INV-3;
 *     `approved-for-acquisition`, FR-017) and the `RepositoryAdapter` contract
 *     hands `acquire` only a `RepositoryRecord`.
 *   - RECORD-level gates (public-domain, identifier-present) live INSIDE the
 *     selected adapter's `acquire` and are NOT duplicated here.
 *
 * T026 (specs/013-archiveorg-acquisition-path) extends dispatch a third way:
 * an `ia-item` record routes to the injected `InternetArchiveAdapter`
 * ({@link AcquireInput.internetArchiveAdapter}), mirroring how the museum
 * adapter was added in T019 -- optional, additive, and never registered
 * unless the caller supplies it.
 *
 * Dispatch is by the record's copy-identifier type via
 * {@link RepositoryAdapterRegistry.selectForRecord} (T019 cutover from the
 * T012 select-by-name). A DELIBERATE consequence: a record carrying NO
 * dispatchable copy identifier now fails at the REGISTRY ("no supported copy
 * identifier") rather than reaching the Gallica adapter's own "no ark
 * identifier -- nothing to fetch" gate. Both are fail-loud and nothing is
 * fetched; observable acquisition behavior for VALID records is unchanged
 * (SC-003). See the pinned assertion updated in
 * `src/repository/gallica/characterization.test.ts`.
 */

/**
 * Shape of the shipped `runFetchSource` (`@/cli/fetch-source`): takes the
 * parsed CLI args and (optionally, defaulted in production) its real
 * dependencies. Injected here as a plain `(args) => Promise<void>` boundary so
 * neither `runAcquire` nor the `GallicaAdapter` it builds constructs
 * `FetchDeps`/the network client itself -- production wiring passes
 * `runFetchSource` directly, which is assignable to this narrower type via its
 * own defaulted second parameter.
 */
export type FetchSourceFn = (args: ParsedArgs) => Promise<void>;

/** Input to {@link runAcquire}. */
export interface AcquireInput {
  /** Directory holding the one-file-per-source SSOT (`bibliography/sources`). */
  sourcesDir: string;
  /** The member's Colony Cults id, e.g. `PB-P100`. The operator NEVER supplies an ARK directly. */
  sourceId: string;
  /** Selects one RepositoryRecord when the member has more than one (FR-009a); infer-one otherwise. */
  archive?: string;
  /** Forwarded to the fetcher as `--object-store`. */
  objectStore?: boolean;
  /** Forwarded to the fetcher as `--dry-run`. */
  dryRun?: boolean;
  /**
   * Forwarded to the fetcher as `--checkpoint`: opt into the shipped
   * fetcher's incremental (per-page, for a monograph) git checkpointing
   * instead of a single commit at the very end. Default false -- unchanged
   * prior behavior -- so a plain `acquire` stays checkpoint-free.
   */
  checkpoint?: boolean;
  /**
   * Forwarded to the fetcher as `--checkpoint-every <N>`: page-checkpoint
   * cadence for a monograph fetch (only meaningful together with {@link
   * AcquireInput.checkpoint}). Absent -> the fetcher's own default (every
   * page) applies; validated (positive integer) by the CLI layer
   * (`@/cli/bib-sourcegroup`), not here.
   */
  checkpointEvery?: number;
  /** The injected shipped fetcher (see {@link FetchSourceFn}). REQUIRED -- no fallback fetch path exists. */
  fetch: FetchSourceFn;
  /**
   * The private archive-clone root, for writing the B2-direct masters' archive
   * COMPANIONS on acquire (spec 013). When present together with
   * {@link AcquireInput.companionObjectStore}, a B2-direct acquire (museum /
   * Internet Archive) writes the `f###.yml`/`<sha>.yml` companions that make its
   * masters discoverable -- closing the loop the `undiscoverable-master` sanity
   * check enforces. Absent (e.g. tests) ⇒ companion-writing is skipped.
   */
  companionArchiveRoot?: string;
  /** Object-store coordinates recorded on each companion (with {@link AcquireInput.companionArchiveRoot}). */
  companionObjectStore?: CompanionObjectStore;
  /**
   * The injected museum adapter ({@link NewItalyMuseumAdapter}), registered
   * ALONGSIDE the Gallica adapter so an `accession` record dispatches to it.
   * OPTIONAL: omit it (the characterization/behavioral suites do) to build a
   * Gallica-only registry -- an `ark` record then dispatches exactly as before.
   * Production wiring (`src/cli/bib-sourcegroup.ts`) always injects it.
   */
  museumAdapter?: RepositoryAdapter;
  /**
   * The injected {@link InternetArchiveAdapter} (T026, specs/013-archiveorg-
   * acquisition-path), registered ALONGSIDE Gallica (and the museum adapter,
   * when present) so an `ia-item` record dispatches to it. OPTIONAL: omit it
   * to build a registry with no IA adapter -- an `ia-item` record then fails
   * loud at the registry ("no adapter registered"), same as any other
   * unregistered repository. Production wiring
   * (`src/cli/bib-sourcegroup.ts`) always injects it.
   */
  internetArchiveAdapter?: RepositoryAdapter;
  /**
   * The injected {@link PapersPastAdapter} (T013/T014, specs/015-papers-past-
   * acquisition), registered ALONGSIDE Gallica (and the museum/Internet
   * Archive adapters, when present) so a `papers-past` record dispatches to
   * it. OPTIONAL: omit it to build a registry with no Papers Past adapter --
   * a `papers-past` record then fails loud at the registry ("no adapter
   * registered"), same as any other unregistered repository. Production
   * wiring (`src/cli/bib-sourcegroup-acquire.ts`) always injects it.
   */
  papersPastAdapter?: RepositoryAdapter;
  /**
   * Head-capable object store for the completion tail (spec 016, Principle XV).
   * After the adapter mirror + persist-assets block, `runAcquire` reuses the
   * idempotent {@link runReconcile} (heads-only) to advance the record's
   * acquisition `status`, then {@link verifyRecordComplete} to confirm every
   * recorded master is present + matching in the store BEFORE reporting
   * success. REQUIRED for a B2-direct acquire (museum / internet-archive /
   * papers-past) that mirrored masters; a Gallica acquire (`assets: []`,
   * per-page provenance) does not consult it. Injected so tests pass a fake
   * that never touches B2. Production wiring
   * (`src/cli/bib-sourcegroup-acquire.ts`) constructs the real `S3ObjectStore`.
   *
   * NB: distinct from the `objectStore?: boolean` field above (which forwards
   * `--object-store` to the fetcher) -- this is the head-capable store handle
   * the completion tail HEADs against.
   */
  completionObjectStore?: ObjectStore;
  /**
   * Archive-clone root the Gallica completion tail gathers per-page provenance
   * from (`COLONY_ARCHIVE_ROOT`), threaded into {@link runReconcile}'s
   * archive-provenance path. REQUIRED together with {@link AcquireInput.gather}
   * for a non-dry-run Gallica acquire: `runAcquire` FAILS LOUD (throws, reports
   * NO success) when a Gallica acquire is missing either, rather than silently
   * skipping status advancement for a fetched copy (Principle XV,
   * AUDIT-20260719-01). Unused on the B2-direct path (whose truth is the object
   * store). Production wiring (`src/cli/bib-sourcegroup-acquire.ts`) always
   * injects both for a Gallica acquire.
   */
  reconcileArchiveRoot?: string;
  /**
   * Injected provenance gatherer for the Gallica completion tail (the same
   * {@link GatherProvenanceFn} {@link runReconcile} takes -- production passes
   * `gatherProvenance`, `@/bibliography/derive`). REQUIRED together with
   * {@link AcquireInput.reconcileArchiveRoot} for a non-dry-run Gallica acquire
   * (a missing gather makes `runAcquire` fail loud, never silently skip).
   * Unused on the B2-direct path. Injected so tests never touch a real archive
   * on disk.
   */
  gather?: GatherProvenanceFn;
}

/** Result of a successful acquisition: what was resolved and handed to the adapter. */
export interface AcquireResult {
  sourceId: string;
  /** The selected RepositoryRecord's holding archive. */
  sourceArchive: string;
  /** The ARK, when the record dispatched to Gallica (absent for a museum/IA copy). */
  ark?: string;
  /** The accession, when the record dispatched to the museum (absent for a Gallica/IA copy). */
  accession?: string;
  /** The archive.org item id, when the record dispatched to the Internet Archive adapter. */
  iaItem?: string;
  /** The Papers Past article code, when the record dispatched to the Papers Past adapter. */
  papersPast?: string;
}

/** The record's ark value (the first `ark`-typed copy identifier), if any. */
function arkOf(record: RepositoryRecord): string | undefined {
  const identifier = (record.identifiers ?? []).find((id) => id.type === 'ark');
  return identifier?.value;
}

/** The record's accession value (the first `accession`-typed copy identifier), if any. */
function accessionOf(record: RepositoryRecord): string | undefined {
  const identifier = (record.identifiers ?? []).find((id) => id.type === 'accession');
  return identifier?.value;
}

/** The record's archive.org item id (the first `ia-item`-typed copy identifier), if any. */
function iaItemOf(record: RepositoryRecord): string | undefined {
  const identifier = (record.identifiers ?? []).find((id) => id.type === 'ia-item');
  return identifier?.value;
}

/** The record's Papers Past article code (the first `papers-past`-typed copy identifier), if any. */
function papersPastOf(record: RepositoryRecord): string | undefined {
  const identifier = (record.identifiers ?? []).find((id) => id.type === 'papers-past');
  return identifier?.value;
}

/**
 * A fail-loud `ArkResolver` for the `GallicaAdapter` this module builds.
 *
 * `GallicaAdapter`'s constructor REQUIRES a resolver, but the acquire path
 * (`GallicaAdapter.acquire`) never resolves arks -- resolution belongs to
 * `bib inventory` (`@/sourcegroup/inventory`), not acquisition. This resolver
 * exists only to satisfy the adapter's constructor invariant and throws (never
 * returns mock data) if ever reached on this path.
 */
const acquirePathNeverResolvesArks: ArkResolver = (_ark: string) => {
  throw new Error(
    'runAcquire: the acquire path never resolves arks -- GallicaAdapter.resolve ' +
      'is not wired here (ark resolution belongs to `bib inventory`).',
  );
};

/**
 * Build the {@link RepositoryAdapterRegistry} for the acquire path: always the
 * {@link GallicaAdapter} (wrapping the injected fetcher), plus the injected
 * museum adapter when one was supplied (so an `accession` record dispatches to
 * it), plus the injected Internet Archive adapter when one was supplied (so an
 * `ia-item` record dispatches to it, T026), plus the injected Papers Past
 * adapter when one was supplied (so a `papers-past` record dispatches to it,
 * T013/T014). Gallica-only when all three are omitted -- an `ark` record then
 * dispatches exactly as it did pre-cutover.
 */
function buildRegistry(
  fetch: FetchSourceFn,
  museumAdapter: RepositoryAdapter | undefined,
  internetArchiveAdapter: RepositoryAdapter | undefined,
  papersPastAdapter: RepositoryAdapter | undefined,
): RepositoryAdapterRegistry {
  const gallica = new GallicaAdapter({
    fetch,
    resolveArk: acquirePathNeverResolvesArks,
  });
  const adapters: RepositoryAdapter[] = [gallica];
  if (museumAdapter !== undefined) {
    adapters.push(museumAdapter);
  }
  if (internetArchiveAdapter !== undefined) {
    adapters.push(internetArchiveAdapter);
  }
  if (papersPastAdapter !== undefined) {
    adapters.push(papersPastAdapter);
  }
  return new RepositoryAdapterRegistry(adapters);
}

/** Fail loud on structurally malformed input before touching the filesystem. */
function assertWellFormed(input: AcquireInput): void {
  if (input === null || typeof input !== 'object') {
    throw new Error('acquire: input is required.');
  }
  if (
    input.sourcesDir === undefined ||
    typeof input.sourcesDir !== 'string' ||
    input.sourcesDir.trim().length === 0
  ) {
    throw new Error('acquire: input.sourcesDir is required.');
  }
  if (
    input.sourceId === undefined ||
    typeof input.sourceId !== 'string' ||
    input.sourceId.trim().length === 0
  ) {
    throw new Error('acquire: input.sourceId is required.');
  }
  if (typeof input.fetch !== 'function') {
    throw new Error('acquire: input.fetch is required (the injected shipped fetcher).');
  }
}

/**
 * Run the `acquire` command (US4, FR-014-017): resolve one member's approved,
 * public-domain copy and dispatch it through the registry to the adapter chosen
 * for its copy-identifier type -- Gallica for an `ark`, the museum for an
 * `accession` -- which drives that repository's fetch.
 *
 * Preconditions (all fail loud, nothing fetched on failure):
 * 1. The target is a fetchable work (`isFetchableWork`, FR-007, INV-APPROVE,
 *    INV-3) -- a source-group (work-bundle) id passed here is rejected loud.
 *    SOURCE-level; stays in this caller.
 * 2. The member exists and its `status` is `approved-for-acquisition`
 *    (FR-017). SOURCE-level; stays in this caller.
 * 3. Exactly one RepositoryRecord is selected (infer-one / `--archive`,
 *    `@/sourcegroup/record-select`'s `selectRepositoryRecord`). Stays in this
 *    caller (the adapter contract acts on a single already-selected record).
 * 4. The selected record carries a dispatchable copy identifier (`ark` or
 *    `accession`); otherwise `registry.selectForRecord` fails loud with "no
 *    supported copy identifier" before any adapter is reached (T019).
 * 5. The selected adapter's own RECORD-level gates pass (Gallica:
 *    `rights.status === 'public-domain'`; museum:
 *    `rightsAssessment.rightsStatus === 'public-domain'`). Enforced INSIDE the
 *    adapter's `acquire`.
 *
 * On success this function adapts the adapter's `AcquisitionResult` back into
 * the observable {@link AcquireResult}: `{ sourceId, ark, sourceArchive }` for
 * a Gallica copy, `{ sourceId, accession, sourceArchive }` for a museum copy.
 */
export async function runAcquire(input: AcquireInput): Promise<AcquireResult> {
  assertWellFormed(input);

  const loaded = loadAllSources(input.sourcesDir);
  const entry = loaded.find((l) => l.source.sourceId === input.sourceId);
  if (entry === undefined) {
    throw new Error(`acquire: unknown sourceId "${input.sourceId}".`);
  }

  const { source, records: authoredRecords } = entry;

  // SOURCE-level gate: acquisition applies ONLY to a fetchable work (FR-007,
  // INV-APPROVE, INV-3) -- a work-bundle (`kind: 'source-group'`) is rejected
  // loud here, on the single explicit `isFetchableWork` predicate, independent
  // of whatever `status` it happens to carry. Checked BEFORE the
  // `approved-for-acquisition` precondition so a group is never misdiagnosed by
  // an unrelated status check. Stays in the caller: it reads the `Source`,
  // which the adapter contract does not hand to `acquire`.
  if (!isFetchableWork(source)) {
    throw new Error(
      `acquire: "${input.sourceId}" is a source-group (work-bundle), not a fetchable work -- ` +
        `a container is never approved-for-acquisition and can never be acquired (FR-007, INV-3).`,
    );
  }

  // SOURCE-level gate: only an approved member may be acquired (FR-017). Stays
  // in the caller for the same reason.
  if (source.status !== 'approved-for-acquisition') {
    throw new Error(
      `acquire: member "${input.sourceId}" is not approved-for-acquisition ` +
        `(status: ${source.status ?? '(none)'}) -- only an approved member may be ` +
        `acquired (FR-017).`,
    );
  }

  // `selectRepositoryRecord` only reads `sourceArchive` off each record; the
  // authored on-disk shape omits `sourceId` (it's implied by the owning SSOT
  // file), so it is threaded back in here to satisfy `RepositoryRecord`'s
  // shape without inventing any other field. Record SELECTION stays in the
  // caller -- the adapter acts on a single already-selected record.
  const candidateRecords: RepositoryRecord[] = authoredRecords.map((record) => ({
    ...record,
    sourceId: source.sourceId,
  }));
  const record = selectRepositoryRecord(candidateRecords, input.archive);

  // Dispatch by the selected record's copy-identifier type (T019): an `ark`
  // record -> GallicaAdapter, an `accession` record -> the injected museum
  // adapter. A record with no dispatchable identifier fails HERE, at the
  // registry ("no supported copy identifier"), before any adapter is reached --
  // the deliberate cutover consequence pinned in the characterization suite.
  // The selected adapter enforces its own RECORD-level gates (public-domain,
  // identifier-present) and drives its fetch.
  const registry = buildRegistry(
    input.fetch,
    input.museumAdapter,
    input.internetArchiveAdapter,
    input.papersPastAdapter,
  );
  const adapter = registry.selectForRecord(record);

  // Preflight the completion machinery BEFORE the adapter's durable side effects
  // (fail loud if the dispatched kind's completion deps are absent; spec 016,
  // AUDIT-20260719-06). `--dry-run` is exempt.
  preflightCompletion(adapter, input);

  const ctx: GallicaAcquisitionContext = {
    objectStore: input.objectStore,
    dryRun: input.dryRun,
    checkpoint: input.checkpoint,
    checkpointEvery: input.checkpointEvery,
  };
  const acquisition = await adapter.acquire(record, ctx);

  // Persist the adapter's durable output onto the SSOT + write master companions
  // (spec 011/013; snapshot decoupled per AUDIT-20260720-01), then complete the
  // record as an inseparable part of the acquire (reconcile status + verify;
  // spec 016, Principle XV). Both are `--dry-run`-exempt internally.
  await persistAcquisition({
    sourcesDir: input.sourcesDir,
    source,
    authoredRecords,
    record,
    acquisition,
    companionArchiveRoot: input.companionArchiveRoot,
    companionObjectStore: input.companionObjectStore,
  });
  await completeAcquisition(input, record, adapter, acquisition);

  // `adapter.acquire` succeeded, so the record carried the identifier its
  // dispatch keyed on (the registry would have thrown otherwise); read it back
  // for the observable result. Not a re-gate -- a post-success invariant read.
  if (adapter.repository === 'gallica') {
    const ark = arkOf(record);
    if (ark === undefined) {
      throw new Error(
        `acquire: internal invariant -- ${adapter.repository} acquire succeeded for ` +
          `"${input.sourceId}" but the record carries no ark.`,
      );
    }
    return { sourceId: input.sourceId, ark, sourceArchive: record.sourceArchive };
  }

  if (adapter.repository === 'internet-archive') {
    const iaItem = iaItemOf(record);
    if (iaItem === undefined) {
      throw new Error(
        `acquire: internal invariant -- ${adapter.repository} acquire succeeded for ` +
          `"${input.sourceId}" but the record carries no ia-item.`,
      );
    }
    return { sourceId: input.sourceId, iaItem, sourceArchive: record.sourceArchive };
  }

  if (adapter.repository === 'papers-past') {
    const papersPast = papersPastOf(record);
    if (papersPast === undefined) {
      throw new Error(
        `acquire: internal invariant -- ${adapter.repository} acquire succeeded for ` +
          `"${input.sourceId}" but the record carries no papers-past identifier.`,
      );
    }
    return { sourceId: input.sourceId, papersPast, sourceArchive: record.sourceArchive };
  }

  const accession = accessionOf(record);
  if (accession === undefined) {
    throw new Error(
      `acquire: internal invariant -- ${adapter.repository} acquire succeeded for ` +
        `"${input.sourceId}" but the record carries no accession.`,
    );
  }
  return { sourceId: input.sourceId, accession, sourceArchive: record.sourceArchive };
}
