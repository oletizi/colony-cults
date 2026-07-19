/**
 * CLI wiring for `bib acquire` and `bib reconcile` (TASK-20/TASK-21/TASK-30,
 * specs/013-archiveorg-acquisition-path FR-008). Split out of
 * `src/cli/bib-sourcegroup.ts` to keep both files under the project's
 * file-size guideline -- re-exported from that module so its existing
 * external importers (`@/cli/bibliography`, `@/cli/bib-sourcegroup.test`) are
 * unaffected.
 *
 * Each handler parses its own flags per
 * specs/006-source-group-acquisition/contracts/cli-commands.md, constructs the
 * REAL injected dependencies (the shipped `loadAllSources` member loader, the
 * shipped `runFetchSource` fetcher, the real object store), calls the
 * already-tested handler in `src/sourcegroup/`, and maps the outcome to a
 * process exit code + printed output. Fail loud: a tooling/precondition
 * failure prints to stderr and returns a non-zero code; no fallbacks.
 */

import { parseArgs as nodeParseArgs } from 'node:util';

import { loadAllSources } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import { deriveSourceLayout, registerSourceLayout, resolveArchiveRoot } from '@/archive/location';
import { runFetchSource } from '@/cli/fetch';
import { parseCheckpointEvery } from '@/cli/parse';
import { resolveRepoRoot, sourcesDirOf } from '@/cli/bib-sourcegroup-paths';
import { runAcquire } from '@/sourcegroup/acquire';
import { buildMuseumAdapterForMember } from '@/cli/bib-acquire-museum';
import { buildInternetArchiveAdapterForMember } from '@/cli/bib-acquire-internet-archive';
import { buildPapersPastAdapterForMember } from '@/cli/bib-acquire-papers-past';
import type { LeafRange } from '@/model/quality-assessment';
import { runReconcile, type ReconcileResult } from '@/sourcegroup/reconcile';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { gatherProvenance } from '@/bibliography/derive';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { resolveObjectStoreConfig } from '@/archive/b2-config';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Auto-register `id`'s archive layout (`@/archive/location`'s runtime
 * overlay) BEFORE `bib acquire` drives the shipped fetcher -- the fetcher
 * resolves a layout deep inside via the synchronous, sourceId-only
 * `sourceLayout(sourceId)`, which throws for a source-group member (created
 * by `bib inventory`) that was never hand-added to the static registry. Loads
 * the member Source (and, when it has one, its owning group, for the
 * fallback `case`) via the shipped `loadAllSources` -- fails loud if either
 * cannot be resolved, since a layout cannot be derived from nothing.
 *
 * Exported (not just used internally by `runAcquireCli`) so this wiring is
 * directly unit-testable without standing up the full CLI (real repo root,
 * real network-backed fetcher).
 */
export function registerMemberArchiveLayout(sourcesDir: string, id: string): void {
  const loaded = loadAllSources(sourcesDir);
  const memberEntry = loaded.find((entry) => entry.source.sourceId === id);
  if (memberEntry === undefined) {
    throw new Error(`bib acquire: unknown sourceId "${id}" -- cannot resolve its archive layout`);
  }
  const memberSource = memberEntry.source;

  let groupCase: string | undefined;
  if (memberSource.partOf !== undefined) {
    const groupEntry = loaded.find((entry) => entry.source.sourceId === memberSource.partOf);
    if (groupEntry === undefined) {
      throw new Error(
        `bib acquire: member "${id}"'s group "${memberSource.partOf}" does not resolve to an ` +
          `existing Source -- cannot derive its archive layout's fallback case`,
      );
    }
    groupCase = groupEntry.source.case;
  }

  registerSourceLayout(id, deriveSourceLayout(memberSource, groupCase));
}

/** Typed result of parsing `bib acquire`'s argv (see {@link parseAcquireArgs}). */
export interface AcquireCliArgs {
  id: string | undefined;
  archive: string | undefined;
  objectStore: boolean;
  dryRun: boolean;
  checkpoint: boolean;
  checkpointEvery: number | undefined;
  /**
   * `--approved-range <start-end>` (specs/013-archiveorg-acquisition-path,
   * FR-008): the Internet Archive path's two-phase quality-gate flag, phase
   * 2 (`makeCliQualityGate`, `@/cli/bib-acquire-internet-archive`). Ignored
   * by a Gallica/museum acquire (only the IA adapter reads a `QualityGate`).
   */
  approvedRange: LeafRange | undefined;
  /** `--reject`: force the IA quality gate to record `status: 'unsound'` (fail-closed, zero B2 writes). */
  reject: boolean;
  /** `--notes <text>`: free-text operator notes recorded on the IA quality assessment. */
  notes: string | undefined;
}

