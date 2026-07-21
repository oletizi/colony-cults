# Feature Specification: Acquire Completes the SSOT Record (Metadata Integrity)

**Feature Branch**: `feature/corpus-gap-closure` (numbered spec dir; one-long-lived-branch model)
**Created**: 2026-07-19
**Status**: Draft
**Origin**: backlog TASK-46 (feature-rigor); Constitution Principle XV (v1.4.0); design at `docs/superpowers/specs/2026-07-19-acquire-metadata-completion-design.md`
**Input**: Weld SSOT metadata completion into the acquire operation so it is mechanically impossible to finish an acquisition with an incomplete or unadvanced bibliography record.

## Context

Principle XV (Metadata Integrity Is Mechanically Enforced — No Orphan Assets, v1.4.0) requires any process that retrieves an object or writes an asset to complete its durable SSOT metadata as an inseparable, structural, fail-loud part of the *same* operation. The acquire pipeline violates this: `runAcquire` (source-agnostic across gallica / new-italy-museum / internet-archive / papers-past) mirrors bytes to the object store and records the returned assets + archive companions, but does NOT advance the `RepositoryRecord` acquisition status — a *separate* `bib reconcile` (which the operator must remember to run) advances `to-collect → archived`. Confirmed live 2026-07-19: acquiring PB-P061 left `status: to-collect` with 3 masters already in the object store until a manual reconcile. The record read as unacquired despite the bytes being held.

## Clarifications

### Session 2026-07-19

- Q: How should acquire judge "record complete" so it does not fail-loud a legitimately empty-assets Gallica acquire? → A: Per-repository-appropriate completeness — a B2-direct adapter (museum / internet-archive / papers-past) is complete when its assets are recorded + status advanced + every master's object-store head matches; a per-page-provenance adapter (Gallica, `assets: []`) is complete when its archive-provenance path is complete + status advanced to the correct value (`collected`). Never a universal "non-empty B2 asset list" check.
- Q: Is record-level `metadataSnapshot` completeness in scope for THIS feature across all adapters? → A: Best-effort per-adapter — completeness REQUIRES status advancement + assets for every adapter now; the record-level `metadataSnapshot` is verified only where the adapter emits one (papers-past, museum); an adapter that does not yet emit one is NOT failed for its absence, and a per-adapter backlog follow-on captures adding it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A completed acquisition leaves a complete, findable record (Priority: P1) 🎯 MVP

An operator runs `bib acquire` for a member. When it reports success, the bibliography record ALREADY reflects the held asset completely — assets recorded, acquisition status advanced (e.g. `archived`), provenance present — with no separate step to remember. It is mechanically impossible for acquire to report success while the object store holds bytes the record does not fully reflect.

**Why this priority**: This IS the feature — the metadata is the mission; an object that cannot be found through the record is not acquired, it is lost.

**Independent Test**: Drive `acquire` on a public-domain member end-to-end with fakes; on success assert the record's status is advanced (NOT left at `to-collect`) and every mirrored master is recorded and reflected; assert there is no code path where acquire returns success with an unadvanced/incomplete record.

**Acceptance Scenarios**:

1. **Given** a member acquired end-to-end, **When** `bib acquire` reports success, **Then** the `RepositoryRecord` status is advanced to the correct acquired state (`archived` when all masters are backed) and every mirrored master is recorded — with no separate `reconcile` required.
2. **Given** the acquire just completed, **When** the operator inspects the record (`bib show` / coverage), **Then** it reflects the held asset as acquired (not `to-collect`).
3. **Given** any acquire, **When** it finishes, **Then** it is mechanically impossible for the operation to have succeeded with bytes in the object store that the SSOT record does not fully reflect.

---

### User Story 2 - Incomplete metadata fails loud and heals on re-run (Priority: P2)

If the metadata cannot be completed (the record write or status advancement fails after bytes were mirrored), `acquire` fails loud — non-zero, naming what is incomplete — never silently leaving an orphan. Re-running `acquire` completes the record with no duplicate object-store writes.

**Why this priority**: The safety property behind US1 — the guarantee must hold even when a completion step fails. Because the object store (durable, external) and the local SSOT record cannot be committed atomically, fail-loud + idempotent recovery is how "no orphan" survives a partial failure.

**Independent Test**: Inject a metadata-write / reconcile failure after the byte mirror; assert `acquire` exits non-zero naming the incompleteness; re-run and assert the record is completed with zero duplicate object-store writes.

**Acceptance Scenarios**:

1. **Given** bytes were mirrored but the metadata completion fails, **When** `acquire` runs, **Then** it exits non-zero and names what is incomplete (fail-loud) — it does NOT report success.
2. **Given** a prior acquire failed mid-completion (bytes in the store, record incomplete), **When** `acquire` is re-run, **Then** it completes the record idempotently (0 duplicate object-store writes) and reports success.

---

### User Story 3 - Standalone reconcile is repair-only; the guarantee is source-agnostic (Priority: P3)

Status-advancement no longer depends on a separately-invoked `reconcile` in the happy path. Standalone `bib reconcile` is retained as a repair tool (pre-existing orphans, recovery). The completion guarantee holds for every acquisition adapter through the shared `runAcquire` path.

**Why this priority**: Encodes the "no forgettable step" and "every adapter" properties of XV; it is P3 only because it is the generalization/retention layer over the US1/US2 mechanism.

**Independent Test**: Confirm `runAcquire` (not a separate command) advances status for each adapter's record shape; confirm standalone `reconcile` still repairs a hand-broken record; confirm no acquire path skips the completion tail.

