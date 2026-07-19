# Tasks: Papers Past Acquisition Adapter

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Origin**: TASK-39 / SRCH-0018-0019

## Format: `[ID] [P?] [Story?] [tier:X] Description with file path`

Tests are requested (FR-015, quickstart) → test-first (RED→GREEN). Tier labels: `fast` (haiku), `balanced` (sonnet), `powerful` (opus).

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [tier:fast] Create `src/repository/papers-past/`, `tests/unit/repository/papers-past/`, and `tests/integration/repository/papers-past/`; add a test fixture `tests/unit/repository/papers-past/fixtures/de-rays-article.html` copied from the persisted capture `bibliography/repository-responses/papers-past-article/papers-past-article-hns18840103-2-19-3-*.html`.

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T002 [P] [tier:fast] Add `'papers-past'` to `CopyLevelIdentifierType` + `COPY_LEVEL_TYPES` in src/model/identifiers.ts.
- [ ] T003 [P] [tier:fast] Add `'papers-past'` to the `RepositoryName` union in src/repository/adapter.ts.
- [ ] T004 [P] [tier:fast] Define the pure parse-result interface `ParsedArticle` in src/repository/papers-past/types.ts: `{ articleId: string; title: string; imageLocators: { url: string; sequence: number }[]; newspaper?: string; date?: string; page?: string; rightsRaw: string; ocrText?: string }` (interface-first; parse.ts + adapter.ts import it). `ocrText` is OPTIONAL — OCR is out of scope as an acquired asset (clarified 2026-07-19); the field only documents the on-page text if present. (No `AcquiredAsset` role addition — the sole acquired role is the existing `page-master`.)
- [ ] T005 [tier:fast] Add the dispatch row `'papers-past' → 'papers-past'` to `IDENTIFIER_TYPE_REPOSITORY` in src/repository/registry.ts, and a unit test that `selectForRecord` routes a `papers-past` copy to the papers-past repository (and nothing else does).
- [ ] T006 [tier:balanced] Implement the mechanical article parse in src/repository/papers-past/parse.ts (pure, HTML string → `ParsedArticle` from types.ts): articleId, title (h3), imageLocators sequenced by `area`, newspaper/date/page, rightsRaw, and an OPTIONAL ocrText (`#text-tab`; absent → `undefined`, never fabricated); fail-loud on a missing article id or zero image locators. Reuse node-html-parser and the selectors confirmed in src/sourcequery/sources/papers-past-article.ts.
- [ ] T007 [P] [tier:balanced] Unit test src/repository/papers-past/parse in tests/unit/repository/papers-past/parse.test.ts against the de-rays fixture: article id `HNS18840103.2.19.3`, title contains "CONVICTION OF MARQUIS DE RAYS", 3 sequenced imageserver locators, rightsRaw contains "No known copyright", and the optional ocrText — when present — contains "found guilty and sentenced to four years"; parse of a non-article page throws.

## Phase 3: User Story 1 — Acquire one public-domain article end-to-end (P1) 🎯 MVP

**Goal**: `bib acquire` mirrors a PD Papers Past article's page-image facsimile into archive + B2, idempotent + dry-run-safe. (OCR is out of scope — produced downstream by the existing OCR pipeline; clarified 2026-07-19.)
**Independent test**: drive `acquire` on a public-domain record with fakes → page-master assets put under `archive/papers-past/<id>/`, idempotent re-run, dry-run writes nothing.

