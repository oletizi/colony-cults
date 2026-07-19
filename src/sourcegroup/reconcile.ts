import { loadAllSources } from '@/bibliography/load';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { ObjectStore } from '@/archive/object-store';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Reconcile a member's SSOT `RepositoryRecord.status` with the archive's
 * per-asset provenance after an acquisition (TASK-21). This closes the
 * spec/impl gap TASK-20 found: `specs/006-source-group-acquisition/
 * contracts/cli-commands.md` line 64 promises acquire "Advances the
 * RepositoryRecord acquisition status via the fetcher's existing path", but
 * the fetcher only writes masters to the object store + per-page provenance
 * into the archive -- it never advances the code-repo SSOT. `runReconcile`
 * DERIVES the acquisition status from that already-committed provenance and
 * writes it back, so it works for members acquired out-of-band (e.g.
 * PB-P007..P011 fetched upstream) WITHOUT re-fetching.
 *
 * The object_store HANDLE itself is not persisted onto the authored record:
 * `AuthoredRepositoryRecord` has no storage field by design, and
 * `deriveModel` (`@/bibliography/derive`) already attaches the derived
 * `manifest.objectStore` at read time from the same provenance. This module
 * therefore folds provenance into the one authored field it owns -- `status`.
 *
 * Idempotent: the status is a pure function of the provenance, and
 * `writeSourceFile`'s serialization is deterministic, so a re-run on unchanged
 * provenance re-writes byte-identical YAML.
 *
 * Do NOT use `bib migrate` for this: migrate rebuilds the SSOT from the frozen
 * legacy CSVs + a stale archive register (TASK-8), which would corrupt the
 * source-group model.
 *
 * REPAIR-ONLY (spec 016, Principle XV): standalone `bib reconcile` is no longer
 * required after a normal `bib acquire`. `runAcquire` now runs this exact
 * idempotent status derivation as an inseparable completion tail
 * (`src/sourcegroup/acquire.ts`), so the happy path completes the SSOT record
 * inline. This module is retained as a REPAIR tool -- for pre-existing orphans
 * (records that predate the weld, with masters in the store but `to-collect`
 * status) and recovery -- not as a step in the normal acquisition flow. The
 * logic here is unchanged; only its role narrowed.
 */

/**
 * The provenance gatherer, injected so tests never touch a real archive on
 * disk (mirroring `runAcquire`'s injected fetcher). Production wiring passes
 * `gatherProvenance` (`@/bibliography/derive`) straight through.
 */
export type GatherProvenanceFn = (
  sourceId: string,
  archiveRoot: string,
) => Promise<AssetProvenance[]>;

/** Input to {@link runReconcile}. */
export interface ReconcileInput {
  /** Directory holding the one-file-per-source SSOT (`bibliography/sources`). */
  sourcesDir: string;
  /**
   * Archive root the Gallica per-page provenance is gathered from
   * (`COLONY_ARCHIVE_ROOT`). REQUIRED for the archive-provenance (Gallica)
   * path; NOT required for the pure-B2 museum path (a record carrying
   * `assets`), whose truth is the object store + the recorded asset, not any
   * file under the archive root. Optional here so a museum reconcile never has
   * to configure a private archive worktree.
   */
  archiveRoot?: string;
  /** The member's Colony Cults id, e.g. `PB-P007`. */
  sourceId: string;
  /** Selects one RepositoryRecord when the member has more than one; infer-one otherwise. */
  archive?: string;
  /**
   * Injected provenance gatherer (see {@link GatherProvenanceFn}). REQUIRED for
   * the archive-provenance (Gallica) path; unused on the museum path.
   */
  gather?: GatherProvenanceFn;
  /**
   * Injected object store (`@/archive/object-store`). REQUIRED for the museum
   * path (a record carrying `assets`), which verifies each recorded asset's
   * `objectStoreKey` heads present with a matching checksum; unused on the
   * Gallica path. Injected so tests pass a fake that never touches B2.
   */
  objectStore?: ObjectStore;
}

