import { loadAllSources } from '@/bibliography/load';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
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
  /** Archive root the provenance is gathered from (`COLONY_ARCHIVE_ROOT`). */
  archiveRoot: string;
  /** The member's Colony Cults id, e.g. `PB-P007`. */
  sourceId: string;
  /** Selects one RepositoryRecord when the member has more than one; infer-one otherwise. */
  archive?: string;
  /** Injected provenance gatherer (see {@link GatherProvenanceFn}). REQUIRED. */
  gather: GatherProvenanceFn;
}

/** Result of a reconcile: which record advanced and to what. */
export interface ReconcileResult {
  sourceId: string;
  /** The selected record's holding archive. */
  sourceArchive: string;
  /** The derived acquisition status the record now carries. */
  status: 'collected' | 'archived';
  /** Count of page-image masters found in the archive for this copy. */
  pageCount: number;
  /** How many of those masters carry an object-store handle. */
  storedCount: number;
  /** True when the authored status actually advanced (false on an idempotent re-run). */
  changed: boolean;
}

/** Fail loud on structurally malformed input before touching the filesystem. */
function assertWellFormed(input: ReconcileInput): void {
  if (input === null || typeof input !== 'object') {
    throw new Error('reconcile: input is required.');
  }
  if (typeof input.sourcesDir !== 'string' || input.sourcesDir.trim().length === 0) {
    throw new Error('reconcile: input.sourcesDir is required.');
  }
  if (typeof input.archiveRoot !== 'string' || input.archiveRoot.trim().length === 0) {
    throw new Error('reconcile: input.archiveRoot is required.');
  }
  if (typeof input.sourceId !== 'string' || input.sourceId.trim().length === 0) {
    throw new Error('reconcile: input.sourceId is required.');
  }
  if (typeof input.gather !== 'function') {
    throw new Error('reconcile: input.gather is required (the injected provenance gatherer).');
  }
}

/**
 * Reconcile one member's RepositoryRecord acquisition status from the
 * archive's per-page provenance:
 *
 * - page-image masters all object-store-backed -> `archived`
 * - some (but not all) backed, or fetched-but-not-uploaded -> `collected`
 *
 * Fails loud (writes nothing) when the member is unknown, has no record for
 * the selected archive, or has no page-image provenance at all (nothing was
 * acquired to reconcile).
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

  const provenance = await input.gather(input.sourceId, input.archiveRoot);
  const pageImages = provenance.filter(
    (asset) => asset.source_archive === sourceArchive && asset.type === 'page-image',
  );
  if (pageImages.length === 0) {
    throw new Error(
      `reconcile: no page-image provenance for "${input.sourceId}" at "${sourceArchive}" ` +
        `under "${input.archiveRoot}" -- nothing acquired to reconcile.`,
    );
  }

  const storedCount = pageImages.filter((asset) => asset.object_store !== null).length;
  const status: 'collected' | 'archived' =
    storedCount === pageImages.length ? 'archived' : 'collected';

  const target = entry.records.find((record) => record.sourceArchive === sourceArchive);
  if (target === undefined) {
    // Unreachable: `selected` was chosen from `entry.records` -- defensive.
    throw new Error(
      `reconcile: internal error -- selected archive "${sourceArchive}" not found among ` +
        `"${input.sourceId}"'s authored records.`,
    );
  }
  const changed = target.status !== status;

  const updatedRecords: AuthoredRepositoryRecord[] = entry.records.map((record) =>
    record.sourceArchive === sourceArchive ? { ...record, status } : record,
  );
  writeSourceFile(input.sourcesDir, { source: entry.source, records: updatedRecords });

  return {
    sourceId: input.sourceId,
    sourceArchive,
    status,
    pageCount: pageImages.length,
    storedCount,
    changed,
  };
}
