---
description: "Task list for Source-Group Acquisition"
---

# Tasks: Source-Group Acquisition

**Input**: Design documents from `/specs/006-source-group-acquisition/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli-commands.md, quickstart.md

**Tests**: TDD-first (project convention — `vitest`, co-located `*.test.ts`). Test tasks precede or pair with their implementation.

## Format: `[ID] [P?] [Story] [tier:label] Description`

- **[P]**: parallelizable (different files, no incomplete dependency)
- **[Story]**: US1–US5 (user-story phases only)
- **[tier:label]**: model tier — `fast` (mechanical), `balanced` (ordinary impl/tests), `powerful` (hardest/riskiest). Exactly one per task.

## Path Conventions

Single-project CLI: new module `src/sourcegroup/`, dispatch in `src/cli/bibliography.ts` + `src/index.ts`, co-located `*.test.ts`, SSOT under `bibliography/`.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [tier:fast] Create the `src/sourcegroup/` module directory with an `index.ts` barrel and a co-located test folder convention per repo layout.
- [x] T002 [P] [tier:fast] Add PB-P004 + a second existing `source-group` id to test fixtures under `src/sourcegroup/__fixtures__/` for reusability testing (SC-003).
- [x] T003 [tier:fast] Wire empty `bib` subaction stubs (`inventory`, `verify-member`, `promote`, `exclude-member`, `acquire`, `discover`) into `src/cli/bibliography.ts` dispatch (return "not implemented" fail-loud) so the surface exists for TDD.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shared pieces every story depends on. MUST complete before user-story phases.

### Discovery mechanism spike (GATED FIRST — blocks US5 and shapes the discover verb)

- [x] T004 [tier:powerful] **Spike**: evaluate candidate discovery mechanisms (lead: BnF general-catalogue SRU at `catalogue.bnf.fr`; comparison-only: other documented BnF API, operator-supplied). Select exactly ONE documented mechanism, or conclude none is reliable. Write findings + the decision to `specs/006-source-group-acquisition/research.md` (append a "Spike outcome" section). No runtime fallback. (FR-018, D-02)
- [x] T005 [tier:powerful] Define the `DiscoveryMechanism` interface + fail-loud dispatcher in `src/sourcegroup/discovery/discovery.ts` (one implementation, no fallback chain); if the spike found no reliable API, this dispatcher exposes only operator-supplied candidates and the `discover` verb is NOT shipped (FR-019).

### Model & vocab additions (additive optional fields only)

- [x] T006 [tier:powerful] Decide + record whether `RepositoryRecord.metadataSnapshot`, `RepositoryRecord.verification`, and `rightsRaw` land as an explicit amendment to `specs/004-canonical-source-metadata` or as feature-local additive optional fields (default: additive + cross-reference 004). Record the decision in `data-model.md` §"004 amendment surface". (D-07)
- [x] T007 [P] [tier:balanced] Add additive optional fields to the model interfaces in `src/model/repository-record.ts`: `metadataSnapshot?` and `verification?` (+ `rightsRaw` on the rights shape if absent). No breaking change; no `any`/`as`.
- [x] T008 [tier:balanced] Extend `src/bibliography/migrate-serialize.ts` (and load in `src/bibliography/load.ts`) to round-trip the new optional fields deterministically; add a serialize/load unit test.
- [x] T009 [P] [tier:fast] Add a `verify-member`/vocab regression test asserting the two vocabularies stay disjoint (a Source-lifecycle value on a RepositoryRecord `status` is rejected by the shipped `validateVocab`). (FR-022)

### Shared pipeline primitives

- [x] T010 [tier:balanced] Write concurrency test for atomic id allocation (two parallel allocations never collide) in `src/sourcegroup/id-alloc.test.ts`.
- [x] T011 [tier:powerful] Implement `src/sourcegroup/id-alloc.ts`: scan `bibliography/sources/` for the max `PB-P###`, exclusive-create (`wx`) the target file, retry-on-EEXIST; no mutable counter. (FR-001, D-06)
- [x] T012 [P] [tier:balanced] Write test for `--archive` record selection (infer-one; fail-loud on ambiguity) in `src/sourcegroup/record-select.test.ts`.
- [x] T013 [tier:balanced] Implement `src/sourcegroup/record-select.ts`: select a RepositoryRecord by `--archive <sourceArchive>` over the `(sourceId, sourceArchive)` key; infer the sole record; fail loud on >1 without a selector. (FR-009a, D-05)
- [x] T014 [P] [tier:balanced] Write write-once test for the immutable metadata snapshot (re-inventory appends, never overwrites) in `src/sourcegroup/snapshot.test.ts`.
- [x] T015 [tier:balanced] Implement `src/sourcegroup/snapshot.ts`: write an immutable snapshot (path/retrievedAt/endpoint/normalizationVersion) under `bibliography/`, exclusive-create, and a reader. (FR-004, D-07)
- [x] T016 [tier:powerful] Write tests for the shared deterministic verification function (each check: identifierResolved, rights, requiredMetadata, hardDuplicate, possibleDuplicate) with the network boundary injected, in `src/sourcegroup/verify-member.test.ts`.
- [x] T017 [tier:powerful] Implement the shared deterministic verification function in `src/sourcegroup/verify-member.ts` producing a `Verdict`; pure over (member, selected record, injected resolver); no relevance judgment. Reused by US2 and US3. (FR-006–008, D-03/D-04)

