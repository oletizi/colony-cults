import { runReconcile } from '@/sourcegroup/reconcile';
import { verifyRecordComplete } from '@/sourcegroup/acquire-completeness';
import { writeSourceFile } from '@/bibliography/source-writer';
import { writeRecordCompanions } from '@/archive/write-record-companions';
import type { CompanionObjectStore } from '@/archive/write-record-companions';
import type { AcquisitionResult, RepositoryAdapter } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Source } from '@/model/source';
import type { AcquireInput } from '@/sourcegroup/acquire';

/**
 * The post-acquire completion machinery for {@link runAcquire} (spec 016,
 * Constitution Principle XV -- NO ORPHAN ASSETS). Split out of
 * `src/sourcegroup/acquire.ts` to keep both files under the file-size cap
 * (Constitution VI); the orchestration order (preflight -> adapter.acquire ->
 * persist -> complete) still lives in `runAcquire`.
 */

/**
 * The completion tail's reconcile + verify, shared by both the
 * per-page-provenance (gallica) and B2-direct branches. Advances the record's
 * acquisition `status` via the idempotent {@link runReconcile} (heads-only; NO
 * source re-fetch -- the single source of status derivation, Principle VIII),
 * then confirms the record fully reflects the held bytes via {@link
 * verifyRecordComplete}, which throws (fail-loud) on any incompleteness.
 * Reconcile picks its own path from the persisted record's asset shape; the
 * caller has already asserted the path-appropriate machinery is present via
 * {@link preflightCompletion}, so a missing dependency here would be an internal
 * error, not a silent skip.
 */
async function completeAndVerify(
  input: AcquireInput,
  record: RepositoryRecord,
  acquisition: AcquisitionResult,
  isB2Direct: boolean,
): Promise<void> {
  const reconciled = await runReconcile({
    sourcesDir: input.sourcesDir,
    sourceId: input.sourceId,
    archive: input.archive,
    objectStore: input.completionObjectStore,
    archiveRoot: input.reconcileArchiveRoot,
    gather: input.gather,
  });

  // Verify the completed record. Build the just-acquired shape (the selected
  // record plus the mirrored assets + any adapter-emitted snapshot ref) rather
  // than re-loading, and pass reconcile's derived status as the authoritative
  // `reconciled` outcome.
  const completedRecord: RepositoryRecord = {
    ...record,
    ...(acquisition.assets.length > 0 ? { assets: acquisition.assets } : {}),
    ...(acquisition.metadataSnapshotRef !== undefined
      ? { metadataSnapshot: acquisition.metadataSnapshotRef }
      : {}),
  };
  await verifyRecordComplete(completedRecord, {
    objectStore: input.completionObjectStore,
    reconciled: { status: reconciled.status, advanced: reconciled.changed },
    // Explicit repository kind (AUDIT-20260719-04): the verifier must not
    // re-derive B2-direct-vs-Gallica from `record.assets` shape alone.
    isB2Direct,
    // Best-effort per-adapter (FR-009): require the record-level snapshot only
    // where the adapter actually emitted one.
    expectsMetadataSnapshot: acquisition.metadataSnapshotRef !== undefined,
  });
}

/**
 * PREFLIGHT the completion machinery BEFORE the adapter fetches/mirrors anything
 * (AUDIT-20260719-06). The path-required completion dependency is knowable from
 * the dispatched adapter's kind alone -- so validate it here, before
 * `adapter.acquire`'s durable side effects, rather than after. Failing
 * afterwards would have already written the orphan-prone state (page images /
 * provenance, or mirrored B2 masters) this feature exists to make impossible to
 * finish into -- and would have spent an external fetch the failed command
 * discards. `--dry-run` mirrors nothing, so it is exempt.
 */
export function preflightCompletion(adapter: RepositoryAdapter, input: AcquireInput): void {
  if (input.dryRun === true) {
    return;
  }
  const isB2Direct = adapter.repository !== 'gallica';
  if (!isB2Direct) {
    if (input.reconcileArchiveRoot === undefined || input.gather === undefined) {
      throw new Error(
        `acquire: a non-dry-run ${adapter.repository} acquire requires reconcileArchiveRoot + ` +
          `gather to complete the SSOT record (advance status from the archive's per-page ` +
          `provenance) -- refusing to FETCH a copy whose acquisition status could never be ` +
          `advanced (Principle XV).`,
      );
    }
  } else if (input.completionObjectStore === undefined) {
    throw new Error(
      `acquire: a non-dry-run ${adapter.repository} acquire requires a completionObjectStore ` +
        `to complete + verify any mirrored masters -- refusing to MIRROR object-store bytes ` +
        `the SSOT record could never confirm (Principle XV).`,
    );
  }
}

/**
 * Persist the adapter's durable record-level output back onto the SELECTED
 * record in the SSOT (TASK-30, spec 011 T005/T030), and write the B2-direct
 * masters' archive companions (the discovery layer, spec 013).
 *
 * Persists whenever the adapter produced ANY durable output -- mirrored masters
 * OR an authored `metadataSnapshotRef`. Gating the whole persist on
 * `assets.length > 0` would drop a `metadataSnapshotRef` an adapter emitted with
 * zero masters, leaving the durable snapshot unrecorded in the SSOT (the orphan
 * AUDIT-20260720-01 named). Companions are written only for mirrored masters. A
 * Gallica acquire returns `assets: []` and writes its own companions via the
 * fetcher, so this is a no-op for it; a `--dry-run` mirrors nothing, so nothing
 * is persisted (TASK-29).
 */