**Acceptance Scenarios**:

1. **Given** any of the four adapters completes an acquire, **When** it reports success, **Then** the completion (status advancement + verification) ran as part of the same operation — not a separate command.
2. **Given** a pre-existing record with masters in the store but `to-collect` status (an orphan from before this feature), **When** the operator runs standalone `bib reconcile`, **Then** it repairs the record (repair-only retention).

### Edge Cases

- **Empty-assets adapter path (Gallica):** the Gallica adapter returns `assets: []` (masters are per-page archive provenance, reconciled via the archive-provenance path; reconcile yields `collected`, not `archived`). Completeness is **per-repository-appropriate** (clarified 2026-07-19): the Gallica path is complete when its archive-provenance is complete + status advanced to `collected` — a legitimately empty-assets Gallica acquire is NOT failed as "incomplete", and completeness is never a universal "non-empty B2 asset list" check.
- **Record-level metadataSnapshot absent for an adapter:** completeness verifies the `metadataSnapshot` only where the adapter emits one (papers-past, museum); an adapter that does not yet emit one (gallica / internet-archive today) is NOT failed for its absence (best-effort per-adapter; clarified 2026-07-19). A per-adapter backlog follow-on adds snapshot emission to those adapters.
- **Dry-run:** `--dry-run` mirrors nothing, so it is exempt from completeness verification (nothing was acquired to complete).
- **Re-acquire of an already-complete record:** idempotent — no duplicate object-store writes, status stays advanced, still reports success.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `runAcquire` MUST complete the SSOT record — advance the acquisition status AND record the held assets — as an inseparable part of the same acquire operation, reusing the existing idempotent status-derivation logic; NO separately-invoked `reconcile` in the happy path.
- **FR-002**: On a successful acquire, `runAcquire` MUST verify the record is complete (assets recorded + status advanced + every recorded master present in the object store with a matching checksum) BEFORE reporting success.
- **FR-003**: If the metadata cannot be completed, `runAcquire` MUST fail loud (non-zero, naming what is incomplete) and MUST NOT report a successful acquire with an incomplete/unadvanced record. It MUST NOT be mechanically possible to finish `acquire` with object-store bytes the SSOT record does not fully reflect.
- **FR-004**: Recovery MUST be an idempotent re-run — re-running `acquire` completes an incompletely-recorded prior acquisition with ZERO duplicate object-store writes.
- **FR-005**: The guarantee MUST be source-agnostic — it holds for every acquisition adapter (gallica / new-italy-museum / internet-archive / papers-past) via the shared `runAcquire` path (a single mechanism, not per-adapter code).
- **FR-006**: The standalone `reconcile` MUST be retained as a repair tool for pre-existing orphans / recovery; it is no longer required to complete a normal acquisition.
- **FR-007**: `--dry-run` MUST be exempt from completeness verification (it mirrors nothing).
- **FR-008**: The completeness verification MUST be **per-repository-appropriate** (clarified 2026-07-19): a B2-direct adapter (museum / internet-archive / papers-past) is complete when its assets are recorded + status advanced + every recorded master's object-store head matches; a per-page-provenance adapter (Gallica, `assets: []`) is complete when its archive-provenance is complete + status advanced to `collected`. An adapter that legitimately produces no B2 assets MUST NOT be failed for an empty asset list, and completeness is never a universal "non-empty B2 asset list" check.
- **FR-009**: Record-level `metadataSnapshot` completeness is **best-effort per-adapter** (clarified 2026-07-19): where an adapter emits a record-level `metadataSnapshot` (papers-past, museum) the verification MUST confirm it is present; an adapter that does not yet emit one MUST NOT be failed for its absence. (A per-adapter follow-on adds snapshot emission to the remaining adapters.)
- **FR-010**: The full completion path — including the fail-loud and idempotent-recovery branches — MUST be exercised in automated tests with injected fakes: no network, no real object-store mutation.

### Key Entities *(include if feature involves data)*

- **RepositoryRecord acquisition status**: the SSOT field the completion advances (`to-collect → collected/archived`), derived from committed provenance + object-store heads.
- **AcquiredAsset**: the mirrored master(s) recorded on the record (object key, checksum, role, provenance).
- **Completeness verdict**: the check that the recorded assets, the advanced status, and the object-store heads agree before `acquire` reports success.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successful `bib acquire` runs leave the record's acquisition status advanced — 0 left at `to-collect` while masters sit in the object store.
- **SC-002**: 0 acquisitions report success while the object store holds bytes the SSOT record does not fully reflect.
- **SC-003**: A re-run of an incompletely-recorded prior acquisition completes the record with 0 duplicate object-store writes.
- **SC-004**: The guarantee holds for all 4 acquisition adapters (verified per adapter).
- **SC-005**: No separate `bib reconcile` invocation is required after a normal acquire for the record to read as acquired.

## Assumptions

- Reuse the existing idempotent, object-store-heads-only reconcile logic (`src/sourcegroup/reconcile.ts`) for status derivation; the completion tail performs NO source re-fetch.
- Verification depth defaults to trusting the just-run reconcile result (which already heads the object store) rather than a separate re-head pass — refined at `/speckit-clarify` if the two-question set warrants.
- `--dry-run` is exempt (mirrors nothing).
- Archive companions (the discoverability layer) are already written by `runAcquire`; this feature adds the status-advancement + completeness verification, not the companion write.
- The existing acquisition adapters, the object store, and the archive clone are unchanged; the change is in the shared `runAcquire` orchestration (and the standalone `reconcile` becomes repair-only).
