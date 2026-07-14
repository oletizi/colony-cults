import { loadAllSources } from '@/bibliography/load';
import { isFetchableWork } from '@/bibliography/scope';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { RepositoryAdapterRegistry } from '@/repository/registry';
import { GallicaAdapter, type GallicaAcquisitionContext } from '@/repository/gallica/adapter';
import type { ParsedArgs } from '@/cli/parse';
import type { RepositoryRecord } from '@/model/repository-record';
import type { ArkResolver } from '@/sourcegroup/inventory';

/**
 * Acquire an approved member's copy by dispatching through the
 * {@link RepositoryAdapterRegistry} to the {@link GallicaAdapter} (spec 011,
 * T012 cutover). The adapter wraps the SHIPPED `runFetchSource` fetcher
 * (`@/cli/fetch-source`) -- the exact page-image/OCR/provenance pipeline that
 * used to be driven inline here -- so this module owns NO fetch code and no
 * longer constructs the `fetch-source` `ParsedArgs` itself.
 *
 * The fetcher is INJECTED (see {@link FetchSourceFn}) and threaded straight
 * into the `GallicaAdapter` this function builds, so tests never touch the
 * network or B2 -- production wiring (`src/cli/bib-sourcegroup.ts`) passes the
 * real `runFetchSource` unchanged.
 *
 * The operator supplies only the member's source id -- NEVER an ARK directly
 * (FR-014); the ARK is always resolved from the selected RepositoryRecord (by
 * the adapter).
 *
 * Gate split (behavior-preserving cutover):
 *   - SOURCE-level gates stay HERE, in the caller, because they read the
 *     `Source` (source-group guardrail via `isFetchableWork`, FR-007/INV-3;
 *     `approved-for-acquisition`, FR-017) and the `RepositoryAdapter` contract
 *     hands `acquire` only a `RepositoryRecord`.
 *   - RECORD-level gates (public-domain, ark-present) now live INSIDE
 *     `GallicaAdapter.acquire` and are NOT duplicated here.
 *
 * Dispatch is by adapter NAME (`gallica`), not by
 * {@link RepositoryAdapterRegistry.selectForRecord}: the sourcegroup acquire
 * path is Gallica-only, and selecting by record identifier would refuse a
 * no-ark record on the registry's "no supported copy identifier" message
 * BEFORE the Gallica adapter's own "no ark identifier -- nothing to fetch"
 * gate could fire -- changing the pinned (T010) observable behavior. Selecting
 * the Gallica adapter by name preserves that pinned failure exactly.
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
}

/** Result of a successful acquisition: what was resolved and handed to the fetcher. */
export interface AcquireResult {
  sourceId: string;
  /** The ARK resolved from the selected RepositoryRecord. */
  ark: string;
  /** The selected RepositoryRecord's holding archive. */
  sourceArchive: string;
}

/** The record's ark value (the first `ark`-typed copy identifier), if any. */
function arkOf(record: RepositoryRecord): string | undefined {
  const identifier = (record.identifiers ?? []).find((id) => id.type === 'ark');
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
 * Build the Gallica-only {@link RepositoryAdapterRegistry} for the acquire
 * path, injecting the shipped fetcher into the {@link GallicaAdapter}.
 */
function buildGallicaRegistry(fetch: FetchSourceFn): RepositoryAdapterRegistry {
  const gallica = new GallicaAdapter({
    fetch,
    resolveArk: acquirePathNeverResolvesArks,
  });
  return new RepositoryAdapterRegistry([gallica]);
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
 * public-domain copy and dispatch it through the registry to the
 * {@link GallicaAdapter}, which drives the shipped fetcher.
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
 * 4. The selected record's `rights.status` is `public-domain` (FR-017).
 *    RECORD-level; enforced by `GallicaAdapter.acquire`.
 * 5. The selected record carries an `ark` copy identifier (nothing to fetch
 *    otherwise). RECORD-level; enforced by `GallicaAdapter.acquire`.
 *
 * On success, the adapter invokes the injected {@link FetchSourceFn} EXACTLY
 * ONCE with the pinned `fetch-source` `ParsedArgs`
 * (`verify`/`reconcileRemote`/`force` hardcoded false); this function then
 * adapts the adapter's `AcquisitionResult` back into the observable
 * {@link AcquireResult} (`sourceId`, `ark`, `sourceArchive`).
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

  // Dispatch through the registry to the Gallica adapter, which enforces the
  // RECORD-level gates (public-domain, ark-present) and drives the injected
  // fetcher. Selecting by name (not `selectForRecord`) preserves the pinned
  // "no ark identifier -- nothing to fetch" failure for a no-ark record.
  const registry = buildGallicaRegistry(input.fetch);
  const adapter = registry.selectByName('gallica');

  const ctx: GallicaAcquisitionContext = {
    objectStore: input.objectStore,
    dryRun: input.dryRun,
    checkpoint: input.checkpoint,
    checkpointEvery: input.checkpointEvery,
  };
  await adapter.acquire(record, ctx);

  // `adapter.acquire` succeeded, so the record carried an ark (its own gate
  // would have thrown otherwise); read it back for the observable result. Not a
  // re-gate -- a post-success invariant read that never blocks the fetch.
  const ark = arkOf(record);
  if (ark === undefined) {
    throw new Error(
      `acquire: internal invariant -- GallicaAdapter.acquire succeeded for ` +
        `"${input.sourceId}" but the record carries no ark.`,
    );
  }

  return { sourceId: input.sourceId, ark, sourceArchive: record.sourceArchive };
}
