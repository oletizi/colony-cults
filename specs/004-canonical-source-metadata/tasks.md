---
description: Task list for canonical-source-metadata
---

# Tasks: Canonical Source Metadata Model

**Feature dir**: `specs/004-canonical-source-metadata/`
**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Data model**: [data-model.md](./data-model.md) · **Contracts**: [contracts/](./contracts/)

## Format: `[ID] [P?] [Story] [tier:label] Description with file path`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US5)
- **[tier:label]**: model tier for dispatch — `fast`=haiku (mechanical), `balanced`=sonnet (standard impl/tests), `powerful`=opus (safety-critical correctness). Resolved via `.stack-control/config.yaml` `tier_map`.
- Exact file paths included in every task.

## Path Conventions

Single TypeScript project: `src/`, `tests/` at repo root. ESM, `@/` imports, `tsx` runner, `vitest`. Deterministic hand-serialized YAML (the `src/archive/provenance.ts` pattern). No `any`/`as`/`@ts-ignore`; fail loud, no fallbacks.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [tier:fast] Add `yaml` to `package.json` dependencies and install (`npm install`); confirm `npm run typecheck` still passes.
- [ ] T002 [tier:fast] Create the module dirs: `src/bibliography/` and the public SSOT dir `bibliography/sources/` (add `bibliography/sources/.gitkeep`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Blocks all user stories — the canonical model types + loader/deriver every story consumes.**

- [ ] T003 [P] [tier:balanced] Generalize `src/model/source.ts` to an archive-independent Source (`sourceId`, `titles: Title[]`, `kind`, `creator?`, `language?`, `identifiers: WorkIdentifier[]`, `case?`, `notes?`) plus the `Title` and `WorkIdentifier` value types, per data-model.md §Source. Remove the single `gallicaArk` (it moves to Repository Record).
- [ ] T004 [P] [tier:balanced] Create `src/model/repository-record.ts`: `RepositoryRecord`, `CopyIdentifier`, `AssetManifestRef` (reusing the spec-003 `object_store` block as `ObjectStoreRef` — import, do not redefine — FR-012), per data-model.md §Repository Record.
- [ ] T005 [P] [tier:balanced] Create `src/model/identifiers.ts`: `WorkLevelIdentifierType` (`isbn`/`issn`/`oclc`), `CopyLevelIdentifierType` (`ark`/`iiif-manifest`/`scan-doi`), and `classifyIdentifier(type): 'work' | 'copy'`; an unknown type is surfaced (no silent accept), per research R-004.
- [ ] T006 [P] [tier:balanced] Create `src/bibliography/vocab.ts`: closed allowed-value sets for `status`/`rights`/`provider`/`ocr_status` and the required-field core list, per data-model.md §Controlled vocabularies.
- [ ] T007 [tier:fast] Update `src/model/index.ts` to re-export the changed/new types (`Source`, `Title`, `WorkIdentifier`, `RepositoryRecord`, `CopyIdentifier`, `AssetManifestRef`).
- [ ] T008 [P] [tier:balanced] Unit test `classifyIdentifier` (work vs copy; unknown surfaced) and vocab membership in `tests/unit/model/identifiers.test.ts`.
- [ ] T009 [tier:balanced] Implement `src/bibliography/load.ts`: parse `bibliography/sources/PB-###.yml` via `yaml`, then narrow to `Source` + authored `RepositoryRecord[]` with explicit validators (no `any` escapes the module); enforce filename-stem = `sourceId`, `(sourceId, sourceArchive)` uniqueness, and unknown-key rejection; fail loud (throw) on unreadable/malformed input, per contracts/source-record.md.
- [ ] T010 [tier:balanced] Implement `src/bibliography/derive.ts`: build the `CanonicalModel` by rolling up `RepositoryRecord`s + assets from the per-asset provenance the fetcher already writes (`src/model/provenance.ts` / `src/model/asset.ts`, unchanged ground truth), keyed by `sourceId`, per research R-001/R-006.
- [ ] T011 [P] [tier:balanced] Unit test `load` (valid record + malformed → throw) and `derive` (roll-up from fixture provenance) in `tests/unit/bibliography/load.test.ts` and `tests/unit/bibliography/derive.test.ts`.

**Checkpoint**: model types + SSOT loader + provenance roll-up compile and pass unit tests.

---

## Phase 3: User Story 1 - Unify one work across multiple archives without losing provenance (Priority: P1) 🎯 MVP

**Goal**: A Source holds one Repository Record per archive copy; re-acquiring from a second archive never overwrites the first. Restore PB-P001's lost SLQ copy.
**Independent test**: `bib migrate` then `bib show PB-P001 --json` yields two Repository Records (Gallica + SLQ); a repeat Gallica acquisition leaves the SLQ record intact (SC-001/SC-005).

- [ ] T012 [P] [US1] [tier:balanced] Integration test: after `migrate`, PB-P001 has two `repositoryRecords` (`Gallica / BnF` + `State Library of Queensland`), each with its own copy-level identifier + provenance; a second Gallica roll-up does not drop the SLQ record — in `tests/integration/bibliography.test.ts` (US1 slice).
- [ ] T013 [US1] [tier:powerful] Implement `src/bibliography/migrate.ts`: fold the five current representations (`bibliography/sources.csv`, `bibliography/acquisition-tracker.csv`, archive `acquisition-register.csv`, `PB-P00X.yml` stubs, per-asset provenance) into authored `bibliography/sources/PB-###.yml`; **explicitly add PB-P001's second Repository Record (`State Library of Queensland`), restoring the record lost when `source-registry.ts` was overwritten** (SC-005); idempotent (re-run = no change), per data-model.md §Migration mapping.
- [ ] T014 [US1] [tier:balanced] Implement the `bib show <sourceId>` and `bib migrate` verbs in `src/cli/bibliography.ts` and wire the verb group into `src/index.ts`; `bib show` fails loud on an unknown `sourceId` (no default), per contracts/cli.md.
- [ ] T015 [US1] [tier:balanced] Run `bib migrate`; verify `bibliography/sources/PB-P001.yml` carries both copies and `bib show PB-P001 --json` returns two Repository Records (validates SC-001/SC-005 end-to-end).

**Checkpoint**: MVP — multi-archive model + PB-P001 restoration demonstrable independently.

---

## Phase 4: User Story 2 - Enforce work-level vs copy-level identifier placement (Priority: P2)

**Goal**: Reject a copy-level identifier on a Source and a work-level identifier on a Repository Record.
**Independent test**: an `ark` under a Source's `identifiers:` yields an `identifier-leak` finding naming the identifier; correct placement passes (SC-002).

- [ ] T016 [P] [US2] [tier:balanced] Unit test: copy-level id on Source → `identifier-leak` finding (named); work-level id on Repository Record → finding; correct placement → no finding — in `tests/unit/bibliography/validate-leak.test.ts`.
- [ ] T017 [US2] [tier:balanced] Implement the identifier-leak check in `src/bibliography/validate.ts` using `classifyIdentifier`, returning `ValidationFinding[]` (kind `identifier-leak`, naming the identifier + level) per contracts/validation.md.
- [ ] T018 [US2] [tier:balanced] Add the `bib validate` verb wiring in `src/cli/bibliography.ts` to run + report findings (human + `--json`), exit `1` on findings / `2` on malformed input, per contracts/cli.md.

**Checkpoint**: identifier discipline enforced and reported.

---

## Phase 5: User Story 3 - Consolidate the five representations into one source of truth (Priority: P2)

**Goal**: One SSOT; the four legacy files become generated-and-committed views; drift is detectable.
**Independent test**: one SSOT edit → `bib regenerate` updates `sources.csv` with no hand edits; a hand-edited view → `view-drift` (SC-003/SC-004/SC-008).

- [ ] T019 [P] [US3] [tier:balanced] Unit test: each generator is deterministic (byte-identical output for identical input); a mutated committed view → `view-drift` finding — in `tests/unit/bibliography/regenerate.test.ts`.
- [ ] T020 [US3] [tier:balanced] Implement `src/bibliography/regenerate.ts`: one pure generator per legacy view (`sources.csv`, `acquisition-tracker.csv`, archive `acquisition-register.csv`, `PB-P00X.yml` stub), each `(model) => string` in fixed field/column order (reuse the `provenance.ts` single-line-scalar discipline), per research R-006 + contracts/source-record.md §Serialization.
- [ ] T021 [US3] [tier:balanced] Implement `bib regenerate` (writes views) and `bib regenerate --check` / the `view-drift` branch of `bib validate` (in-memory regeneration diffed against the committed file), per contracts/cli.md + validation.md.
- [ ] T022 [US3] [tier:balanced] Convert the legacy files to generated-and-committed views (run `bib regenerate`, commit outputs); confirm one SSOT title edit propagates to `sources.csv` via regeneration with zero manual edits and no representation left disagreeing (SC-003/SC-004).

**Checkpoint**: SSOT is the only hand-edited source; views are reproducible + drift-checked.

---

## Phase 6: User Story 4 - Enumerate issues of a serial and roll up its assets (Priority: P3)

**Goal**: A serial's Repository Record enumerates its issues from the census; every copy references an asset manifest, not a single checksum.
**Independent test**: `bib show PB-P001 --json` issue count equals census `totalIssues` (78); copies reference a manifest (SC-006).

- [ ] T023 [P] [US4] [tier:balanced] Unit test: for a serial, derived `issues` length == census `totalIssues`; each Repository Record exposes an `AssetManifestRef` (not a scalar checksum); a monograph has no Issue layer — in `tests/unit/bibliography/issues.test.ts`.
- [ ] T024 [US4] [tier:balanced] Extend `src/bibliography/derive.ts`: for `kind === 'periodical'`, derive `Issue[]` from `data/census/<sourceId>-*.json` (reuse `src/census/load.ts`), attaching each issue's assets from provenance; monographs reference assets directly (no Issue layer), per research R-005 + data-model.md §Issue.
- [ ] T025 [US4] [tier:balanced] Implement the `AssetManifestRef` roll-up (`manifestPath`, derived `assetCount`, `objectStore | null`, `localPath` fallback) from provenance in `src/bibliography/derive.ts`; ensure no single-`checksum` representation survives (FR-006/FR-011).

**Checkpoint**: serials represented faithfully; manifest replaces single checksum.

---

## Phase 7: User Story 5 - Validate referential integrity across the layers (Priority: P3)

**Goal**: Every Asset → a Repository Record → a Source; no leaks; closed vocab; required core; unique copies.
**Independent test**: seeded orphan asset, orphan record, and a Source-level copy-id are each reported; a consistent tree reports success (SC-007).

- [ ] T026 [P] [US5] [tier:balanced] Unit test: `orphan-asset`, `orphan-record`, `duplicate-copy`, `single-checksum`, `vocab`, `missing-required` each reported with a locating message; a clean tree → `findings: []` — in `tests/unit/bibliography/validate-integrity.test.ts`.
- [ ] T027 [US5] [tier:balanced] Implement the referential-integrity, vocab, required-core, uniqueness, and manifest-not-checksum checks in `src/bibliography/validate.ts`, composing with the US2 leak check; throw only on malformed input, findings otherwise, per contracts/validation.md.
- [ ] T028 [US5] [tier:balanced] Finalize `bib validate` to run the full finding set with exit codes `0` clean / `1` findings / `2` malformed (human + `--json`), per contracts/cli.md.

**Checkpoint**: full validator green on the migrated tree.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T029 [P] [tier:balanced] Retire `src/archive/source-registry.ts`: mark `@deprecated`, migrate importers to `src/bibliography/load.ts`, and remove the singular `sourceArchive` path (the overwrite bug's origin); confirm the `check-deprecations` gate reports it safe-to-delete (importers = 0), per research R-007.
- [ ] T030 [P] [tier:fast] Walk quickstart.md scenarios 1–5; confirm `npm test` (unit + integration) and `npm run typecheck` are green.
- [ ] T031 [P] [tier:fast] Verify all new files are ≤300–500 lines, use `@/` imports, and contain no `any`/`as`/`@ts-ignore`.

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** block everything.
- **US1 (P3)** is the MVP and depends only on Foundational.
- **US2, US3, US4** each depend on Foundational; US2/US5 share `validate.ts` (US5 composes US2's leak check → do US2 before US5's final wiring). US3 depends on the model + derive. US4 extends `derive.ts` (after Foundational).
- **US5 (Phase 7)** composes the US2 leak check; run after US2.
- **Polish (P8)** last (retirement needs the SSOT populated by US1/US3).

Story completion order: US1 → US2 → US3 → US4 → US5 (priority order; US2–US5 are independently testable once Foundational lands).

## Parallel Opportunities

- Phase 2: T003, T004, T005, T006 are `[P]` (distinct files); T008 parallel with them; T007 after T003–T005; T009 after T003/T004; T010 after T009.
- Test-first tasks (T012, T016, T019, T023, T026) are `[P]` and can be written before their implementation tasks.
- Phase 8: T029/T030/T031 all `[P]`.

## Implementation Strategy

- **MVP = Phase 1 + Phase 2 + Phase 3 (US1)**: the multi-archive model, SSOT loader/deriver, migration, and PB-P001 restoration — the exact data-loss bug fixed, demonstrable via `bib show PB-P001`.
- **Incremental**: layer US2 (identifier discipline), US3 (consolidation + drift), US4 (serials/manifest), US5 (full validation), then Polish (retire the legacy registry).

## Task Count

- Total: **31 tasks** (T001–T031).
- Setup 2 · Foundational 9 · US1 4 · US2 3 · US3 4 · US4 3 · US5 3 · Polish 3.
