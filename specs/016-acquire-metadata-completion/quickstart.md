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

## Scenario 7 — Live end-to-end (env-gated, operator acceptance) — MANUAL

Re-acquire the de Rays member `PB-P061` (or any B2-direct member) with archive/B2 configured:

```bash
bib acquire PB-P061          # exit 0
bib show PB-P061             # RepositoryRecord status: archived (NOT to-collect)
```

Expect exit 0 AND `bib show PB-P061` **immediately** shows `status: archived` with **NO** separate `bib reconcile` — the regression that motivated this feature (PB-P061 acquired 2026-07-19 stuck at `to-collect` with 3 masters already in B2) no longer occurs. The CLI now wires the completion tail (`src/cli/bib-sourcegroup-acquire.ts`: a B2-direct acquire passes a real `S3ObjectStore` as `completionObjectStore`; a Gallica acquire passes `reconcileArchiveRoot` + `gatherProvenance`), so `runAcquire` advances + verifies the record inline.

This scenario is a **manual operator acceptance**: it mutates the real object store / SSOT and requires live archive/B2 credentials, so it is NOT part of the hermetic suite and is not run by the coding agent. Run it once against a real member to bless the end-to-end path.

## Scenario 8 — Unit suite is hermetic

`npx vitest run src/sourcegroup/acquire-completeness.test.ts src/sourcegroup/acquire.test.ts` — all pass with injected fakes; 0 network calls; the real object store / host is never mutated (FR-010). (Tests are colocated under `src/sourcegroup/`, the repo convention, not a separate `tests/unit/` tree.)