/**
 * Parse `--approved-range <start-end>` (e.g. `"4-368"`) into a {@link
 * LeafRange}. Fails loud on anything else -- there is no partial/guessed
 * range: an absent flag maps to `undefined` (phase 1: the gate falls back to
 * the scandata-seeded proposal), but a PRESENT, malformed value is a user
 * error, never silently ignored.
 */
export function parseApprovedRange(raw: string | undefined): LeafRange | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = /^(\d+)-(\d+)$/.exec(raw.trim());
  if (match === null) {
    throw new Error(
      `--approved-range must be "<start>-<end>" (e.g. "4-368"), got "${raw}"`,
    );
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start) {
    throw new Error(
      `--approved-range must have "<start>-<end>" with start >= 1 and end >= start, got "${raw}"`,
    );
  }
  return { start, end };
}

/**
 * Parse `bib acquire <id> [--archive] [--object-store] [--dry-run]
 * [--checkpoint] [--checkpoint-every <N>] [--approved-range <start-end>]
 * [--reject] [--notes <text>]`'s argv into typed flags.
 *
 * Exported (not just used internally by `runAcquireCli`) so this parsing is
 * directly unit-testable without driving the real network-backed fetcher
 * (`runAcquireCli` always injects the real, unmocked `runFetchSource`).
 * `--checkpoint-every` is validated by the same `parseCheckpointEvery`
 * (`@/cli/parse`) the shipped fetcher's own `--checkpoint-every` uses, so a
 * malformed value fails identically here and there (fail loud, no
 * fallback). `--approved-range`/`--reject`/`--notes` are the Internet
 * Archive path's two-phase quality-gate flags (specs/013-archiveorg-
 * acquisition-path, FR-008) -- unused by a Gallica/museum acquire.
 */
export function parseAcquireArgs(rest: string[]): AcquireCliArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      archive: { type: 'string' },
      'object-store': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      checkpoint: { type: 'boolean', default: false },
      'checkpoint-every': { type: 'string' },
      'approved-range': { type: 'string' },
      reject: { type: 'boolean', default: false },
      notes: { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    id: positionals[0],
    archive: values.archive,
    objectStore: Boolean(values['object-store']),
    dryRun: Boolean(values['dry-run']),
    checkpoint: Boolean(values.checkpoint),
    checkpointEvery: parseCheckpointEvery(values['checkpoint-every']),
    approvedRange: parseApprovedRange(values['approved-range']),
    reject: Boolean(values.reject),
    notes: values.notes,
  };
}

/**
 * `bib acquire <id> [--archive] [--object-store] [--dry-run] [--checkpoint]
 * [--checkpoint-every <N>] [--approved-range <start-end>] [--reject]
 * [--notes <text>]`.
 */