- [ ] T008 [P] [US1] [tier:balanced] Add the shared fakes in tests/unit/repository/papers-past/fakes.ts: a `FakeBrowserSession` (scripts the fixture HTML for the article URL — reuse the spec-014 fake shape), a fake `byteFetch` (`getBytes` returns scripted image bytes / a scripted challenge body), and a fake `ObjectStore` (records `head`/`put`).
- [ ] T009 [US1] [tier:powerful] Implement `PapersPastAdapter.resolve` in src/repository/papers-past/adapter.ts: navigate the article URL via the injected `BrowserSession`, persist the raw page BEFORE parsing (persist-before-analysis, reuse src/sourcequery/persistence), then `parse` → map the `ParsedArticle` to a `ResolvedRepositoryItem` (identifiers, title, sequenced `page-master` assetLocators, and `metadata: GroundedExtraction<MuseumItemFields> = { date }` where `date` is a mechanically-built `GroundedField` — follow the IA convention (`src/repository/internet-archive/rights.ts`): `GroundedField` hard-codes `provenance.modelAssisted: true` as a documented type limitation, so name `engine`/`model` to the mechanical parse (NOT a model call). Carry the verbatim `rightsRaw` + `jurisdiction: 'NZ'` + grounded `date` via a `WeakMap<ResolvedRepositoryItem, RightsEvidence>` keyed by the resolved item — the IA rights-evidence pattern (`src/repository/internet-archive/adapter.ts`), read back by `collectRightsEvidence`; NO shared-contract change. The optional `ocrText` is NOT propagated. Constructor DI: `{ browserSession, byteFetch, objectStore?, now }`. Fail-loud on missing id/assets.
- [ ] T010 [US1] [tier:balanced] Implement the deterministic object-key + checksum helpers in src/repository/papers-past/adapter.ts (or a keys.ts): `archive/papers-past/<sanitized-id>/<sha256>.<ext>`; sha256 via @/archive/checksum.
- [ ] T011 [US1] [tier:powerful] Implement `PapersPastAdapter.acquire` (result/empty happy path): for each image locator (in `area` order) `byteFetch.getBytes` → image-validity guard (magic-byte/content sniff; non-image/challenge → THROW) → sha256 → `objectStore.head` idempotency (present+match → skip, else `put` with `role: page-master`, sequence); dry-run → empty assets + no put; remote-change/identity mismatch → THROW; return the typed `AcquisitionResult`. (No OCR companion write — OCR out of scope; clarified 2026-07-19.)
- [ ] T012 [US1] [tier:powerful] Unit test the adapter in tests/unit/repository/papers-past/adapter.test.ts: resolve-from-fixture; acquire puts 3 page-masters under the deterministic keys; idempotent re-run (head-match → 0 duplicate puts); dry-run → 0 puts, 0 mutation; image-validity guard (scripted challenge body → throws, never mirrored).
- [ ] T013 [US1] [tier:balanced] Add `buildPapersPastAdapterForMember` in src/cli/bib-acquire-papers-past.ts (mirror src/cli/bib-acquire-museum.ts): build `new PapersPastAdapter({ browserSession: real spec-014 BrowserSession, byteFetch: new HttpClient(), objectStore: new S3ObjectStore(resolveObjectStoreConfig()), now })` ONLY when the selected copy's identifier type is `papers-past`, else return undefined.
- [ ] T014 [US1] [tier:balanced] Wire `buildPapersPastAdapterForMember` into `runAcquireCli` (src/cli/bib-sourcegroup-acquire.ts) and register the adapter so `runAcquire`'s registry `selectForRecord` dispatches a `papers-past` copy to it; honor the shared `--dry-run`/`--archive`.
- [ ] T015 [P] [US1] [tier:balanced] Create the de Rays article `Source` + `papers-past` `RepositoryRecord` in bibliography/sources/PB-P0NN.yml (kind periodical, case `port-breton`, sourceUrl = the article page, identifier `{type: papers-past, value: HNS18840103.2.19.3}`), and a minimal NZ-press source-group it is `partOf`, with `status: approved-for-acquisition`.

**Checkpoint**: US1 is the shippable MVP — a governed, rights-gated, idempotent acquisition of one PD article.

## Phase 4: User Story 2 — Evidence-first, fail-closed rights (P2)

**Goal**: the adapter proposes rights EVIDENCE only; acquire refuses fail-loud without an operator public-domain assessment.
**Independent test**: collectRightsEvidence returns the NZ statement no-verdict; acquire on an unassessed/restricted record throws before any fetch/store.

- [ ] T016 [P] [US2] [tier:balanced] Implement `PapersPastAdapter.collectRightsEvidence` in src/repository/papers-past/adapter.ts: return the `RightsEvidence` cached during `resolve` in the `WeakMap<ResolvedRepositoryItem, RightsEvidence>` (the IA pattern) — verbatim "No known copyright (New Zealand)" `rightsRaw` + `jurisdiction: 'NZ'` + the grounded article `date`; NO `rightsStatus` (fail loud if the item is not one this adapter's own `resolve` returned).
- [ ] T017 [US2] [tier:powerful] Add the fail-closed rights gate at the TOP of `acquire`: throw a descriptive error unless `record.rightsAssessment?.rightsStatus === 'public-domain'`, BEFORE any `byteFetch`/`objectStore` call (0 side effects on refuse).
- [ ] T018 [P] [US2] [tier:balanced] Unit tests in adapter.test.ts: `collectRightsEvidence` returns the NZ evidence with no verdict; `acquire` on a record with no assessment AND one assessed `restricted` both throw, and the fake `byteFetch`/`ObjectStore` record 0 calls (SC-002/SC-004).

## Phase 5: User Story 3 — Governed hybrid fetch + inventory (P3)

**Goal**: the WAF-gated read goes through the governed browser (persist-first); images via the acquisition client; papers-past is an inventoriable repository.
**Independent test**: resolve reads via the injected governed BrowserSession and persists the raw page before parsing; inventory recognizes papers-past.

- [ ] T019 [US3] [tier:balanced] Assert-and-harden the governed read path: a unit test that `resolve` calls the injected `BrowserSession.navigate` and persists the raw page BEFORE `parse` runs (persist-before-analysis ordering), and that image bytes flow through the injected `byteFetch` (never an ad-hoc fetch).
- [ ] T020 [P] [US3] [tier:fast] Add `papers-past` to the `bib inventory` repository allowlist in src/cli/bib-inventory.ts (the `value === 'gallica' || value === 'new-italy-museum' || value === 'internet-archive'` guard, ~L61, and the resolve-for-inventory dispatch, ~L119) — parity with `gallica`/`new-italy-museum`/`internet-archive` (the actual `RepositoryName` values; "museum" is shorthand for `new-italy-museum`).

## Phase 6: Polish & Cross-Cutting

- [ ] T021 [P] [tier:balanced] Env-gated integration test tests/integration/repository/papers-past/acquire.test.ts: (a) image-CDN reachability — fetch one real `/imageserver/...` URL via HttpClient and assert a valid GIF (or a documented challenge → the browser-byte-fetch fallback per research R1); (b) live end-to-end `bib acquire` of the de Rays member into archive + B2, idempotent re-run. Gated on `RUN_PAPERS_PAST_ACQUIRE=1` + `npx playwright install chrome` + archive/B2 config.
- [ ] T022 [tier:balanced] Run `npx tsc --noEmit` + `npx vitest run tests/unit/repository/papers-past` and fix any type/lint/size issues (no `any`/`as`/`@ts-ignore`; files ≤ 500 lines — split adapter.ts/parse.ts/keys.ts if needed).
- [ ] T023 [P] [tier:fast] Add a one-time live-acquire smoke note to quickstart.md (Scenario 6) confirming the held facsimile + provenance after a real `bib acquire`.

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T007)** → **US1 (T008–T015)** → **US2 (T016–T018)** → **US3 (T019–T020)** → **Polish (T021–T023)**.
- T009 (resolve) precedes T011 (acquire) and T012 (adapter tests). T016/T017 (US2) extend the same adapter.ts, so run after US1's adapter core lands (T009/T011).

## Parallel Opportunities

- Foundational: T002, T003, T004 in parallel (distinct files: identifiers.ts / adapter.ts / types.ts); T006 (parse.ts) imports the T004 `ParsedArticle` type, so it follows T004; T007 parallel after T006.
- US1: T008, T015 parallel with the adapter core; T009→T010→T011→T012 sequential (same adapter.ts).
- US2: T016, T018 parallel; T017 sequential into acquire.
- US3: T020 parallel with T019.

## Implementation Strategy

MVP = US1 (T001–T015): a governed, rights-gated (US2's gate lands with the core), idempotent single-article acquisition. US2 hardens the rights invariant; US3 the governance + inventory; Polish the live validation.