/** Result of a reconcile: which record advanced and to what. */
export interface ReconcileResult {
  sourceId: string;
  /** The selected record's holding archive. */
  sourceArchive: string;
  /**
   * The acquisition status the record now carries. `archived` when every
   * master is backed; otherwise the not-overstated status (`collected` on the
   * Gallica path, or the record's unchanged authored status when a museum
   * asset is still missing from the store).
   */
  status: string;
  /**
   * Count of masters considered for this copy: page-image masters found in the
   * archive (Gallica path), or recorded {@link AcquiredAsset}s (museum path).
   */
  pageCount: number;
  /**
   * How many of those masters are backed: carry an object-store handle
   * (Gallica), or head present-and-checksum-matching in the object store
   * (museum).
   */
  storedCount: number;
  /** True when the authored status actually advanced (false on an idempotent re-run). */
  changed: boolean;
  /**
   * The record's authored `folios` (specs/012), when it carries one -- the
   * excerpt is exactly these folio numbers of the document at `identifiers`'
   * ark. Present ⇒ `pageCount`/`storedCount` above are counted against this
   * declared set, not the whole document's page-image provenance. Absent ⇒
   * a whole-document holding (unchanged default behavior).
   */
  folios?: number[];
}

/** Fail loud on structurally malformed input before touching the filesystem. */
function assertWellFormed(input: ReconcileInput): void {
  if (input === null || typeof input !== 'object') {
    throw new Error('reconcile: input is required.');
  }
  if (typeof input.sourcesDir !== 'string' || input.sourcesDir.trim().length === 0) {
    throw new Error('reconcile: input.sourcesDir is required.');
  }
  if (typeof input.sourceId !== 'string' || input.sourceId.trim().length === 0) {
    throw new Error('reconcile: input.sourceId is required.');
  }
  // `archiveRoot`/`gather` (Gallica) and `objectStore` (museum) are validated
  // per-path AFTER record selection -- which path applies is a function of the
  // selected record's `assets`, unknowable here (see `runReconcile`).
}

/** The number of masters backed + the derived status for one reconcile path. */
interface PathOutcome {
  /** Total masters considered (page images, or recorded assets). */
  pageCount: number;
  /** How many of those are backed (object-store handle, or head-verified). */
  storedCount: number;
  /**
   * The status the record should carry. `undefined` means "do not change the
   * authored status" -- the museum path uses this when a recorded asset is
   * still missing from the store, so reconcile never overstates progress.
   */
  status: string | undefined;
}

/** Matches the fetcher's per-folio image basename, e.g. `f048.jpg` -> `48`. */
const FOLIO_BASENAME_PATTERN = /^f(\d+)\.\w+$/;

/**
 * Extracts the folio number a page-image asset's `local_path` was written
 * for (specs/012), by matching the fetcher's `fNNN.<ext>` basename
 * convention (mirrors `browser/load/pages.ts`'s `IMAGE_PATTERN` and
 * `browser/load/books.ts`'s `FOLIO_SIDECAR_PATTERN`, the same convention
 * applied to companion asset provenance rather than folio sidecars).
 * `undefined` for a `local_path` that does not follow the convention -- such
 * an asset cannot be attributed to a declared folio, so it is excluded from
 * excerpt verification rather than guessed at.
 */
function folioNumberFromLocalPath(localPath: string): number | undefined {
  const basename = localPath.split('/').pop() ?? '';
  const match = FOLIO_BASENAME_PATTERN.exec(basename);
  return match === null ? undefined : Number.parseInt(match[1], 10);
}