export async function runAcquireCli(rest: string[]): Promise<number> {
  let parsed: AcquireCliArgs;
  try {
    parsed = parseAcquireArgs(rest);
  } catch (error) {
    console.error(`bib acquire: ${describeError(error)}`);
    return 2;
  }
  const { id, archive, objectStore, dryRun, checkpoint, checkpointEvery, approvedRange, reject, notes } =
    parsed;

  if (id === undefined) {
    console.error('bib acquire: missing required argument <id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = sourcesDirOf(repoRoot);
  try {
    // Auto-register this member's archive layout BEFORE the fetcher (below)
    // resolves it -- see `registerMemberArchiveLayout`'s doc comment.
    registerMemberArchiveLayout(sourcesDir, id);

    // Register all FOUR adapters: the Gallica fetcher is always injected;
    // the museum adapter (T019), the Internet Archive adapter (T026/T027),
    // and the Papers Past adapter (T013) are each built only when THIS
    // member's selected copy is the matching identifier type
    // (`buildMuseumAdapterForMember` / `buildInternetArchiveAdapterForMember`
    // / `buildPapersPastAdapterForMember`), so an ark acquire never pays the
    // museum's B2/codex cost, the IA path's poppler/staging cost, or the
    // Papers Past path's browser/B2 cost.
    const museumAdapter = await buildMuseumAdapterForMember(sourcesDir, id, archive);
    const internetArchiveAdapter = await buildInternetArchiveAdapterForMember(sourcesDir, id, archive, {
      approvedRange,
      reject,
      notes,
    });
    const papersPastAdapter = await buildPapersPastAdapterForMember(sourcesDir, id, archive);

    // For a B2-direct acquire (museum / Internet Archive / Papers Past), give
    // runAcquire the archive-clone root + object-store coordinates so it
    // writes the mirrored masters' companions (the discovery layer) -- so an
    // acquisition can never again produce object-store masters with no
    // companions (the `undiscoverable-master` sanity check). A Gallica-only
    // acquire builds none of the B2-direct adapters and writes its own
    // companions via the fetcher, so these stay unset (no object-store config
    // needed).
    // `isB2Direct` reflects the SELECTED copy's dispatch kind, NOT broad adapter
    // availability (AUDIT-20260719-05): each `build*AdapterForMember` selects the
    // member's copy via the SAME `selectRepositoryRecord(candidates, archive)`
    // that `runAcquire` dispatches on, and returns `undefined` unless THAT copy
    // is its identifier type. So exactly one B2 adapter is built when the selected
    // copy is B2-direct, and all three are `undefined` when the selected copy is a
    // Gallica (`ark`) copy -- `isB2Direct` therefore equals the kind `runAcquire`
    // will dispatch to, and the completion machinery below always matches the
    // selected path (a `--archive`-selected Gallica copy can never be starved of
    // its `reconcileArchiveRoot`/`gather`).
    const isB2Direct =
      museumAdapter !== undefined || internetArchiveAdapter !== undefined || papersPastAdapter !== undefined;
    const objectStoreConfig = isB2Direct ? resolveObjectStoreConfig() : undefined;

    // Completion tail dependencies (spec 016, Principle XV): give runAcquire the
    // means to complete the SSOT record as part of the SAME acquire (advance
    // status + verify), so no separate `bib reconcile` is required. Keyed on the
    // selected copy's dispatch kind (above): a B2-direct copy is completed against
    // the real object store (heads-only); a Gallica copy is completed from the
    // archive's per-page provenance (the member's layout was registered above, so
    // `gatherProvenance` resolves it). `--dry-run` mirrors nothing, so runAcquire's
    // own tail is exempt regardless.
    const completionDeps =
      isB2Direct && objectStoreConfig !== undefined
        ? { completionObjectStore: new S3ObjectStore(objectStoreConfig) }
        : { reconcileArchiveRoot: resolveArchiveRoot(repoRoot), gather: gatherProvenance };

    const result = await runAcquire({
      sourcesDir,
      sourceId: id,
      archive,
      objectStore,
      dryRun,
      checkpoint,
      checkpointEvery,
      // The shipped fetcher, injected unchanged (D-08): no new fetch code here.
      fetch: runFetchSource,
      museumAdapter,
      internetArchiveAdapter,
      papersPastAdapter,
      ...completionDeps,
      ...(isB2Direct && objectStoreConfig !== undefined
        ? {
            companionArchiveRoot: resolveArchiveRoot(repoRoot),
            companionObjectStore: {
              provider: objectStoreConfig.provider,
              bucket: objectStoreConfig.bucket,
              endpoint: objectStoreConfig.endpoint,
            },
          }
        : {}),
    });
    const mode = dryRun ? ' (dry-run)' : '';
    const identifier =
      result.ark ?? result.accession ?? result.iaItem ?? result.papersPast ?? '(no copy identifier)';
    console.log(
      `bib acquire${mode}: ${result.sourceId} -> fetched ${identifier} ` +
        `from "${result.sourceArchive}"`,
    );
    return 0;
  } catch (error) {
    console.error(`bib acquire: ${describeError(error)}`);
    return 1;
  }
}

/** Typed result of parsing `bib reconcile`'s argv (see {@link parseReconcileArgs}). */
export interface ReconcileCliArgs {
  id: string | undefined;
  archive: string | undefined;
  archiveRoot: string | undefined;
}

/**
 * Parse `bib reconcile <id> [--archive <sourceArchive>] [--archive-root
 * <path>]`'s argv into typed flags. Exported so this parsing is directly
 * unit-testable without touching a real archive on disk.
 */
export function parseReconcileArgs(rest: string[]): ReconcileCliArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      archive: { type: 'string' },
      'archive-root': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    id: positionals[0],
    archive: values.archive,
    archiveRoot: values['archive-root'],
  };
}

/**
 * True when `id`'s SELECTED copy carries recorded object-store `assets` -- the
 * museum/B2 case, reconciled by verifying those assets against the object store
 * rather than from archive provenance (TASK-30). Resilient like
 * `buildMuseumAdapterForMember`: any load/select failure yields `false`, so the
 * archive-provenance path runs and surfaces the real precondition error with
 * its own message rather than this peek double-reporting it.
 */