**Checkpoint**: model round-trips new fields; id-alloc, record-select, snapshot, and verification primitives pass unit tests.

---

## Phase 3: User Story 1 — Inventory a candidate (Priority: P1) 🎯 MVP

**Goal**: create a well-formed member Source + RepositoryRecord (`wanted`) + immutable snapshot from an ARK.

**Independent test**: `bib inventory <ark> --group PB-P004` yields the expected member with preserved raw+normalized metadata.

- [x] T018 [P] [US1] [tier:balanced] Write `inventory` tests: happy path (creates Source + RepositoryRecord `wanted` + snapshot), group-not-a-source-group fails loud, non-public-domain records `rightsStatus` other + flags not-acquirable, in `src/sourcegroup/inventory.test.ts`. (US1 scenarios 1–5)
- [x] T019 [US1] [tier:balanced] Implement `src/sourcegroup/inventory.ts`: resolve the ARK, allocate id (id-alloc), write member Source (`partOf`, `status: discovered`, titles/creator/identifiers), write RepositoryRecord (`status: wanted`, `rightsRaw`+`rightsStatus`), write snapshot. Fail loud on unresolved group/ark. (FR-001–005)
- [x] T020 [US1] [tier:fast] Wire `bib inventory` in `src/cli/bibliography.ts` to `runInventory` (arg/flag parse: `<ark> --group --kind --archive --dry-run`); update the `bib` help text.

**Checkpoint**: US1 independently demonstrable.

---

## Phase 4: User Story 2 — Verify a member's repository copy (Priority: P2)

**Goal**: deterministic verdict over one copy; no status change, no relevance judgment.

**Independent test**: `bib verify-member PB-P007` returns the expected verdict for clean / dead-ARK / duplicate / missing-field fixtures.

- [x] T021 [P] [US2] [tier:balanced] Write `verify-member` command tests over fixtures (pass, dead-ARK fail, rights fail, hard-duplicate, possible-duplicate review, ambiguity requires `--archive`), in `src/sourcegroup/verify-member.command.test.ts`. (US2 scenarios 1–7)
- [x] T022 [US2] [tier:balanced] Implement the `verify-member` command wrapper (loads member, selects record via record-select, runs the shared verification fn from T017, prints the verdict). Read-only. (FR-006–009a)
- [x] T023 [US2] [tier:fast] Wire `bib verify-member <id> [--archive]` in `src/cli/bibliography.ts`; update help text.

**Checkpoint**: US2 independently demonstrable.

---

## Phase 5: User Story 3 — Promote a member (Priority: P2)

**Goal**: research approval — rerun verification, record verdict, advance lifecycle; membership authoritative.

**Independent test**: `bib promote PB-P007` reruns verification, records the verdict, and advances `discovered → approved-for-acquisition` / `wanted → to-collect`.

- [x] T024 [P] [US3] [tier:powerful] Write `promote` tests: rerun-verify passes → records verdict + advances both statuses; any failing check aborts (no verdict, no transition); `partOf` authoritative; `--group` mismatch fails loud, equality proceeds; ambiguity requires `--archive`; in `src/sourcegroup/promote.test.ts`. (US3 scenarios 1–6)
- [x] T025 [US3] [tier:powerful] Implement `src/sourcegroup/promote.ts`: confirm `status == discovered` and `partOf` resolves; **re-run** the shared verification (T017); on pass record `verification` verdict + advance Source and the selected RepositoryRecord; on any fail abort atomically. (FR-010/010a/010b/011/012)
- [x] T026 [P] [US3] [tier:balanced] Write `exclude-member` tests: `discovered → excluded` with reason; empty reason fails loud; not-`discovered` fails loud, in `src/sourcegroup/exclude-member.test.ts`. (US3 scenario 7)
- [x] T027 [US3] [tier:balanced] Implement `src/sourcegroup/exclude-member.ts`: `discovered → excluded`, record `--reason`; fail loud on precondition. (FR-013/013a)
- [x] T028 [US3] [tier:fast] Wire `bib promote <id> [--archive] [--group]` and `bib exclude-member <id> --reason <text>` in `src/cli/bibliography.ts`; update help text.

**Checkpoint**: US3 independently demonstrable; the discovered→(approved|excluded) fork works.

---

## Phase 6: User Story 4 — Acquire an approved member (Priority: P1)

**Goal**: reuse the shipped fetcher; resolve ARK from the selected RepositoryRecord; no new fetch code.

**Independent test**: acquire an `approved-for-acquisition` fixture → object fetched to the object store with provenance; operator supplied only the id.