export async function persistAcquisition(params: {
  sourcesDir: string;
  source: Source;
  authoredRecords: AuthoredRepositoryRecord[];
  record: RepositoryRecord;
  acquisition: AcquisitionResult;
  companionArchiveRoot?: string;
  companionObjectStore?: CompanionObjectStore;
}): Promise<void> {
  const { sourcesDir, source, authoredRecords, record, acquisition } = params;
  const hasDurableOutput =
    acquisition.assets.length > 0 || acquisition.metadataSnapshotRef !== undefined;
  if (!hasDurableOutput) {
    return;
  }

  const updatedRecords = authoredRecords.map((authored) =>
    authored.sourceArchive === record.sourceArchive
      ? {
          ...authored,
          // Durable record-level provenance the adapter authored (SC-003):
          // written only when the adapter produced it (Gallica/museum leave
          // these unset, so `...authored` preserves whatever was there).
          ...(acquisition.assets.length > 0 ? { assets: acquisition.assets } : {}),
          ...(acquisition.qualityAssessment !== undefined
            ? { qualityAssessment: acquisition.qualityAssessment }
            : {}),
          ...(acquisition.excludedLeaves !== undefined
            ? { excludedLeaves: acquisition.excludedLeaves }
            : {}),
          ...(acquisition.metadataSnapshotRef !== undefined
            ? { metadataSnapshot: acquisition.metadataSnapshotRef }
            : {}),
        }
      : authored,
  );
  writeSourceFile(sourcesDir, { source, records: updatedRecords });

  if (
    acquisition.assets.length > 0 &&
    params.companionArchiveRoot !== undefined &&
    params.companionObjectStore !== undefined
  ) {
    const acquiredRecord: RepositoryRecord = {
      ...record,
      assets: acquisition.assets,
      ...(acquisition.qualityAssessment !== undefined
        ? { qualityAssessment: acquisition.qualityAssessment }
        : {}),
      ...(acquisition.excludedLeaves !== undefined
        ? { excludedLeaves: acquisition.excludedLeaves }
        : {}),
    };
    await writeRecordCompanions({
      source,
      record: acquiredRecord,
      archiveRoot: params.companionArchiveRoot,
      objectStore: params.companionObjectStore,
      now: acquisition.qualityAssessment?.assessedAt ?? new Date().toISOString(),
    });
  }
}

/**
 * Complete the SSOT record as an INSEPARABLE part of the acquire (Principle XV):
 * reconcile status + verify. `runAcquire` returns success ONLY after this
 * passes; any incompleteness throws (fail-loud), naming the gap.
 *
 * The completion path is chosen by the DISPATCHED ADAPTER'S KIND -- an explicit
 * signal (AUDIT-20260719-01/02), never inferred from `assets.length` alone:
 *   - `gallica` is per-page-provenance (`assets: []`), reconciled from the
 *     archive under `reconcileArchiveRoot` via `gather`.
 *   - every other adapter (new-italy-museum / internet-archive / papers-past)
 *     is B2-direct, reconciled + verified against `completionObjectStore`.
 * A NEW per-page-provenance-style adapter MUST be added to the gallica branch.
 *
 * `--dry-run` is exempt. The only safe no-op is a B2-direct outcome the adapter
 * AFFIRMED `complete: true` with ZERO masters (the documented catalog-only /
 * metadata-only shape, e.g. the museum HTML-only path): there are no
 * object-store bytes to orphan. A zero-master B2-direct outcome the adapter did
 * NOT affirm complete fails loud (AUDIT-20260720-05).
 */
export async function completeAcquisition(
  input: AcquireInput,
  record: RepositoryRecord,
  adapter: RepositoryAdapter,
  acquisition: AcquisitionResult,
): Promise<void> {
  if (input.dryRun === true) {
    return;
  }
  const isB2Direct = adapter.repository !== 'gallica';
  if (!isB2Direct) {
    // Per-page-provenance (Gallica): reconcile the fetched copy to its acquired
    // status. The required machinery was validated in the preflight.
    await completeAndVerify(input, record, acquisition, false);
  } else if (acquisition.assets.length > 0) {
    // B2-direct with mirrored masters: complete + verify those object-store
    // bytes (completionObjectStore validated in the preflight).
    await completeAndVerify(input, record, acquisition, true);
  } else if (acquisition.complete !== true) {
    // B2-direct, ZERO masters, and the adapter did NOT affirm completeness -- an
    // incomplete acquire, not a legitimate catalog-only outcome (AUDIT-20260720-05).
    throw new Error(
      `acquire: ${adapter.repository} acquire produced ZERO object-store masters and did not ` +
        `report the item complete (complete: ${String(acquisition.complete)}) -- refusing to ` +
        `report a successful acquire for a copy that mirrored nothing and is not a deliberate ` +
        `catalog-only outcome (Principle XV).`,
    );
  }
  // else: a B2-direct outcome the adapter AFFIRMED complete with ZERO masters --
  // the documented catalog-only / metadata-only shape (e.g. the New Italy Museum
  // HTML-only path). No object-store bytes to orphan; `persistAcquisition`
  // already recorded any `metadataSnapshotRef` (AUDIT-20260720-01). Nothing to
  // reconcile/HEAD, and it is NOT misrouted into the Gallica provenance path
  // (AUDIT-20260719-02). Status stays as authored (no master was collected).
}