function selectedCopyHasRecordedAssets(
  sourcesDir: string,
  id: string,
  archive: string | undefined,
): boolean {
  try {
    const loaded = loadAllSources(sourcesDir);
    const entry = loaded.find((e) => e.source.sourceId === id);
    if (entry === undefined) {
      return false;
    }
    const candidates: RepositoryRecord[] = entry.records.map((authored) => ({
      ...authored,
      sourceId: entry.source.sourceId,
    }));
    const record = selectRepositoryRecord(candidates, archive);
    return record.assets !== undefined && record.assets.length > 0;
  } catch {
    return false;
  }
}

/**
 * `bib reconcile <id> [--archive <sourceArchive>] [--archive-root <path>]`
 * (TASK-21, TASK-30): fold each copy's acquisition truth into the member's SSOT
 * `repositoryRecords[].status`, closing the spec/impl gaps TASK-20 (Gallica)
 * and TASK-30 (museum) found. Two paths, chosen by the selected copy's shape:
 *
 * - a museum copy (recorded object-store `assets`) is reconciled against the
 *   real `S3ObjectStore` -- no archive root or layout needed (its truth is B2 +
 *   the recorded asset, not any file under `COLONY_ARCHIVE_ROOT`);
 * - a Gallica copy is reconciled from the archive's per-page provenance, so it
 *   still resolves the archive root and registers the member's archive layout
 *   BEFORE gathering (`gatherProvenance`'s `sourceLayout` throws for an
 *   unregistered source-group member -- same overlay `bib acquire` needs).
 *
 * Idempotent; re-runnable on members acquired out-of-band.
 *
 * REPAIR-ONLY (spec 016, Principle XV): a normal `bib acquire` now completes the
 * SSOT record inline (it runs this same idempotent status derivation as an
 * inseparable tail), so `bib reconcile` is NO LONGER required after acquiring a
 * member. It is retained for REPAIR -- pre-existing orphans (masters in the
 * store but `to-collect` status, from before the acquire-completion weld) and
 * recovery -- not as a routine post-acquire step.
 */
export async function runReconcileCli(rest: string[]): Promise<number> {
  let parsed: ReconcileCliArgs;
  try {
    parsed = parseReconcileArgs(rest);
  } catch (error) {
    console.error(`bib reconcile: ${describeError(error)}`);
    return 2;
  }
  const { id, archive, archiveRoot: archiveRootOverride } = parsed;

  if (id === undefined) {
    console.error('bib reconcile: missing required argument <id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = sourcesDirOf(repoRoot);
  const isMuseumCopy = selectedCopyHasRecordedAssets(sourcesDir, id, archive);
  try {
    let result: ReconcileResult;
    if (isMuseumCopy) {
      // Pure-B2 path: verify recorded assets against the real object store. No
      // archive root, no `gatherProvenance`, no layout overlay -- fail loud if
      // the store config is absent rather than silently reconciling nothing.
      result = await runReconcile({
        sourcesDir,
        sourceId: id,
        archive,
        objectStore: new S3ObjectStore(resolveObjectStoreConfig()),
      });
    } else {
      // Archive-provenance (Gallica) path: resolve the archive root and register
      // this member's layout BEFORE gathering -- `gatherProvenance` resolves the
      // source's slug via the synchronous, sourceId-only `sourceLayout(sourceId)`,
      // which throws for a source-group member absent this runtime overlay.
      const archiveRoot = resolveArchiveRoot(repoRoot, archiveRootOverride);
      registerMemberArchiveLayout(sourcesDir, id);
      result = await runReconcile({
        sourcesDir,
        archiveRoot,
        sourceId: id,
        archive,
        gather: gatherProvenance,
      });
    }
    const verb = result.changed ? 'reconciled' : 'already reconciled';
    // A record with declared `folios` (specs/012) is an excerpt: report the
    // counts against that declared set rather than implying a whole-document
    // holding.
    const masterLabel = result.folios !== undefined ? 'declared folio(s)' : 'master(s)';
    console.log(
      `bib reconcile: ${verb} ${result.sourceId} at "${result.sourceArchive}" -> ` +
        `${result.status} (${result.storedCount}/${result.pageCount} ${masterLabel} in object store)`,
    );
    return 0;
  } catch (error) {
    console.error(`bib reconcile: ${describeError(error)}`);
    return 1;
  }
}