- [x] T029 [P] [US4] [tier:balanced] Write `acquire` tests (mock the fetcher boundary): resolves ARK from selected record → calls `runFetchSource --source-id --object-store`; refuses non-approved; refuses non-public-domain; ambiguity requires `--archive`; group itself still blocked by the shipped guardrail; in `src/sourcegroup/acquire.test.ts`. (US4 scenarios 1–5)
- [x] T030 [US4] [tier:balanced] Implement `src/sourcegroup/acquire.ts`: precondition checks (approved + public-domain), select record, resolve ARK, invoke the shipped `runFetchSource` unchanged (`--object-store`); NO new fetch code. (FR-014–017, D-08)
- [x] T031 [US4] [tier:fast] Wire `bib acquire <id> [--archive] [--object-store] [--dry-run]` in `src/cli/bibliography.ts`; update help text.

**Checkpoint**: full spine US1→US4 runnable on fixtures.

---

## Phase 7: User Story 5 — Discover candidate records (Priority: P3)

**Goal**: agent-assisted discovery over the single spike-selected mechanism; fail-loud; relevance left to the researcher.

**Independent test**: `bib discover <query>` returns candidates over exactly one mechanism; fails loud when unavailable.

> Gated on the T004 spike outcome. If the spike found no reliable API, SKIP T032–T034 and document that the pipeline runs from operator-supplied ARKs (FR-019); note the skip explicitly in tasks completion.

- [x] T032 [P] [US5] [tier:balanced] Write `discover` tests: returns `DiscoveryCandidate[]` over the one mechanism; unavailable mechanism fails loud with no fallback; makes no member and no relevance call; in `src/sourcegroup/discovery/discover.test.ts`. (US5 scenarios 1–3)
- [x] T033 [US5] [tier:balanced] Implement the spike-selected mechanism client `src/sourcegroup/discovery/<mechanism>.ts` behind the `DiscoveryMechanism` interface (T005). (FR-018/020)
- [x] T034 [US5] [tier:fast] Wire `bib discover <query> [--limit]` in `src/cli/bibliography.ts` (only if shipped per spike); update help text.

**Checkpoint**: US5 independently demonstrable (or explicitly skipped per spike).

---

## Phase 8: Polish & Cross-Cutting / Acceptance

- [x] T035 [P] [tier:balanced] Negative-path coverage sweep: assert every command fails loud with an informative message on its defined error conditions (unresolved group, dead ARK, non-public-domain, cross-domain status, ambiguous copy, unavailable discovery). (SC-005)
- [x] T036 [P] [tier:fast] Ensure each new file is ≤300–500 lines and uses `@/` imports, no `any`/`as`/`@ts-ignore`; run `npm run typecheck`.
- [~] T037 [tier:powerful] **PB-P004 end-to-end validation run** (SC-002) — **operator-acceptance (live)**: drive inventory→verify→promote→acquire for each identified original court record of the Marquis de Rays corpus; confirm object-store assets + provenance + immutable snapshots. Verify the candidate `ark:/12148/bpt6k5785971m` is an original record vs a later account (exclude or route otherwise). Marked `[~]` (excluded from the tasks-complete gate) because it writes real corpus data to the production B2 object store and requires live BnF/Gallica + research relevance judgment — run by the operator AFTER the whole-feature governance audit (audit-before-acceptance).
- [x] T038 [tier:balanced] **Reusability check** (SC-003): run the pipeline unchanged against the second source-group fixture (T002) — no PB-P004 special-casing.
- [x] T039 [P] [tier:fast] Update `quickstart.md` and the `bib` help with the final command shapes; cross-link the spike outcome.

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** → user-story phases.
- **T004 spike is the gated first implementation task**; T005 and all US5 tasks depend on it.
- Foundational primitives (T006–T017) block the user-story phases: inventory needs id-alloc + snapshot + model fields; verify/promote need the shared verification fn (T017) + record-select; acquire needs record-select.
- **User-story order** by priority: US1 (P1) → US4 (P1) form the MVP spine, but US4 depends on the US3 transition existing; recommended build order US1 → US2 → US3 → US4 → US5 (pipeline order), with US2/US3 (P2) preceding US4 acquisition in practice.
- Polish/acceptance (T035–T039) after the stories they validate.

## Parallel Opportunities

- Setup: T002 ∥ T003.
- Foundational: T007 ∥ T009; the test-then-impl pairs T010/T011, T012/T013, T014/T015, T016/T017 can proceed as independent tracks (different files).
- Within a story, the `[P]` test task runs alongside sibling test authoring; impl follows its test.

## MVP scope

**US1 (Inventory)** alone delivers a durable, well-formed member record with preserved evidence. The value spine is **US1 + US4** (inventory → acquire), which requires US2/US3 for the lifecycle gate. Ship US1→US4 for the PB-P004 run; US5 (discovery) is additive and gated on the spike.

## Tier summary

- `[tier:powerful]`: T004, T005, T006, T011, T016, T017, T024, T025, T037 (spike, verification semantics, atomic allocation, promote rerun+record, model amendment, end-to-end run).
- `[tier:balanced]`: ordinary stage commands, tests, serialization.
- `[tier:fast]`: dispatch wiring, fixtures, help/doc edits, typecheck sweep.
