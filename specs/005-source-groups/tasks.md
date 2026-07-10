---
description: "Task list for Source Groups (feature 005)"
---

# Tasks: Source Groups

**Input**: Design documents from `specs/005-source-groups/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — the plan and quickstart enumerate vitest coverage and the repo follows
a test-first norm. RED tests are written before their implementation task and must fail first.

**Organization**: Tasks are grouped by user story (US1–US4 from spec.md) for independent
implementation and testing.

## Format: `[ID] [P?] [Story] [tier:<label>] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4 (user-story phases only)
- **[tier:<label>]**: model tier — `fast` (haiku) / `balanced` (sonnet) / `powerful` (opus),
  resolved by this installation's `tier_map` at `resolve-tiers` time
- Exact file paths included in each description

## Path Conventions

Single-project TypeScript CLI: `src/`, `tests/` at repository root (per plan.md Structure).

---

## Phase 1: Setup

**Purpose**: Establish a green baseline before touching the model.

- [x] T001 [tier:fast] Run `vitest run` and record a green baseline; confirm branch is `feature/source-groups` and `bibliography/sources/PB-P004.yml` is present (pre-migration `kind: monograph`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared model + loader changes every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 [tier:powerful] Extend the canonical model in `src/model/source.ts`: widen `Source.kind` to `'periodical' | 'monograph' | 'source-group'` and add optional `partOf?: string` (member→group edge). Audit and resolve every downstream `kind` switch/exhaustiveness site the widening surfaces (e.g. `src/bibliography/regenerate.ts`, `src/bibliography/model.ts`, `src/archive/location.ts`) so the build stays green and unhandled `source-group` never falls through silently (fail-loud where a fetchable-only path is reached).
- [x] T003 [tier:balanced] Extend `src/bibliography/load-fields.ts` to parse and narrow `kind: 'source-group'` and the `partOf` field from the SSOT YAML, so `loadAllSources` returns source-group and member records with `partOf` populated.

**Checkpoint**: Model + loader recognize source groups and member edges; `vitest run` still green.

---

## Phase 3: User Story 1 - Refuse to acquire a collection, with a helpful redirect (Priority: P1) 🎯 MVP

**Goal**: Any fetch/acquire of a source group fails loud + informatively, keyed on kind — the concrete TASK-3 fix.

**Independent Test**: With a `kind: source-group` record present (fixture or migrated PB-P004), `fetch-source <id> --source-id <id>` exits non-zero with the group redirect message, NOT the opaque layout-registry error; an ordinary fetchable source is unaffected.

### Tests for User Story 1

- [x] T004 [P] [US1] [tier:fast] RED integration test in `tests/integration/source-groups.test.ts`: a `kind: source-group` fixture fed to `runFetchSource` throws with the actionable group message; a `monograph`/`periodical` source is unaffected. Assert it fails before implementation.

### Implementation for User Story 1

- [x] T005 [US1] [tier:balanced] Add a focused canonical-kind lookup (e.g. `sourceKind(sourceId)`) over `loadAllSources` in `src/bibliography/load.ts` (or a small helper module) so the guardrail can resolve a source's SSOT kind without a full per-fetch corpus cost beyond one load.
- [x] T006 [US1] [tier:balanced] Implement the guardrail in `src/cli/fetch-source.ts` (`runFetchSource`): after resolving `sourceId` and BEFORE calling `sourceLayout`, refuse a `source-group` with the message from `contracts/fetch-guardrail.md` (names the id; directs to discover/inventory/acquire members). Leave the non-group path unchanged.

**Checkpoint**: US1 fully functional — fetching a source group is refused informatively; T004 passes.

---

## Phase 4: User Story 2 - Model a collection as a source group with members (Priority: P2)

**Goal**: Validation enforces the group/member split (group ⇒ no repository records, non-fetchable; member `part_of` resolves to a group; zero-member group valid).

**Independent Test**: A source-group record with members and no repository records validates; zero-member group validates; a group carrying repository records, or a member with a dangling/non-group `partOf`, is rejected with a specific reason.

### Tests for User Story 2

- [x] T007 [P] [US2] [tier:fast] RED unit tests in `tests/unit/bibliography/validate-checks.test.ts` for `validateSourceGroups`: (a) group with members + no repository records → clean; (b) zero-member group → clean; (c) group with repository records → `group-has-repository-records`; (d) member with missing `partOf` target → `dangling-part-of`; (e) member `partOf` pointing at a non-group → `part-of-not-a-group`.

### Implementation for User Story 2

- [x] T008 [US2] [tier:balanced] Add the new finding kinds to `ValidationFindingKind` and implement `validateSourceGroups(model): ValidationFinding[]` in `src/bibliography/validate-checks.ts` per `contracts/validation.md` (never flags a zero-member group).
- [x] T009 [US2] [tier:fast] Wire `validateSourceGroups(model)` into `validate()` in `src/bibliography/validate.ts` alongside the existing leak/view-drift checks.

**Checkpoint**: US1 and US2 both work independently; the group/member contract is enforced.

---

## Phase 5: User Story 3 - Track members through a discovery pipeline (Priority: P3)

**Goal**: `discovered` and `approved-for-acquisition` are valid statuses; existing statuses unchanged.

**Independent Test**: A record with `status: discovered` or `approved-for-acquisition` validates; every pre-existing status still validates unchanged.

### Tests for User Story 3

- [x] T010 [P] [US3] [tier:fast] RED unit test in `tests/unit/bibliography/vocab.test.ts`: `STATUS_VALUES` accepts `discovered`, `approved-for-acquisition`, and `excluded`; the five existing values still validate; an unknown status still rejects.

### Implementation for User Story 3

- [x] T011 [US3] [tier:fast] Extend `STATUS_VALUES` in `src/bibliography/vocab.ts` with `discovered` and `approved-for-acquisition` (ordered ahead of the acquisition states) and `excluded` (off-pipeline terminal; reason carried in the record `notes`), per data-model.md.

**Checkpoint**: US1–US3 independently functional; the discovery pipeline is expressible.

---

## Phase 6: User Story 4 - Reclassify PB-P004 as the first source group (Priority: P3)

**Goal**: `PB-P004` migrates from monograph-with-repository-record to a valid (zero-member) source group; the full bibliography still validates and regenerates deterministically.

**Independent Test**: After migration, `bib validate` passes with `PB-P004` a source group; `fetch-source PB-P004` fires the US1 guardrail; regenerate is byte-stable and emits a source-group row with empty acquisition columns.

### Tests for User Story 4

- [x] T012 [P] [US4] [tier:fast] RED unit test in `tests/unit/bibliography/migrate.test.ts`: migrating a monograph `PB-P004` fixture yields `kind: source-group` with no `repositoryRecords`, titles/case/notes preserved; re-running the migration is a no-op (idempotent).

### Implementation for User Story 4

- [x] T013 [US4] [tier:balanced] Implement the PB-P004 migration in `src/bibliography/migrate.ts` per research.md R-003: monograph→`source-group`, drop the single `to-collect` repository record, preserve descriptive fields, idempotent.
- [x] T014 [US4] [tier:balanced] Make derivation/regeneration tolerate a repository-record-less source group in `src/bibliography/model.ts` and `src/bibliography/regenerate.ts` (R-002): emit one `sources.csv` row for the group (empty acquisition columns), no acquisition-tracker/register row; keep regeneration byte-deterministic.
- [x] T015 [US4] [tier:balanced] Apply the migration to the real `bibliography/sources/PB-P004.yml`, regenerate the derived views, and commit the migrated SSOT + regenerated views.

**Checkpoint**: All four user stories independently functional against the live PB-P004 record.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T016 [P] [tier:balanced] Walk every scenario in `specs/005-source-groups/quickstart.md` end-to-end (validate, fetch-refuse, member stub, regenerate determinism, migration idempotency) and confirm the observed output matches.
- [x] T017 [P] [tier:fast] Run the full `vitest run` plus typecheck; confirm zero regressions across the existing suite and the new source-group tests.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: after Setup — **BLOCKS all user stories** (T002 model, T003 loader).
- **User Stories (Phase 3–6)**: all depend on Phase 2. US1–US3 are mutually independent and may proceed in parallel; **US4 depends on US1 (guardrail), US2 (validation), and US3 (vocab)** because it validates/refuses/regenerates the live record against all three.
- **Polish (Phase 7)**: after the desired user stories are complete.

### Within Each User Story

- The RED test task precedes its implementation task(s) and must fail first.
- T005 (kind lookup) precedes T006 (guardrail); T008 (checks) precedes T009 (wiring); T013 (migration) precedes T015 (apply); T014 (regenerate tolerance) precedes T015 (regenerate).

### Parallel Opportunities

- T004, T007, T010, T012 (the four RED tests) are all `[P]` — different test files, independent.
- Within Phase 2, T002 must land before T003 (T003 narrows the types T002 introduces).
- US1, US2, US3 phases can run in parallel once Phase 2 completes; US4 waits on all three.

---

## Parallel Example: RED tests after Foundational

```bash
# Once Phase 2 is green, launch the independent RED tests together:
Task: "T004 integration test: fetch-source refuses a source-group (tests/integration/source-groups.test.ts)"
Task: "T007 unit tests: validateSourceGroups findings (tests/unit/bibliography/validate-checks.test.ts)"
Task: "T010 unit test: new status vocab (tests/unit/bibliography/vocab.test.ts)"
Task: "T012 unit test: PB-P004 migration idempotent (tests/unit/bibliography/migrate.test.ts)"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (T002, T003) → 3. Phase 3 US1 (T004–T006) →
4. **STOP and VALIDATE**: `fetch-source` on a source group is refused informatively (TASK-3 resolved).

### Incremental Delivery

Foundational → US1 (MVP, TASK-3 fix) → US2 (validation split) → US3 (status vocab) →
US4 (migrate the live PB-P004) → Polish. Each story adds value without breaking the previous.

---

## Notes

- `[P]` = different files, no dependencies. `[tier:]` resolves via the installation `tier_map`
  (`fast`→haiku, `balanced`→sonnet, `powerful`→opus) at `resolve-tiers`; T002 is `powerful`
  for its cross-cutting blast radius (widening `Source.kind` touches every kind switch),
  mechanical/RED-test tasks are `fast`, standard implementation is `balanced`.
- Verify each RED test fails before implementing.
- Commit after each task or logical group; never bypass hooks.
- US4 is deliberately last — it exercises US1–US3 against the real record.
