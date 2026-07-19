import type { ObjectStore } from '@/archive/object-store';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * The per-repository completeness verifier `runAcquire` calls before reporting
 * success (Constitution Principle XV — no orphan assets;
 * specs/016-acquire-metadata-completion/contracts/completion.md). It answers
 * the single question "does the SSOT record FULLY reflect the bytes this
 * acquire holds?" and **fails loud** (throws a descriptive Error naming the
 * exact gap) rather than returning a boolean, so `runAcquire` cannot
 * accidentally proceed past an incomplete record (Principle V).
 *
 * It is PURE over its injected inputs: the object store is injected (a fake in
 * tests), the reconcile outcome is passed in, and it reads only the record. No
 * ambient globals, no network beyond the injected `ObjectStore.head`, no host
 * mutation.
 *
 * The completeness rule is **per-repository-appropriate** (clarified
 * 2026-07-19, FR-008), keyed on the RECORD's asset shape -- NEVER on adapter
 * identity, so the guarantee is source-agnostic across all four adapters:
 *
 * - **B2-direct** (the record carries object-store-keyed masters -- museum /
 *   internet-archive / papers-past): complete when the reconcile advanced
 *   `status` to `archived` AND every recorded master's `objectStoreKey` HEADs
 *   present with `sha256 === asset.checksum`.
 * - **Per-page-provenance** (Gallica, `assets: []`): the archive-provenance
 *   path is the master record, so an empty asset list is legitimate -- complete
 *   when the reconcile advanced `status` to an acquired value (`collected` /
 *   `archived`). NOT failed for producing no B2 assets.
 * - **`metadataSnapshot`**: best-effort per-adapter (FR-009) -- required present
 *   ONLY when the caller signals the adapter emitted a record-level snapshot
 *   ref (`ctx.expectsMetadataSnapshot`); an adapter that does not yet emit one
 *   is not failed for its absence (follow-on TASK-47 adds emission).
 */

/** The set of acquisition statuses that count as "advanced past to-collect". */
const ACQUIRED_STATUSES: ReadonlySet<string> = new Set(['collected', 'archived']);

/**
 * Context for {@link verifyRecordComplete}.
 *
 * `objectStore` is optional because it is only consulted on the B2-direct path
 * (a Gallica `assets: []` record never HEADs anything); the verifier fails loud
 * if a B2-direct record is verified without one, rather than silently skipping
 * the head check.
 */
export interface CompletenessContext {
  /** Injected object store; consulted only for B2-direct masters (HEAD-only). */
  objectStore?: ObjectStore;
  /** The just-run reconcile outcome (`{ status, advanced }`) the acquire tail produced. */
  reconciled: { status: string; advanced: boolean };
  /**
   * The EXPLICIT repository kind of the dispatched acquire, threaded from
   * `runAcquire` (which knows `adapter.repository`) so the verifier does NOT
   * re-derive the per-repository rule from `record.assets` shape alone
   * (AUDIT-20260719-04). `true` = B2-direct (museum / internet-archive /
   * papers-past): masters are object-store assets and MUST be present +
   * matching; a B2-direct acquire presenting ZERO masters is a fail-loud
   * incompleteness, NOT silently reinterpreted as the empty-assets Gallica
   * shape. `false` = per-page-provenance (Gallica): an empty asset list is
   * legitimate.
   *
   * REQUIRED (AUDIT-20260719-07): there is NO shape-inference fallback. A
   * fallback (`?? masters.length > 0`) would silently revert to the exact
   * false-negative AUDIT-04 closed for any caller that forgot to thread the
   * kind (Principle V -- no fallbacks: state the kind or it is a type error).
   */
  isB2Direct: boolean;
  /**
   * True when the adapter emitted a durable record-level `metadataSnapshot`
   * ref for this acquire (museum / papers-past / internet-archive); then the
   * record MUST carry `metadataSnapshot`. Absent/false => best-effort: the
   * snapshot is not required (the adapter does not yet emit one). Computed by
   * `runAcquire` from the adapter's `AcquisitionResult.metadataSnapshotRef` --
   * a boolean input, never a branch on adapter identity.
   */
  expectsMetadataSnapshot?: boolean;
}