/**
 * Gallica (archive-provenance) path: derive status from the per-page masters
 * the fetcher wrote under the archive root.
 *
 * - page-image masters all object-store-backed -> `archived`
 * - some (but not all) backed, or fetched-but-not-uploaded -> `collected`
 *
 * `declaredFolios` (specs/012): when the record carries an authored `folios`
 * excerpt, verification is scoped to exactly those folio numbers -- the
 * denominator is the DECLARED count, not however many page-image masters
 * happen to exist for the whole document, so a partially-fetched sibling
 * folio outside the excerpt never inflates or depresses the excerpt's own
 * completeness. A declared folio with no matching page-image provenance at
 * all simply does not count as stored (never overstated). `undefined` means
 * a whole-document holding -- unchanged default behavior.
 *
 * Requires the injected `archiveRoot` + `gather`; fails loud (writes nothing)
 * when either is absent, or when the copy has no page-image provenance at all
 * (nothing was acquired to reconcile).
 */
async function reconcileFromArchiveProvenance(
  input: ReconcileInput,
  sourceArchive: string,
  declaredFolios: number[] | undefined,
): Promise<PathOutcome> {
  if (typeof input.archiveRoot !== 'string' || input.archiveRoot.trim().length === 0) {
    throw new Error(
      `reconcile: input.archiveRoot is required to reconcile "${input.sourceId}" at ` +
        `"${sourceArchive}" from archive provenance (the Gallica path).`,
    );
  }
  if (typeof input.gather !== 'function') {
    throw new Error(
      'reconcile: input.gather is required (the injected provenance gatherer) for the ' +
        'archive-provenance path.',
    );
  }
  const archiveRoot = input.archiveRoot;

  const provenance = await input.gather(input.sourceId, archiveRoot);
  const pageImages = provenance.filter(
    (asset) => asset.source_archive === sourceArchive && asset.type === 'page-image',
  );
  if (pageImages.length === 0) {
    throw new Error(
      `reconcile: no page-image provenance for "${input.sourceId}" at "${sourceArchive}" ` +
        `under "${archiveRoot}" -- nothing acquired to reconcile.`,
    );
  }

  if (declaredFolios === undefined) {
    const storedCount = pageImages.filter((asset) => asset.object_store !== null).length;
    return {
      pageCount: pageImages.length,
      storedCount,
      status: storedCount === pageImages.length ? 'archived' : 'collected',
    };
  }

  const backedByFolio = new Map<number, boolean>();
  for (const asset of pageImages) {
    const folio = folioNumberFromLocalPath(asset.local_path);
    if (folio !== undefined) {
      backedByFolio.set(folio, asset.object_store !== null);
    }
  }
  const storedCount = declaredFolios.filter((folio) => backedByFolio.get(folio) === true).length;
  return {
    pageCount: declaredFolios.length,
    storedCount,
    status: storedCount === declaredFolios.length ? 'archived' : 'collected',
  };
}

/**
 * Museum (pure-B2) path: verify each recorded {@link AcquiredAsset} against the
 * object store via `objectStore.head(asset.objectStoreKey)`. An asset counts as
 * backed only when it heads present AND the store's `sha256` matches the
 * recorded `checksum`. When every recorded asset is backed the record advances
 * to `archived`; when one is still missing the record's status is left
 * unchanged (never overstated). A present-but-checksum-MISMATCHED object is a
 * changed/wrong master -- fail loud, write nothing.
 *
 * Requires the injected `objectStore`; fails loud when absent.
 */
async function reconcileFromObjectStore(
  input: ReconcileInput,
  sourceArchive: string,
  assets: AcquiredAsset[],
  currentStatus: string,
): Promise<PathOutcome> {
  if (input.objectStore === undefined) {
    throw new Error(
      `reconcile: input.objectStore is required to reconcile "${input.sourceId}" at ` +
        `"${sourceArchive}" -- its ${assets.length} recorded asset(s) are verified ` +
        `against the object store (the museum path).`,
    );
  }
  const objectStore = input.objectStore;

  let storedCount = 0;
  for (const asset of assets) {
    const head = await objectStore.head(asset.objectStoreKey);
    if (!head.exists) {
      continue;
    }
    if (head.sha256 !== undefined && head.sha256 !== asset.checksum) {
      throw new Error(
        `reconcile: checksum MISMATCH for "${input.sourceId}" at "${sourceArchive}" -- ` +
          `object "${asset.objectStoreKey}" reports sha256 ${head.sha256} but the recorded ` +
          `asset checksum is ${asset.checksum}. Refusing to reconcile a changed/wrong master.`,
      );
    }
    if (head.sha256 === undefined) {
      // Present but unverifiable (no sha256 metadata): cannot confirm identity,
      // so it does NOT count as backed -- reconcile never overstates progress.
      continue;
    }
    storedCount += 1;
  }

  const allBacked = storedCount === assets.length;
  return {
    pageCount: assets.length,
    storedCount,
    // Advance to `archived` only when every recorded master is present +
    // matching; otherwise leave the authored status untouched (`undefined`).
    status: allBacked ? 'archived' : undefined,
  };
}

