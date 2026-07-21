# Phase 1 Data Model: Acquire Completes the SSOT Record

No new persisted entities — this feature completes the EXISTING `RepositoryRecord` and adds one in-memory verdict type. No `any`/`as`/`@ts-ignore` (Principle VII).

## Completed fields on `RepositoryRecord` (existing type; this feature guarantees they are set)

| Field | Completion guarantee |
|-------|----------------------|
| `status` | Advanced by the reconcile tail to the correct acquired value: `archived` (all masters backed, B2-direct) or `collected` (Gallica per-page-provenance path). Never left at `to-collect` after a successful acquire. |
| `assets` | The mirrored masters recorded (already persisted by `runAcquire`; the verification confirms they are present and match the object store). |
| `metadataSnapshot` | Present where the adapter emits one (papers-past, museum); best-effort (absence not a failure for adapters that do not yet emit one). |

## `CompletenessVerdict` (in-memory, verifier output)

```
verifyRecordComplete(record: RepositoryRecord, ctx: { objectStore: ObjectStore; reconciled: { status; advanced } })
  -> { complete: true }
   | throws a descriptive Error naming the incompleteness (missing/mismatched master head, unadvanced status, ...)
```

The verifier is **pure over its injected inputs** (the object store is injected; no ambient globals). It fails loud (throws) rather than returning `{complete:false}` so `runAcquire` cannot accidentally proceed past an incomplete record.

## Per-repository completeness rules (the verifier's branch)

- **B2-direct** (record has ≥1 `page-master`/`primary` asset with an `objectStoreKey`): every such asset's key MUST HEAD present with `sha256 === asset.checksum`, AND `status` advanced to `archived`. Any missing/mismatched head or an unadvanced status → incomplete (throw).
- **Per-page-provenance** (Gallica, `assets: []`): the archive-provenance path is the master record (out of the object-store asset list); complete when reconcile advanced `status` to `collected`. An empty `assets` list is legitimate — NOT a failure.
- **metadataSnapshot**: if `record.metadataSnapshot` is expected for the adapter (papers-past/museum) it MUST be present; otherwise not checked.

## State transition (one acquire pass, XV-complete)

```
adapter.acquire -> assets (mirrored to B2)                     [existing]
  -> runAcquire persists assets + writes archive companions    [existing]
  -> runAcquire runs reconcile tail -> status advanced          [NEW: welded, was a separate bib reconcile]
  -> verifyRecordComplete(record, {objectStore, reconciled})    [NEW: per-repository]
       complete  -> return success (record fully reflects the held asset)
       incomplete -> THROW (fail-loud, naming the gap) — NO success reported
  -> [--dry-run] skips the tail + verification (nothing mirrored)
recovery: re-run acquire (idempotent head-then-put + re-persist + reconcile) -> completes, 0 duplicate writes
```
