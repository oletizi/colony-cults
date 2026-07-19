# Tasks: Acquire Completes the SSOT Record (Metadata Integrity)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Origin**: TASK-46 / Constitution Principle XV

## Format: `[ID] [P?] [Story?] [tier:X] Description with file path`

Tests are requested (FR-010 — the fail-loud + idempotent-recovery branches are mandatory coverage) → test-first (RED→GREEN). Tier labels: `fast` (haiku), `balanced` (sonnet), `powerful` (opus).

## Phase 1: Setup

- [X] T001 [tier:fast] Confirm the target files exist and read their current shapes before editing: `src/sourcegroup/acquire.ts` (`runAcquire` orchestration + the `if (acquisition.assets.length > 0)` persist block), `src/sourcegroup/reconcile.ts` (exported reconcile fn returning `{status, advanced}`, its `ReconcileInput`/`ObjectStore`), `src/archive/object-store.ts` (`ObjectStore.head`), and `@/model/repository-record` (`RepositoryRecord`, `AcquiredAsset`, status vocabulary). No code change — establish the exact reuse seams for T004.

## Phase 2: Foundational (the pure completeness verifier — blocks the welding)

- [X] T002 [tier:balanced] Write the verifier unit test in tests/unit/sourcegroup/acquire-completeness.test.ts (RED): importing `verifyRecordComplete` from `@/sourcegroup/acquire-completeness`, assert — a B2-direct record with all masters' fake heads present + matching checksum and status `archived` RESOLVES; a missing head THROWS naming the key; a mismatched-checksum head THROWS; a Gallica-shaped record (`assets: []`) with reconciled status `collected` RESOLVES (NOT failed for empty assets); a record whose adapter emits a `metadataSnapshot` but lacks it THROWS, while an adapter that emits none RESOLVES.
- [X] T003 [tier:powerful] Implement `verifyRecordComplete(record, { objectStore, reconciled })` in src/sourcegroup/acquire-completeness.ts (GREEN) — pure over injected inputs, per-repository branching: B2-direct (every `page-master`/`primary` `objectStoreKey` `objectStore.head` present with `sha256 === asset.checksum`, and `reconciled.status === 'archived'`); per-page-provenance Gallica (`assets: []` → require `reconciled.status === 'collected'`, no object-store assets); `metadataSnapshot` best-effort (present-required only where the adapter emits one). Throw a descriptive Error naming the exact incompleteness (fail-loud, Principle V). File ≤ 500 lines; no `any`/`as`/`@ts-ignore`.

## Phase 3: User Story 1 — A successful acquire advances status (P1) 🎯 MVP

**Goal**: A normal `bib acquire` leaves the record complete (status advanced) with no separate reconcile.
**Independent test**: drive `runAcquire` for a B2-direct member with fakes → on success the record status is `archived` (not `to-collect`), the reconcile tail ran, and verification passed.

- [X] T004 [US1] [tier:balanced] Extend tests/unit/sourcegroup/acquire.test.ts (RED): `runAcquire` for a B2-direct member (fake `ObjectStore` heads present+match, fake source writer) → on success assert the persisted record's `status` is `archived` (NOT `to-collect`), and that status advanced WITHOUT a separate `reconcile` invocation (the tail ran inside `runAcquire`).
- [X] T005 [US1] [tier:powerful] Weld the reconcile status-advancement tail into `runAcquire` (src/sourcegroup/acquire.ts): after the existing persist-assets + write-companions block (and NOT under `ctx.dryRun`), run the idempotent `reconcile` (reuse `src/sourcegroup/reconcile.ts`, heads-only, reusing the object-store config `runAcquire` already resolves for companions) to advance `status`; persist the advanced status back to the SSOT record. GREEN for T004. No source re-fetch.

**Checkpoint**: US1 is the shippable MVP — a normal acquire advances status inline.

## Phase 4: User Story 2 — Incomplete fails loud; re-run heals (P2)