/**
 * Reconcile one member's RepositoryRecord acquisition status. Two paths,
 * chosen by the selected record's shape:
 *
 * - a record carrying `assets` (the museum/B2 case) is reconciled by verifying
 *   each recorded asset's `objectStoreKey` against the injected object store;
 * - otherwise (the Gallica case) status is derived from the archive's per-page
 *   provenance under the archive root.
 *
 * Fails loud (writes nothing) when the member is unknown, has no record for the
 * selected archive, the path's required dependency is absent, or a museum
 * asset's stored checksum mismatches the recorded one.
 */
export async function runReconcile(input: ReconcileInput): Promise<ReconcileResult> {
  assertWellFormed(input);

  const loaded = loadAllSources(input.sourcesDir);
  const entry = loaded.find((l) => l.source.sourceId === input.sourceId);
  if (entry === undefined) {
    throw new Error(`reconcile: unknown sourceId "${input.sourceId}".`);
  }

  // `selectRepositoryRecord` only reads `sourceArchive`; thread `sourceId`
  // back in (the authored on-disk shape omits it) to satisfy the type.
  const candidates: RepositoryRecord[] = entry.records.map((record) => ({
    ...record,
    sourceId: input.sourceId,
  }));
  const selected = selectRepositoryRecord(candidates, input.archive);
  const sourceArchive = selected.sourceArchive;

  const target = entry.records.find((record) => record.sourceArchive === sourceArchive);
  if (target === undefined) {
    // Unreachable: `selected` was chosen from `entry.records` -- defensive.
    throw new Error(
      `reconcile: internal error -- selected archive "${sourceArchive}" not found among ` +
        `"${input.sourceId}"'s authored records.`,
    );
  }

  // Path selection: a record with recorded object-store assets reconciles
  // against the store; otherwise it reconciles from archive provenance. The
  // museum acquire (TASK-30) writes those `assets`, so a museum copy no longer
  // falls through to the archive path (which would have no page-image
  // provenance and fail "nothing acquired to reconcile").
  const outcome: PathOutcome =
    target.assets !== undefined && target.assets.length > 0
      ? await reconcileFromObjectStore(input, sourceArchive, target.assets, target.status)
      : await reconcileFromArchiveProvenance(input, sourceArchive, target.folios);

  const nextStatus = outcome.status ?? target.status;
  const changed = target.status !== nextStatus;

  // Preserve every other authored field on the rewritten record -- notably
  // `folios` (specs/012): reconcile only ever advances `status`, so a full
  // spread of the loaded record (not a hand-picked field list) is what keeps
  // the excerpt's declared folios from being silently dropped on rewrite.
  const updatedRecords: AuthoredRepositoryRecord[] = entry.records.map((record) =>
    record.sourceArchive === sourceArchive ? { ...record, status: nextStatus } : record,
  );
  writeSourceFile(input.sourcesDir, { source: entry.source, records: updatedRecords });

  const result: ReconcileResult = {
    sourceId: input.sourceId,
    sourceArchive,
    status: nextStatus,
    pageCount: outcome.pageCount,
    storedCount: outcome.storedCount,
    changed,
  };
  return target.folios !== undefined ? { ...result, folios: target.folios } : result;
}
