---
description: "Task list for Gallica Fetcher implementation"
---

# Tasks: Gallica Fetcher

**Input**: Design documents in `specs/001-gallica-fetcher/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: INCLUDED — the plan and quickstart define a `vitest` unit + integration strategy against recorded fixtures.

**Organization**: grouped by user story (US1 census → US2 image mirror → US3 OCR) so each is independently implementable and testable.

**Status**: all tasks complete (implemented, tested, committed) as of 2026-07-08.

## Format: `[ID] [P?] [Story] [tier:label] Description with file path`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1/US2/US3 (setup, foundational, polish carry no story label)
- **[tier:label]**: model tier for dispatch — `fast`=haiku (mechanical), `balanced`=sonnet (standard impl/tests), `powerful`=opus (safety-critical correctness). Resolved via `.stack-control/config.yaml` `tier_map`.

## Path Conventions

Single project at repo root: `src/`, `tests/`, `data/`.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [tier:fast] Create the source/test/data tree per plan.md (`src/{model,gallica,rights,census,archive,fetch,ocr,cli}`, `tests/{unit,integration,fixtures}`, `data/census/`)
- [x] T002 [tier:fast] Initialize `package.json` at repo root (ESM, `tsx`, `vitest`, dependency `fast-xml-parser`, bin → `src/index.ts`, scripts `gallica`/`test`)
- [x] T003 [P] [tier:fast] Configure `tsconfig.json` — strict, `paths: { "@/*": ["src/*"] }`, no implicit `any`
- [x] T004 [P] [tier:fast] Configure `vitest.config.ts` with the matching `@/` alias
- [x] T005 [P] [tier:fast] Add `.gitignore` for `node_modules/`, and confirm `data/census/` is tracked but archive assets never live here

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shared building blocks every story needs. Complete before Phase 3.

- [x] T006 [P] [tier:balanced] Define model types in `src/model/` (`Source`, `Census`, `CensusIssue`, `Issue`, `Rights`, `Asset`, `Provenance`) per data-model.md — types only, no logic, no inheritance
- [x] T007 [tier:powerful] Implement `HttpClient` in `src/gallica/http-client.ts` — `fetch` wrapper with the project User-Agent, ≤2 concurrent + ~1 req/s rate limit, exponential backoff on 429/403/5xx then throw (fail loud, no silent skip)
- [x] T008 [P] [tier:balanced] Unit test rate-limit + backoff-then-throw in `tests/unit/http-client.test.ts`
- [x] T009 [tier:balanced] Implement CLI skeleton `src/index.ts` + `src/cli/parse.ts` — `node:util.parseArgs`, global flags `--dry-run`/`--force`/`--verify`/`--ocr`, command dispatch, stderr+non-zero on error
- [x] T010 [P] [tier:fast] Add recorded fixtures in `tests/fixtures/` — `Issues` (years + 1879) XML, `Pagination` XML, `OAIRecord` XML (public-domain + a non-public-domain variant), a tiny IIIF JPEG

**Checkpoint**: network boundary, types, CLI dispatch, and fixtures exist.

---

## Phase 3: User Story 1 — Build an authoritative issue census (P1) 🎯 MVP

**Goal**: periodical ark → deterministic per-source census JSON in the public repo; resolves the run-length conflict.

**Independent test**: run `census` against `ark:/12148/cb328261098/date` → 78 issues 1879–1885 with ark/date/pageCount; re-run byte-identical.

- [x] T011 [P] [US1] [tier:balanced] `GallicaClient.issues()` + `.pagination()` in `src/gallica/gallica-client.ts` — parse via `fast-xml-parser` per contracts/gallica-api.md
- [x] T012 [US1] [tier:balanced] Census builder in `src/census/build.ts` — periodical ark → `Census`; normalize host dates to `YYYY-MM-DD`; attach `pageCount`; sort issues by date
- [x] T013 [US1] [tier:powerful] Deterministic serializer in `src/census/serialize.ts` — fixed key order, sorted issues, 2-space indent, trailing newline (FR-002)
- [x] T014 [US1] [tier:balanced] `census` command in `src/cli/census.ts` — write `data/census/<sourceId>-<slug>.json`; `--dry-run` reports target + issue count, writes nothing
- [x] T015 [P] [US1] [tier:balanced] Unit test parse + serialize determinism in `tests/unit/census.test.ts` (fixtures)
- [x] T016 [US1] [tier:balanced] Integration test `census` against fixtures → 78 issues / 1879–1885 in `tests/integration/census.test.ts`

**Checkpoint**: US1 shippable on its own (metadata-only, no archive/rights/OCR).

---

## Phase 4: User Story 2 — Mirror full-resolution page images (P2)

**Goal**: rights-gated, resumable, guarded fetch of full-native page images + provenance into the private archive; dry-run.

**Independent test**: `fetch-issue ark:/12148/bpt6k5603637g` → 12 images + sidecars inside `../colony-cults-archive`, none outside; re-run skips; rights-fail item throws.

- [x] T017 [P] [US2] [tier:balanced] `GallicaClient.oaiRecord()` + `.iiifInfo()` + `.iiifImage()` in `src/gallica/gallica-client.ts`
- [x] T018 [P] [US2] [tier:powerful] Rights gate in `src/rights/gate.ts` — parse `dc:rights`, `assertPublicDomain(ark)` throws on non-public-domain/absent, capture `rawResponse` (FR-004/005)
- [x] T019 [US2] [tier:powerful] Archive location + non-overridable guard in `src/archive/location.ts` — resolve `../colony-cults-archive`; `assertInsideArchive(path)` throws on escape (FR-006, no override)
- [x] T020 [P] [US2] [tier:balanced] sha256 checksum util in `src/archive/checksum.ts`
- [x] T021 [US2] [tier:balanced] Provenance sidecar writer in `src/archive/provenance.ts` — `<asset>.provenance.json` per data-model.md
- [x] T022 [US2] [tier:powerful] Asset store in `src/archive/store.ts` — write asset + sidecar inside archive; skip-if-checksum-recorded resumability; `--force` re-fetch; `--verify` re-hash (FR-008/009)
- [x] T023 [US2] [tier:powerful] Fetch pipeline in `src/fetch/issue.ts` — rights gate → enumerate pages → fetch full-native JPEG → store (images-only)
- [x] T024 [P] [US2] [tier:balanced] Dry-run size estimation in `src/fetch/estimate.ts` — page counts + sampled HEAD sizes
- [x] T025 [US2] [tier:balanced] `fetch-issue` + `fetch-source` commands in `src/cli/fetch.ts` — `--dry-run` prints per-issue rights status, paths, estimated size (FR-010)
- [x] T026 [P] [US2] [tier:balanced] Unit test guard refusal on escape path in `tests/unit/archive-guard.test.ts`
- [x] T027 [P] [US2] [tier:balanced] Unit test rights gate (public-domain passes / other throws) in `tests/unit/rights.test.ts`
- [x] T028 [US2] [tier:balanced] Integration test fetch-issue flow + resumability + guard against fixtures in `tests/integration/fetch.test.ts`

**Checkpoint**: US2 independently deliverable via `fetch-issue`; `fetch-source` iterates the US1 census.

---

## Phase 5: User Story 3 — Produce searchable OCR (P3)

**Goal**: turn already-fetched images into searchable PDF/A + text sidecar via self-OCR; toolchain preflight; decoupled/optional.

**Independent test**: `ocr ark:/12148/bpt6k5603637g` on an issue with images → `issue.pdf` (searchable) + `issue.txt` + provenance; missing toolchain fails loud.

- [x] T029 [P] [US3] [tier:balanced] OCR dependency preflight in `src/ocr/preflight.ts` — check `ocrmypdf`/`img2pdf`/`pdftotext`/Tesseract-`fra`; throw with install guidance; only when OCR requested (FR-013)
- [x] T030 [US3] [tier:balanced] OCR pipeline in `src/ocr/run.ts` — `img2pdf` → `ocrmypdf --deskew --rotate-pages --language fra --output-type pdfa` → `pdftotext`; store PDF/A + txt + provenance; set `ocrStatus` (FR-011/012)
- [x] T031 [US3] [tier:balanced] Wire `--ocr` into fetch and add `ocr` command in `src/cli/ocr.ts` — OCR an already-fetched issue without re-download
- [x] T032 [P] [US3] [tier:balanced] Unit test preflight failure message in `tests/unit/ocr-preflight.test.ts`
- [x] T033 [US3] [tier:balanced] Integration test `ocr` (stubbed tool presence) in `tests/integration/ocr.test.ts`

**Checkpoint**: full census + image + OCR pipeline complete.

---

## Phase 6: Polish & Cross-Cutting

- [x] T034 [P] [tier:balanced] Generalize to monograph sources — `kind === 'monograph'` skips census, fetches the single document (FR-016) in `src/fetch/issue.ts` + census guard
- [x] T035 [P] [tier:fast] Author `README.md` usage referencing the quickstart scenarios
- [x] T036 [tier:balanced] Run full `vitest` suite + typecheck; confirm quickstart Scenarios 1–7 each map to a passing test; verify no file exceeds ~500 lines
- [x] T037 [P] [US2] [tier:balanced] Unit test dry-run writes nothing (asserts no filesystem writes; SC-006) in `tests/unit/dry-run.test.ts`
- [x] T038 [P] [US3] [tier:balanced] Integration test images-only run succeeds with OCR toolchain absent (SC-008) in `tests/integration/images-only-no-ocr.test.ts`

---

## Dependencies & Story Order

- **Setup (T001–T005)** → **Foundational (T006–T010)** → stories.
- **US1 (T011–T016)**: needs Foundational only. **MVP.**
- **US2 (T017–T028)**: needs Foundational; `fetch-source` also consumes US1's census (but `fetch-issue` is testable without US1).
- **US3 (T029–T033)**: needs US2 (operates on fetched images).
- **Polish (T034–T038)**: after the stories it touches.

## Parallel Execution Examples

- Setup: T003, T004, T005 in parallel after T001/T002.
- Foundational: T006, T008, T010 in parallel (distinct files).
- US2: T017, T018, T020, T024, T026, T027 in parallel (distinct files) before the sequential wiring (T019→T021→T022→T023→T025→T028).

## Implementation Strategy

- **MVP first**: deliver US1 (census) end-to-end — it independently resolves issue #2 and carries zero copyright risk.
- **Increment 2**: US2 (image mirror) — the preservation core, gated + guarded + resumable.
- **Increment 3**: US3 (OCR) — the searchable-text layer, optional and decoupled.
- Each increment is independently testable via its quickstart scenario and vitest suite.

## Model tiers (risk-based)

- **powerful (opus)**: safety-critical correctness — T007 (politeness/backoff), T013 (determinism), T018 (rights gate), T019 (non-overridable guard), T022 (resumability/integrity), T023 (fetch orchestration).
- **fast (haiku)**: mechanical — T001–T005 (scaffolding/config), T010 (fixtures), T035 (README).
- **balanced (sonnet)**: everything else (standard implementation + tests).

**Total tasks**: 38 (Setup 5, Foundational 5, US1 6, US2 13, US3 6, Polish 3). T037/T038 added by `/speckit-analyze` to close SC-006 / SC-008 test coverage.
