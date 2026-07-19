# Phase 0 Research: Acquire Completes the SSOT Record

Resolves the design/how decisions; the two spec-level open questions were resolved at `/speckit-clarify` (per-repository completeness; best-effort metadataSnapshot).

## R1 — Reconcile as the inseparable status-advancement tail

**Decision.** `runAcquire` calls the existing `reconcile` (`src/sourcegroup/reconcile.ts`) as an inseparable tail after the persist-assets + write-companions block. Reconcile is already idempotent, derives status purely from committed provenance + `ObjectStore` HEADs (no source re-fetch), and returns `{status, advanced}`. `runAcquire` already holds the object-store config (it constructs it for the companion write), so the tail needs no new dependency.

**Rationale.** DRY (reconcile is the single source of status derivation, Principle VIII); B2-heads-only so the tail is cheap and safe; welding it into `runAcquire` makes status advancement part of the acquire operation (Principle XV) rather than a separate command.

**Alternatives considered.** Inline a second status-derivation in `runAcquire` (rejected — duplicates reconcile, drift risk). A post-hoc CLI wrapper that runs acquire-then-reconcile (rejected — still two steps the operator can split; not structural).

## R2 — Per-repository-appropriate completeness (clarify decision)

**Decision.** A small pure verifier `verifyRecordComplete(record, {objectStore, reconciled})` judges completeness by the record's repository shape:
- **B2-direct** (museum / internet-archive / papers-past): complete when `assets` are recorded, `status` advanced, and **every** recorded master's `objectStoreKey` HEADs present with a matching checksum.
- **Per-page-provenance** (Gallica, `assets: []`): complete when the archive-provenance path is complete and `status` advanced to `collected`; an empty `assets` list is NOT a failure.
- **`metadataSnapshot`**: verified **only where the adapter emits one** (papers-past, museum); absence is not a failure for an adapter that does not yet emit one (best-effort per-adapter; follow-on TASK-47).

**Rationale.** A universal "non-empty B2 asset list" check would fail a correct Gallica acquire; completeness must mean "complete FOR this repository kind."

**Alternatives considered.** Universal B2-asset check (rejected — wrong for Gallica). Exempt Gallica entirely (rejected — leaves that path without an XV guarantee).

## R3 — Fail-loud + idempotent-rerun recovery (no cross-store atomicity)

**Decision.** The object store (durable, external) and the local SSOT record cannot be atomically committed. So: `runAcquire` returns success ONLY after `verifyRecordComplete` passes; on any incompleteness it throws a descriptive error naming what is missing (fail-loud, Principle V). Recovery is an idempotent re-run — the adapter's content-addressed head-then-put + `runAcquire`'s re-persist + reconcile complete the record with zero duplicate writes.

**Rationale.** The operation's success contract INCLUDES the complete record; a crash leaves a recoverable (not corrupt) state a re-run heals. No atomicity fiction.

**Alternatives considered.** Two-phase pending record (rejected — asset checksum unknown until after fetch; adds a pending state). B2-orphan sweep (rejected — doesn't weld completion into acquire).

## R4 — Dry-run exemption + verification depth

**Decision.** `--dry-run` mirrors nothing (the adapters return empty assets under dry-run), so it is exempt from completeness verification — there is nothing acquired to complete. Verification depth trusts the just-run reconcile result (which already HEADs the object store); no separate re-head pass is added.

**Rationale.** Dry-run has no durable side effect to guarantee; reconcile's heads are authoritative, so re-heading would be redundant.
