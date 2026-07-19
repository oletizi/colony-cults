# Design: Acquire completes the SSOT record (Principle XV compliance)

**Date**: 2026-07-19
**Roadmap item**: `impl:feature/acquire-metadata-completion`
**Origin**: Constitution Principle XV (v1.4.0); backlog TASK-46 (feature-rigor); supersedes-history TASK-20 / TASK-21. Confirmed live 2026-07-19 (PB-P061).
**Design backend**: `superpowers:brainstorming` via `/stack-control:design`.

## Problem domain

Constitution Principle XV (Metadata Integrity Is Mechanically Enforced — No Orphan Assets) requires any process that retrieves an object or writes an asset to complete its durable SSOT metadata as an inseparable, structural, fail-loud part of the *same* operation. The acquire pipeline violates this:

- `runAcquire` (`src/sourcegroup/acquire.ts`, source-agnostic across gallica / new-italy-museum / internet-archive / papers-past) dispatches to the adapter, persists the returned `assets` onto the record, and writes archive companions — then **stops**.
- `RepositoryRecord.status` (to-collect → archived) is advanced only by a **separate** `bib reconcile` (`src/sourcegroup/reconcile.ts`) the operator must remember to run.
- **Live evidence (2026-07-19):** acquiring PB-P061 mirrored 3 GIF masters to B2 and recorded the assets, but left `status: to-collect` — the record read as unacquired until a manual `bib reconcile` advanced it to `archived`. The operator caught it ("it doesn't record the asset in metadata — that's the whole point").
- **Historical:** TASK-20 documented this on 2026-07-13; TASK-21 → `reconcile.ts` landed the reconcile *logic* but as a separable step, not welded into acquire. XV was added *because* of this recurring failure, making the split a constitutional defect.

The gap is at the `runAcquire` level, not per-adapter: a single fix makes every adapter compliant.

## Solution space

### Chosen — Weld reconcile into `runAcquire` as an inseparable, verified tail
After the adapter.acquire + persist-assets + write-companions block, `runAcquire` runs the reconcile status-advancement (reusing `reconcile.ts` — idempotent, B2-heads-only, no source re-fetch; `runAcquire` already holds the object-store config), then **verifies** the record is complete (assets recorded + status advanced + every recorded master's B2 head present with a matching checksum) before returning success. Any failure → fail loud (non-zero, naming what is incomplete); it never reports a successful acquire with an incomplete record. Recovery is an **idempotent re-run** (the adapter's head-then-put + `runAcquire`'s re-persist/reconcile complete the record with zero duplicate writes). Standalone `bib reconcile` is retained as a **repair** tool (pre-existing orphans, recovery), no longer required in the happy path.

- **Pro:** one source-agnostic change fixes all adapters; reuses existing reconcile logic (DRY); XV-compliant (completion is part of the success contract, fail-loud); no cross-store atomicity fiction; recoverable.
- **Con:** not literal B2+local atomicity — a mid-operation crash leaves a *recoverable* (not corrupt) state that a re-run heals.

### Rejected — Two-phase intent record (pending-first)
Write a `pending/acquiring` record to the SSOT before the B2 put, finalize after; guarantees a record exists even on a mid-put crash.
- **Rejected:** the asset checksum/key is unknown until *after* the fetch, so the pending record is partial, and it adds a new `pending` state + finalize step across the whole pipeline — more moving parts for a window the idempotent re-run already heals.

### Rejected — Reconcile-from-B2 sweep (discover orphans)
Leave acquire as-is; add a reconcile that scans B2 for objects with no SSOT record and reattaches them.
- **Rejected:** does NOT weld completion into acquire — the metadata update stays a separate step you must remember, so it is weaker on XV (a safety net, not a mechanism). Possibly useful as an *additional* repair capability, but not the primary fix.

## Decisions

1. **Fix at `runAcquire` (source-agnostic).** The reconcile tail + completeness verification live in `runAcquire`, so all four adapters are fixed by one change.
2. **Reuse `reconcile.ts`.** `runAcquire` calls the existing idempotent reconcile (B2-heads-only, no re-fetch) as the status-advancement tail; do not reinvent status derivation.
3. **Completion is the success contract + verified.** `runAcquire` returns success only after verifying the record is complete (assets + advanced status + B2 heads matching recorded checksums); otherwise fail loud, naming the incompleteness.
4. **Fail-loud + idempotent-rerun recovery** (operator-chosen, 2026-07-19). No cross-store atomicity fiction; a crash leaves a recoverable state healed by a re-run.
5. **Keep standalone `bib reconcile` as repair-only.** Retained for pre-existing orphans / recovery; removed from the required happy path.
6. **Capture-over-YAGNI: full metadata completeness.** The feature captures the whole XV surface — status advancement AND record-level `metadataSnapshot`/provenance completeness where an adapter can produce it — not only the status gap; the operator scopes at define time.

## Open questions (for `/speckit-clarify` at define)

- **Gallica path nuance:** the Gallica adapter returns `assets: []` (its masters are per-page archive provenance, reconciled via the archive-provenance path); reconcile yields `collected`, not `archived`, there. The completeness verification must check archive-provenance completeness on the Gallica path, NOT fail-loud a legitimately empty-assets Gallica acquire.
- **`metadataSnapshot` per adapter:** which adapters can produce a record-level `metadataSnapshotRef` today (papers-past does; museum has one; gallica / IA?) — is snapshot completeness in scope for THIS feature or a per-adapter follow-on?
- **Dry-run:** confirm `--dry-run` (mirrors nothing) is exempt from completeness verification (nothing was acquired to complete).
- **Verification depth:** re-head B2 for every master (authoritative, N head calls) vs. trust the just-run reconcile result (reconcile already heads). Lean: reuse the reconcile result.

## Provenance

- Constitution Principle XV (v1.4.0, 2026-07-19).
- Backlog TASK-46 (promoted to feature-rigor → `roadmap:impl:feature/acquire-metadata-completion`); historical TASK-20 (Done 2026-07-13) + TASK-21 (→ `reconcile.ts`).
- Live evidence: PB-P061 Papers Past acquire (2026-07-19) — assets recorded, status stuck at `to-collect` until a manual reconcile.
- Code: `src/sourcegroup/acquire.ts` (`runAcquire`); `src/sourcegroup/reconcile.ts` (idempotent status derivation, `{status, advanced}`).
- Design conversation: `/stack-control:design` (superpowers:brainstorming backend), 2026-07-19; operator chose fail-loud + idempotent-rerun recovery.