/** The object-store-keyed masters recorded on a record (the B2-direct masters). */
function objectStoreMasters(record: RepositoryRecord): NonNullable<RepositoryRecord['assets']> {
  return (record.assets ?? []).filter(
    (asset) => typeof asset.objectStoreKey === 'string' && asset.objectStoreKey.length > 0,
  );
}

/**
 * Verify the record fully reflects the bytes this acquire holds; resolve when
 * complete, THROW a descriptive Error naming the incompleteness otherwise
 * (Principle XV / Principle V). See the module doc for the per-repository rule.
 */
export async function verifyRecordComplete(
  record: RepositoryRecord,
  ctx: CompletenessContext,
): Promise<void> {
  const where = `"${record.sourceId}" at "${record.sourceArchive}"`;
  const masters = objectStoreMasters(record);
  // The EXPLICIT kind the caller threaded -- NO shape-inference fallback
  // (AUDIT-20260719-07). An explicit B2-direct kind with ZERO recorded masters
  // is a fail-loud incompleteness (AUDIT-20260719-04) -- it must NOT be treated
  // as the empty-assets Gallica shape and resolve without HEADing anything.
  const b2Direct = ctx.isB2Direct;

  if (b2Direct) {
    if (masters.length === 0) {
      throw new Error(
        `acquire-completeness: ${where} is a B2-direct copy but recorded ZERO object-store ` +
          `masters -- refusing to report a complete acquire that mirrored no verifiable bytes ` +
          `(an empty B2-direct asset list is not the same as the Gallica per-page-provenance ` +
          `shape; Principle XV).`,
      );
    }
    // B2-direct: status must be advanced to `archived`, and EVERY recorded
    // master must be present in the object store with a matching checksum.
    if (ctx.reconciled.status !== 'archived') {
      throw new Error(
        `acquire-completeness: ${where} recorded ${masters.length} object-store master(s) ` +
          `but its acquisition status is "${ctx.reconciled.status}", not "archived" -- the ` +
          `record does not fully reflect the held bytes (Principle XV).`,
      );
    }
    if (ctx.objectStore === undefined) {
      throw new Error(
        `acquire-completeness: ${where} is a B2-direct copy but no object store was injected to ` +
          `verify its ${masters.length} recorded master(s) -- refusing to report a complete ` +
          `acquire that was never verified against the store (Principle XV).`,
      );
    }
    for (const asset of masters) {
      const head = await ctx.objectStore.head(asset.objectStoreKey);
      if (!head.exists) {
        throw new Error(
          `acquire-completeness: recorded master "${asset.objectStoreKey}" for ${where} is ` +
            `MISSING from the object store -- an acquire cannot be complete for bytes that ` +
            `are not present (Principle XV).`,
        );
      }
      if (head.sha256 === undefined || head.sha256 !== asset.checksum) {
        throw new Error(
          `acquire-completeness: object-store master "${asset.objectStoreKey}" for ${where} ` +
            `reports sha256 ${head.sha256 ?? '(none)'} but the recorded asset checksum is ` +
            `${asset.checksum} -- refusing to report a complete acquire for a changed or ` +
            `unverifiable master (Principle XV).`,
        );
      }
    }
  } else {
    // Per-page-provenance (Gallica, empty assets): the archive-provenance path
    // is the master record. Complete when reconcile advanced `status` to an
    // acquired value; an empty asset list is NOT a failure (FR-008).
    if (!ACQUIRED_STATUSES.has(ctx.reconciled.status)) {
      throw new Error(
        `acquire-completeness: ${where} acquired no object-store masters (per-page-provenance ` +
          `path) but its acquisition status is "${ctx.reconciled.status}" -- the ` +
          `archive-provenance reconcile did not advance it to an acquired state ` +
          `("collected"/"archived") (Principle XV).`,
      );
    }
  }

  // metadataSnapshot: required only where the adapter emits a record-level ref
  // (best-effort per-adapter, FR-009).
  if (ctx.expectsMetadataSnapshot === true && record.metadataSnapshot === undefined) {
    throw new Error(
      `acquire-completeness: ${where}'s adapter emitted a metadata snapshot but the record ` +
        `carries no metadataSnapshot -- the durable provenance reference was lost ` +
        `(Principle XV).`,
    );
  }
}
