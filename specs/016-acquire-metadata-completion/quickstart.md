# Quickstart / Validation Guide: Acquire Completes the SSOT Record

Runnable scenarios proving XV completion. Details in [contracts/](./contracts) and [data-model.md](./data-model.md).

## Scenario 1 — A successful acquire advances status (unit, hermetic)

Drive `runAcquire` for a B2-direct member with fakes (fake `ObjectStore` heads present + matching, fake source writer). Expect: on success the record's `status` is `archived` (NOT `to-collect`), assets recorded, and NO separate reconcile was invoked. This is the core XV guarantee.

## Scenario 2 — Incomplete record fails loud (unit)

Fake the object store so a recorded master's head is absent (or checksum mismatched). Drive `runAcquire`. Expect: it THROWS a descriptive error naming the missing/mismatched key — it does NOT return success.

## Scenario 3 — Idempotent re-run heals + 0 duplicate writes (unit)

Given a record left incomplete by a prior run (assets recorded, status still `to-collect`), re-run `runAcquire`. Expect: status advances to `archived`, verification passes, and the fake object store records 0 duplicate `put`s (head-then-put idempotency).

## Scenario 4 — Per-repository completeness: Gallica empty-assets (unit)

Drive `runAcquire` for a Gallica-shaped record (`assets: []`, per-page archive provenance). Expect: completeness passes when reconcile advances `status` to `collected`; the verifier does NOT fail-loud on the empty asset list.

## Scenario 5 — Dry-run exemption (unit)

Drive `runAcquire` with `dryRun: true`. Expect: adapter mirrors nothing, the reconcile tail + completeness verification are skipped, and the run reports success with no status change and no writes.

## Scenario 6 — Standalone reconcile still repairs (unit)

Hand-break a record (masters in the fake store, status `to-collect`). Run the standalone `reconcile`. Expect: it advances the status (repair-only retention — the happy path no longer needs it).

## Scenario 7 — Live end-to-end (env-gated, operator acceptance)

Re-acquire the de Rays member `PB-P061` (or any B2-direct member) with archive/B2 configured: `bib acquire <member>`. Expect exit 0 AND `bib show <member>` immediately shows `status: archived` with NO separate `bib reconcile` — the regression that motivated this feature (PB-P061 stuck at `to-collect`) no longer occurs. Gated on the real archive/B2 config.

## Scenario 8 — Unit suite is hermetic

`npx vitest run tests/unit/sourcegroup/acquire-completeness.test.ts tests/unit/sourcegroup/acquire.test.ts` — all pass with injected fakes; 0 network calls; the real object store / host is never mutated (FR-010).
