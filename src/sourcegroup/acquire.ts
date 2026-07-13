import { loadAllSources } from '@/bibliography/load';
import { isFetchableWork } from '@/bibliography/scope';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import type { ParsedArgs } from '@/cli/parse';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Acquire an approved member's copy by REUSING the shipped `runFetchSource`
 * fetcher (`@/cli/fetch-source`) -- resolving the ARK from the member's
 * ALREADY-SELECTED `RepositoryRecord` and driving the fetcher with it (T029/
 * T030, FR-014-017, D-08).
 *
 * NO new fetch code lives here. The fetcher is INJECTED (see
 * {@link FetchSourceFn}) precisely so this module never duplicates its
 * page-image/OCR/provenance pipeline and so tests never touch the network or
 * B2 -- production wiring (`src/cli/bibliography.ts`, a separate task) passes
 * the real `runFetchSource` straight through, unchanged.
 *
 * The operator supplies only the member's source id -- NEVER an ARK directly
 * (FR-014); the ARK is always resolved from the selected RepositoryRecord.
 *
 * The shipped fetcher already carries its own source-group guardrail (FR-016)
 * -- that guardrail is NOT reimplemented here. Attempting to acquire a
 * source-group itself is refused explicitly by the `isFetchableWork` guard
 * below (`@/bibliography/scope`, FR-007, INV-APPROVE, INV-3) -- the single
 * predicate every approval/acquisition consumer calls, checked on `kind`
 * rather than relying on the incidental fact that a source-group's own
 * Source status is never `approved-for-acquisition` (that status belongs to
 * the member lifecycle, see `@/model/source`'s `Source.status`).
 */

/**
 * Shape of the shipped `runFetchSource` (`@/cli/fetch-source`): takes the
 * parsed CLI args and (optionally, defaulted in production) its real
 * dependencies. Injected here as a plain `(args) => Promise<void>` boundary
 * so `runAcquire` never constructs `FetchDeps`/the network client itself --
 * production wiring passes `runFetchSource` directly, which is assignable to
 * this narrower type via its own defaulted second parameter.
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
 * Run the `acquire` command (US4, FR-014-017): resolve one member's
 * approved, public-domain copy's ARK and hand it to the shipped fetcher.
 *
 * Preconditions (all fail loud, nothing fetched on failure):
 * 1. The target is a fetchable work (`isFetchableWork`, FR-007, INV-APPROVE,
 *    INV-3) -- a source-group (work-bundle) id passed here is rejected loud.
 * 2. The member exists and its `status` is `approved-for-acquisition`
 *    (FR-017).
 * 3. Exactly one RepositoryRecord is selected (infer-one / `--archive`,
 *    `@/sourcegroup/record-select`'s `selectRepositoryRecord`).
 * 4. The selected record's `rights.status` is `public-domain` (FR-017).
 * 5. The selected record carries an `ark` copy identifier (nothing to fetch
 *    otherwise).
 *
 * On success, invokes the injected {@link FetchSourceFn} EXACTLY ONCE with
 * `fetch-source <ark> --source-id <id>` plus `--object-store`/`--dry-run`/
 * `--checkpoint`/`--checkpoint-every` passthrough (FR-014/FR-015) -- no new
 * fetch code. `verify`/`reconcileRemote`/`force` stay hardcoded false (read-
 * avoidance): an acquisition trusts the freshly resolved rights/ARK rather
 * than re-verifying or re-fetching already-checksummed assets.
 */
export async function runAcquire(input: AcquireInput): Promise<AcquireResult> {
  assertWellFormed(input);

  const loaded = loadAllSources(input.sourcesDir);
  const entry = loaded.find((l) => l.source.sourceId === input.sourceId);
  if (entry === undefined) {
    throw new Error(`acquire: unknown sourceId "${input.sourceId}".`);
  }

  const { source, records: authoredRecords } = entry;

  // Acquisition applies ONLY to a fetchable work (FR-007, INV-APPROVE,
  // INV-3) -- a work-bundle (`kind: 'source-group'`) is rejected loud here,
  // on the single explicit `isFetchableWork` predicate, independent of
  // whatever `status` it happens to carry. Checked BEFORE the
  // `approved-for-acquisition` precondition so a group is never
  // misdiagnosed by an unrelated status check.
  if (!isFetchableWork(source)) {
    throw new Error(
      `acquire: "${input.sourceId}" is a source-group (work-bundle), not a fetchable work -- ` +
        `a container is never approved-for-acquisition and can never be acquired (FR-007, INV-3).`,
    );
  }

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
  // shape without inventing any other field.
  const candidateRecords: RepositoryRecord[] = authoredRecords.map((record) => ({
    ...record,
    sourceId: source.sourceId,
  }));
  const record = selectRepositoryRecord(candidateRecords, input.archive);

  if (record.rights?.status !== 'public-domain') {
    throw new Error(
      `acquire: the selected RepositoryRecord for "${input.sourceId}" at ` +
        `"${record.sourceArchive}" is not public-domain -- only public-domain ` +
        `copies may be acquired (FR-017).`,
    );
  }

  const ark = arkOf(record);
  if (ark === undefined) {
    throw new Error(
      `acquire: the selected RepositoryRecord for "${input.sourceId}" at ` +
        `"${record.sourceArchive}" carries no ark identifier -- nothing to fetch.`,
    );
  }

  const args: ParsedArgs = {
    command: 'fetch-source',
    positional: [ark],
    flags: {
      dryRun: input.dryRun ?? false,
      force: false,
      verify: false,
      ocr: false,
      objectStore: input.objectStore ?? false,
      reconcileRemote: false,
      checkpoint: input.checkpoint ?? false,
    },
    options: {
      sourceId: input.sourceId,
      checkpointEvery: input.checkpointEvery,
    },
  };

  await input.fetch(args);

  return { sourceId: input.sourceId, ark, sourceArchive: record.sourceArchive };
}