**Goal**: acquire never reports success with an incomplete record; a re-run heals idempotently.
**Independent test**: inject an absent/mismatched head → `runAcquire` throws naming the gap; re-run an assets-recorded-but-unadvanced record → completes, 0 duplicate writes.

- [X] T006 [US2] [tier:balanced] Extend acquire.test.ts (RED): (a) a record whose fake head is absent/mismatched → `runAcquire` THROWS naming the incompleteness and does NOT report success; (b) idempotent re-run — given a record with assets recorded but status `to-collect`, re-running `runAcquire` advances status to `archived` and the fake `ObjectStore` records 0 duplicate `put`s; (c) `--dry-run` skips the tail + verification (0 status change, 0 writes, reports success).
- [X] T007 [US2] [tier:powerful] Wire the completeness verification into `runAcquire` (src/sourcegroup/acquire.ts): after the reconcile tail (and NOT under `ctx.dryRun`), call `verifyRecordComplete(record, { objectStore, reconciled })`; propagate its fail-loud throw (non-zero at the CLI) so `runAcquire` returns success ONLY when the record is complete. Confirm the re-run path stays idempotent (reconcile `advanced:false` + verifier passes, 0 writes). GREEN for T006.

## Phase 5: User Story 3 — Source-agnostic + reconcile repair-only (P3)

**Goal**: the guarantee holds for every adapter shape via the shared path; standalone reconcile is repair-only.
**Independent test**: a Gallica-shaped (`assets: []`) record completes via status `collected`; a B2-direct record via heads; standalone `reconcile` still repairs a hand-broken record.

- [X] T008 [US3] [tier:balanced] Test source-agnostic coverage in acquire-completeness.test.ts / acquire.test.ts: the verifier branches on the RECORD's asset shape (not adapter identity) — a Gallica-shaped `assets: []` record completes via reconciled `collected`; museum/internet-archive/papers-past-shaped records complete via B2 heads. Confirm no per-adapter code path in `runAcquire`.
- [X] T009 [P] [US3] [tier:fast] Document that standalone `bib reconcile` is REPAIR-ONLY (no longer required after a normal acquire — the happy path completes inline) via a doc-comment note in src/sourcegroup/reconcile.ts and the `bib reconcile` CLI help; no behavior change to reconcile itself.

## Phase 6: Polish & Cross-Cutting

- [X] T010 [tier:balanced] Run `npx tsc --noEmit` + `npx vitest run tests/unit/sourcegroup/acquire-completeness.test.ts tests/unit/sourcegroup/acquire.test.ts` and fix any type/lint/size issues (no `any`/`as`/`@ts-ignore`; files ≤ 500 lines; split if needed). Also run the broader `npx vitest run src/sourcegroup` to confirm no regression to the existing acquire/reconcile suites.
- [X] T011 [P] [tier:fast] Add the quickstart Scenario 7 live-acceptance note to quickstart.md confirming a real re-acquire of PB-P061 shows `status: archived` in `bib show` with NO separate `bib reconcile` (the motivating regression is gone).

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002→T003)** → **US1 (T004→T005)** → **US2 (T006→T007)** → **US3 (T008,T009)** → **Polish (T010,T011)**.
- T002 (verifier test) precedes T003 (verifier impl). T003 (verifier) precedes T007 (wiring it into runAcquire). T004 precedes T005; T006 precedes T007. T005 (reconcile tail) precedes T007 (verification after the tail).

## Parallel Opportunities

- Foundational: T002 authored, then T003 (same module — sequential).
- US2: T009 (reconcile doc) is [P] with the US3 work. Polish: T011 [P] with T010.
- The verifier (T003) and the runAcquire welding (T005/T007) touch DIFFERENT files (acquire-completeness.ts vs acquire.ts), but T007 depends on T003 — so verifier first, then wiring.

## Implementation Strategy

MVP = US1 (T001–T005): a normal acquire advances status inline (the visible XV fix). US2 adds the fail-loud + idempotent-recovery guarantee; US3 the source-agnostic coverage + reconcile-repair-only framing; Polish the type/suite check + live-acceptance note.
