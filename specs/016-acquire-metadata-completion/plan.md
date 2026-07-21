# Implementation Plan: Acquire Completes the SSOT Record (Metadata Integrity)

**Branch**: `feature/corpus-gap-closure` (numbered spec dir) | **Date**: 2026-07-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-acquire-metadata-completion/spec.md`

## Summary

Make it mechanically impossible for `bib acquire` to finish with an incomplete or unadvanced SSOT record (Constitution Principle XV). The single, source-agnostic change is in the shared `runAcquire` orchestration (`src/sourcegroup/acquire.ts`): after the adapter mirror + persist-assets + write-companions block, `runAcquire` runs the existing idempotent, object-store-heads-only reconcile status-advancement (`src/sourcegroup/reconcile.ts`) as an **inseparable tail**, then a **per-repository-appropriate completeness verification** (B2-direct: assets + advanced status + every recorded master's object-store head matches; Gallica `assets: []`: archive-provenance complete + status `collected`; `metadataSnapshot` verified only where the adapter emits one) **before** reporting success. Any incompleteness → **fail loud** naming what is missing. `--dry-run` is exempt; recovery is an idempotent re-run; standalone `bib reconcile` is retained as a repair tool.

## Technical Context

**Language/Version**: TypeScript (ESM), Node 22, `@/` → `src/` import alias

**Primary Dependencies**: `src/sourcegroup/acquire.ts` (`runAcquire` — the orchestration touched); `src/sourcegroup/reconcile.ts` (idempotent status derivation from committed provenance + `ObjectStore` heads, `{status, advanced}`); `src/archive/object-store` (`ObjectStore.head`); `@/model/repository-record` (`RepositoryRecord`, status vocabulary, `AcquiredAsset`). The four acquisition adapters (gallica / new-italy-museum / internet-archive / papers-past) are **unchanged**.

**Storage**: SSOT `bibliography/sources/*.yml` (the `status` + `assets` this feature completes); B2 object store (read-only — HEADs for verification, no new writes); archive clone companions (already written by `runAcquire`, unchanged).

**Testing**: vitest; unit tests with injected fakes (fake `ObjectStore` returning scripted heads, fake source loader/writer) exercising the success path (status advances), the fail-loud branch (incomplete → throw naming the gap), idempotent re-run (0 duplicate writes), dry-run exemption, and each repository shape (B2-direct vs Gallica empty-assets). No network, no real object-store mutation (FR-010).

**Target Platform**: local CLI (`bib acquire`) on the operator host.

**Project Type**: single project (CLI + library modules), existing repo structure.

**Performance Goals**: n=1 acquire; the reconcile tail heads a handful of object-store keys; not throughput-bound.

**Constraints**: fail-loud everywhere (Principle V — no fallbacks/mocks outside tests); the metadata completion is STRUCTURAL (part of `runAcquire`'s success contract; Principle XV); no `any`/`as`/`@ts-ignore`; files ≤ 500 lines; composition + DI (Principle VI); reuse reconcile, do not reinvent status derivation (Principle VIII).

**Scale/Scope**: one `runAcquire` change + one small completeness-verifier module + tests; the standalone `reconcile` becomes repair-only (doc/wording, no behavior change to reconcile itself).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle XV (Metadata Integrity Is Mechanically Enforced)**: this feature IS the XV enforcement — the metadata completion is welded into `runAcquire`'s success contract, verified, and fail-loud; it becomes mechanically impossible to finish acquire with bytes the record does not reflect. PASS.
- **Principle V (Fail-loud, No Fallbacks)**: an incomplete record fails loud naming the gap; recovery is an idempotent re-run, never a silent fallback. PASS.
- **Principle VI (Composition Over Inheritance / DI)**: the completeness verifier is a small pure/injected function composed into `runAcquire`; no inheritance; the object-store is injected. PASS.
- **Principle VIII (Faithful Tool Adoption)**: reuses the shipped idempotent `reconcile` (no reinvented status derivation); drives the Spec Kit chain in order. PASS.
- **Principle III (Provenance Is Mandatory)**: the completion guarantees the acquired provenance/status is recorded — XV is III's enforcement mechanism. PASS.
- **INV (adapter invariants)**: adapters unchanged; per-repository completeness respects each adapter's shape (Gallica `assets: []` is not failed). PASS.

No violations → Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/016-acquire-metadata-completion/
├── plan.md              # This file
├── research.md          # Phase 0 (R1 reconcile-as-tail, R2 completeness model, R3 fail-loud/atomicity, R4 dry-run)
├── data-model.md        # Phase 1 (completeness verdict, per-repository completeness rules, status vocabulary)
├── quickstart.md        # Phase 1 (validation scenarios)
├── contracts/           # Phase 1 (runAcquire completion contract, completeness-verifier contract)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/sourcegroup/
├── acquire.ts                 # runAcquire: after persist-assets + companions, run the reconcile
│                              #   status-advancement tail, then verify completeness; fail-loud;
│                              #   dry-run exempt; return success only when complete.
├── acquire-completeness.ts    # NEW — pure per-repository completeness verifier:
│                              #   verifyRecordComplete(record, {objectStore, reconciled}) -> ok | fail-loud detail
└── reconcile.ts               # REUSED for the tail (idempotent, heads-only); repair-only as a standalone verb.

tests/unit/sourcegroup/
├── acquire-completeness.test.ts   # per-repository completeness (B2-direct match; Gallica assets:[] via provenance; snapshot best-effort; mismatch -> incomplete)
└── acquire.test.ts (extend)       # runAcquire completion: success advances status; fail-loud on incomplete; idempotent re-run 0 dup writes; dry-run exempt; per-adapter
```

**Structure Decision**: single project, existing layout; the completion tail + verification live in `runAcquire` (source-agnostic) with a small dedicated `acquire-completeness.ts` verifier for testability; `reconcile.ts` is reused unchanged. No new top-level structure.

## Complexity Tracking

No Constitution violations — none.
