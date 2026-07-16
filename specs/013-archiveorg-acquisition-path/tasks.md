# Tasks: Internet Archive acquisition adapter

**Input**: Design documents from `specs/013-archiveorg-acquisition-path/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: INCLUDED — the spec mandates test-first development (FR-016 / Constitution VIII) and the
quickstart enumerates the contract scenarios each behavior must satisfy. Every behavioral task is
preceded by its failing test (TDD).

**Organization**: grouped by the five user stories (US1–US5, priorities P1–P3). Setup + Foundational
phases are shared prerequisites. Within each story: tests → implementation.

## Format: `[ID] [P?] [Story] [tier:label] Description`

- **[P]**: parallelizable (different file, no dependency on an incomplete task)
- **[Story]**: US1–US5 (user-story phases only)
- **[tier:label]**: model tier for model-sized dispatch — `fast` (haiku) / `balanced` (sonnet) / `powerful` (opus); "cheapest that does it correctly" (scaffolding/mechanical edits/test-authoring → `fast`/`balanced`; hard correctness-critical modules → `powerful`). Resolved by `stackctl resolve-tiers`. The `- [~]` operator-acceptance task (T055) carries no tier — it is excluded from dispatch.
- Exact file paths included. Single-project layout (`src/`), co-located `*.test.ts`, `__fixtures__/`.

**Conventions grounded in the codebase**: vitest (`npm test` → `vitest run`; `npm run typecheck`);
`@/` imports, no `any`/`as`/`@ts-ignore`; files ≤ 500 lines; injected fakes for HTTP client / poppler
runner / object store — no network/B2/live-poppler in tests; poppler shell-out composes
`@/ocr/exec` `execCommand`; polite `@/gallica/http-client` `HttpClient` (Principle XII, no curl).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: fixtures + directory scaffolding this feature's tests and code depend on.

- [ ] T001 [P] [tier:fast] Create the adapter package directory `src/repository/internet-archive/` with an empty `index.ts` barrel and a `__fixtures__/` dir.
- [ ] T002 [P] [tier:fast] Copy the captured de Groote metadata JSON into a test fixture at `src/repository/internet-archive/__fixtures__/metadata-nouvellefrancec00groogoog.json` (source: `bibliography/repository-responses/PB-P002/archiveorg-metadata-nouvellefrancec00groogoog-2026-07-16.json`).
- [ ] T003 [P] [tier:fast] Author a minimal `scandata.xml` fixture at `src/repository/internet-archive/__fixtures__/scandata-nouvellefrancec00groogoog.xml` (a handful of leaves: `pageType` Cover/Title/Normal + recorded page dimensions) sufficient to drive the range-seed and fidelity tests.
- [ ] T004 [P] [tier:balanced] Author two tiny synthetic PDF fixtures under `__fixtures__/`: `single-image-page.pdf` (one page-covering raster object per page) and `overlay-page.pdf` (a page with a raster image plus a vector/text overlay) for the page-to-leaf extraction tests.

**Checkpoint**: fixtures exist; the feature has real, offline test inputs.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the closed-vocabulary widenings, new model types, and the poppler runner — every user
story depends on these. No user-story work starts until Phase 2 is done.

### Model + vocabulary (data-model.md)

- [ ] T005 [P] [tier:fast] Test (`src/model/identifiers.test.ts`) that `CopyLevelIdentifierType` accepts `'ia-item'`; then add `'ia-item'` to the union in `src/model/identifiers.ts`.
- [ ] T006 [P] [tier:fast] Test (`src/repository/adapter.test.ts`, extend) that `RepositoryName` accepts `'internet-archive'`; then add it to the union in `src/repository/adapter.ts`.
- [ ] T007 [P] [tier:fast] Narrow `AcquiredAsset.role` to `AcquiredAssetRole = 'front' | 'reverse' | 'page' | 'repository-source' | 'page-master'` in `src/model/acquired-asset.ts` with a test in `src/model/acquired-asset.test.ts` asserting the new values type-check and the old ones still compile.
- [ ] T008 [tier:balanced] Create `src/model/quality-assessment.ts` with `QualityAssessment`, `LeafRange`, `ExcludedLeaf`, and `PageMethodProvenance` types (per data-model.md) + `src/model/quality-assessment.test.ts` covering shape/required fields; export from `src/model/index.ts`.
- [ ] T009 [tier:balanced] Add optional `qualityAssessment?: QualityAssessment` and `excludedLeaves?: ExcludedLeaf[]` to `RepositoryRecord` in `src/model/repository-record.ts`; extend `src/model/repository-record.test.ts` to construct a record carrying both.

### Registry dispatch (INV-D / IA-INV-G)

- [ ] T010 [tier:fast] Test (extend `src/repository/registry.test.ts`) that a record with an `ia-item` identifier dispatches to `'internet-archive'` and that `ark`/`accession` are unaffected; then add `ia-item: 'internet-archive'` to `IDENTIFIER_TYPE_REPOSITORY` in `src/repository/registry.ts`.

### Poppler runner (new reusable primitive — research D-6)

- [ ] T011 [tier:balanced] Test (`src/pdf/poppler/runner.test.ts`) the `PopplerRunner` interface against a fake `execCommand`: `imagesList(pdf)` parses `pdfimages -list` rows (per-page image dimensions + object ids), `info(pdf)` parses `pdfinfo` page count, `extractImage`/`rasterise` build the correct `pdfimages`/`pdftoppm` argv. Assert no real process is spawned.
- [ ] T012 [tier:balanced] Implement `src/pdf/poppler/runner.ts` — `PopplerRunner` interface + real impl composing `@/ocr/exec` `execCommand`; fail loud (non-zero exit → descriptive error). Keep ≤ 300 lines.
- [ ] T013 [P] [tier:fast] Extend `src/ocr/preflight.ts` (or add a poppler-preflight helper) to assert `pdfimages`/`pdftoppm`/`pdfinfo` are on PATH, with a test.

**Checkpoint**: types compile (`npm run typecheck` green), registry dispatches `ia-item`, poppler runner
is unit-tested against a fake. `npm test` green.

---

## Phase 3: User Story 1 — Acquire a public-domain IA book end-to-end (P1)

**Goal**: an approved public-domain item's PDF is fetched, gated, exploded, and (with the source PDF
preserved) uploaded to B2; `reconcile` → `archived`; `coverage` shows it held.

**Independent test**: acquire `nouvellefrancec00groogoog` (with a recorded PD `rightsAssessment`) →
per-page masters + source PDF in B2, record `archived`, `bib coverage` shows it held. Re-acquire is
idempotent (INV-E).

> Depends on Phase 2. US1 also depends on the resolve/rights/extract pieces; the resolve + rights slices
> (US3) and extraction slice (US4) are foundational to a *full* US1 run, so within this phase the
> shared adapter scaffold is built first and the story-specific end-to-end wiring last.

### Adapter scaffold + metadata + file selection

- [ ] T014 [US1] [tier:balanced] Test `src/repository/internet-archive/metadata.test.ts` (using the T002 fixture): parse item metadata → typed `{ mediatype, title, creator, date, possibleCopyrightStatus, scanner, files[] }`; throw on non-`texts` mediatype / missing item.
- [ ] T015 [US1] [tier:balanced] Implement `src/repository/internet-archive/metadata.ts` — archive.org metadata client (`https://archive.org/metadata/<id>` via injected `client.getText`) + typed parse. ≤ 300 lines.
- [ ] T016 [US1] [tier:balanced] Test `src/repository/internet-archive/file-select.test.ts`: selects the primary page-image PDF; **throws** on ambiguous equally-eligible PDFs; rejects OCR-only-when-page-image-exists and encrypted/restricted; locates `scandata.xml` and the image-set zip (`_jp2.zip` **or `_tif.zip`** — de Groote is `_tif.zip`) (FR-003 / SC-006 / IA-INV-A).
- [ ] T017 [US1] [tier:balanced] Implement `src/repository/internet-archive/file-select.ts` — deterministic selection per data-model.md. ≤ 300 lines.
- [ ] T018 [US1] [tier:balanced] Test `src/repository/internet-archive/adapter.test.ts` — `resolve`: returns `identifiers: [{ia-item,id}]`, non-empty `title`, `sourceUrl` = details page, `assetLocators` for the selected files; throws (IA-INV-A) on unverifiable id.
- [ ] T019 [US1] [tier:balanced] Implement the `InternetArchiveAdapter` skeleton in `src/repository/internet-archive/adapter.ts` (constructor DI per contract `InternetArchiveAdapterDeps`; `repository = 'internet-archive'`; `resolve` wired to metadata + file-select). Barrel-export from `index.ts`.

### Metadata snapshot + staging + object-store layout

- [ ] T020 [US1] [tier:balanced] Add an `IA_NORMALIZATION_VERSION = 1` constant and a test asserting `resolve`/inventory persists a snapshot via `@/sourcegroup/snapshot` `writeSnapshot({ sourceId, ark: itemId, endpoint, ... })` under `bibliography/repository-responses/<sourceId>/`.
- [ ] T021 [US1] [tier:balanced] Test the staging helper (`src/repository/internet-archive/staging.test.ts` or within adapter test): PDF fetched to `COLONY_ARCHIVE_ROOT` scratch subdir, fixity (byteLength, sha256 via `@/archive/checksum`) recorded; deleted on success, retained on rejection.
- [ ] T022 [US1] [tier:balanced] Implement staging + fixity recording (in `adapter.ts` or a small `staging.ts` if size demands) and the `archive/internet-archive/<id>/{source,pages}/…` object-store key layout helper with a test.

### End-to-end acquire + idempotency + CLI wiring

- [ ] T023 [US1] [tier:balanced] Test `adapter.test.ts` `acquire` happy path (fakes for client/poppler/objectStore, fixtures for metadata/scandata/PDF): produces N `page-master` assets + 1 `repository-source` asset, uploads to B2 (fake `put`), returns `AcquisitionResult { complete, reconciliationRequired: true }`.
- [ ] T024 [US1] [tier:balanced] Test idempotent re-acquire (IA-INV-E): assets already present by key + verified checksum are skipped (no re-fetch, no duplicate `put`); a recorded asset whose remote bytes changed → **throws**, writes nothing for it.
- [ ] T025 [US1] [tier:powerful] Implement the `acquire` orchestration in `adapter.ts` (rights gate → fetch → quality gate → master-select → extract → upload → result), delegating to the US3/US4/US5 modules. Keep `adapter.ts` ≤ 500 lines (extract sub-steps into the sibling modules).
- [ ] T026 [US1] [tier:balanced] Register the IA adapter in `buildRegistry(...)` in `src/sourcegroup/acquire.ts` with a test proving an `ia-item` record routes to it and Gallica/museum still route correctly.
- [ ] T027 [US1] [tier:balanced] Create `src/cli/bib-acquire-internet-archive.ts` `buildInternetArchiveAdapterForMember(sourcesDir, id, archive?)` (mirrors `buildMuseumAdapterForMember`: builds the adapter only when the selected copy is an `ia-item` record) + test.
- [ ] T028 [US1] [tier:balanced] Wire the IA peek-builder into `runAcquireCli` in `src/cli/bib-sourcegroup.ts`; extend the `asRepositoryName` allowlist in `src/cli/bib-inventory.ts` to accept `internet-archive` (route to IA inventory). Tests for both.

**Checkpoint**: US1 acceptance scenarios pass in unit form; `ia-item` acquire is dispatchable and
idempotent. This is the **MVP**.

---

## Phase 4: User Story 2 — Fail-closed quality gate before shared storage (P1)

**Goal**: a poor/incomplete/wrong scan is refused with nothing written to B2; a sound one proceeds with
an approved leaf range recorded as canonical provenance.

**Independent test**: mark a staged item `unsound` → zero B2 bytes, record not advanced; mark another
`sound` with an approved range → only that range produced.

- [ ] T029 [US2] [tier:balanced] Test the `QualityGate` seam (`src/repository/internet-archive/quality-gate.test.ts`): an `unsound` assessment halts acquire, **zero** `objectStore.put` calls, staging retained, status not advanced (SC-002 / IA-INV-C).
- [ ] T030 [US2] [tier:balanced] Test that `acquire` re-verifies the staged PDF sha256 == `qualityAssessment.sourceFileChecksum` and **throws** on mismatch before acting (FR-008 edge case).
- [ ] T031 [US2] [tier:balanced] Test that `scandata.xml` `pageType` **seeds** a proposed `approvedLeafRange` (Cover/Title excluded from the seed) but a non-`Normal` leaf can still be included by the operator (seed never decides).
- [ ] T032 [US2] [tier:balanced] Implement the quality-gate integration in `adapter.ts` (inject `QualityGate`; persist `QualityAssessment` onto the record; enforce `sound`-only + checksum re-verify) and the scandata-seeded range proposal in `src/repository/internet-archive/scandata.ts`. ≤ 300 lines each.
- [ ] T033 [US2] [tier:balanced] Test `scandata.ts` parse in isolation: `pageType` per leaf + recorded page dimensions extracted from the fixture.

**Checkpoint**: acquisition cannot write to B2 without a `sound` gate; range is operator-owned.

---

## Phase 5: User Story 3 — Rights as proposed evidence, authored judgment (P2)

**Goal**: adapter proposes rights evidence; operator authors the canonical `rightsAssessment`; `acquire`
refuses any record without a recorded public-domain judgment.

**Independent test**: `collectRightsEvidence` returns raw IA status + grounded date/creator and no
verdict; `acquire` on a record whose `rightsAssessment` is absent/`restricted`/`uncertain` throws before
any fetch.

- [ ] T034 [P] [US3] [tier:balanced] Test `src/repository/internet-archive/rights.test.ts`: `collectRightsEvidence` returns `rightsRaw` = `possible-copyright-status` + grounded `date`/`creator`, sets **no** `rightsStatus` (FR-004); a scanner/Google notice is preserved verbatim and not declared void (FR-006).
- [ ] T035 [US3] [tier:balanced] Implement `src/repository/internet-archive/rights.ts` — `collectRightsEvidence` per contract. ≤ 200 lines.
- [ ] T036 [US3] [tier:balanced] Test `acquire` rights gate (IA-INV-B / SC-004): throws **before any `client.getBytes`** unless `record.rightsAssessment?.rightsStatus === 'public-domain'` (parametrized over absent/restricted/uncertain).
- [ ] T037 [US3] [tier:balanced] Confirm the rights gate is the first step of `acquire` (wire `rights.ts` in `adapter.ts`); assert ordering with a test that fails if any fetch precedes the gate.

**Checkpoint**: copyright fail-closed proven; evidence never becomes a verdict.

---

## Phase 6: User Story 4 — Faithful per-page extraction with full provenance (P2)

**Goal**: the approved range becomes per-page masters under a strict page-to-leaf invariant, each with
extraction-method provenance; third-party leaves omitted from reading masters, retained in the source
PDF, and recorded; the source PDF preserved as a `repository-source` asset.

**Independent test**: single-embedded-image pages → `pdfimages-lossless`; multi-image/overlay page →
`pdftoppm-rasterised` at a recorded DPI; produced count == approved range; excluded leaves in
`excludedLeaves` + in the retained PDF but not in the masters.

- [ ] T038 [US4] [tier:balanced] Test `src/repository/internet-archive/extract.test.ts` (single-image fixture): a page with exactly one page-covering raster object + no overlay → extracted losslessly, records `method: 'pdfimages-lossless'` + `sourcePdfObject` (FR-010).
- [ ] T039 [US4] [tier:balanced] Test (overlay fixture): a non-single-image page → rasterised with `pdftoppm` at native DPI (from scandata; fallback 400), records `method: 'pdftoppm-rasterised'` + `resolutionDpi` (FR-010).
- [ ] T040 [US4] [tier:balanced] Test the count invariant: produced page-master count != approved leaf range → **throws** (FR-010 / SC-005).
- [ ] T041 [US4] [tier:balanced] Test excluded-leaf handling: excluded leaves absent from `page-master` assets, present in the retained `repository-source` PDF, recorded in `excludedLeaves` with classification + reason — never "discarded" (FR-011 / SC-003).
- [ ] T042 [US4] [tier:powerful] Implement `src/repository/internet-archive/extract.ts` — per-page page-to-leaf explosion via `PopplerRunner` (`imagesList` detection → lossless vs rasterise), count verification, `PageMethodProvenance` capture, `excludedLeaves` recording. ≤ 400 lines.
- [ ] T043 [US4] [tier:balanced] Test that `acquire` emits exactly one `repository-source` PDF asset (mediaType `application/pdf`, `role: 'repository-source'`) alongside the `page-master` assets (`role: 'page-master'`, `sequence` = logical page) (FR-012 / IA-INV-F); implement the asset assembly in `adapter.ts`.

**Checkpoint**: extraction is faithful, counted, and fully provenanced; no source evidence destroyed.

---

## Phase 7: User Story 5 — Robust source selection (fidelity + multi-file) (P3)

**Goal**: the master is chosen from measured evidence — explode the PDF when equivalent to the scan,
fetch the image set only when the PDF is materially degraded; deterministic-or-fail-loud on multi-file.

**Independent test**: PDF matching recorded scan dims → exploded (no image-set fetch); downsampled PDF →
image-set fetched + used; two equally-eligible page-image PDFs → resolve fails loud.

- [ ] T044 [US5] [tier:balanced] Test `src/repository/internet-archive/fidelity.test.ts`: median dimension ratio (pdfimages-list longest edge vs scandata recorded longest edge) **≥ 0.90** → explode PDF, **no** image-set fetch (research D-4).
- [ ] T045 [US5] [tier:balanced] Test: median ratio **< 0.90** → the image-set zip (`_jp2.zip`/`_tif.zip`) is fetched via `client.getBytes` and used as the master; record the master-source choice (IA-INV-E frugality: fetched only in this branch).
- [ ] T046 [US5] [tier:powerful] Implement `src/repository/internet-archive/fidelity.ts` — the dimension-ratio probe + explode-vs-fetch decision + spread sampling (min(10,N) pages). ≤ 300 lines.
- [ ] T047 [US5] [tier:balanced] Test the multi-file failure modes already selected in `file-select.ts` are surfaced end-to-end through `resolve` (ambiguous PDFs → throw; OCR-only rejected when page-image PDF exists; encrypted rejected) (FR-003 / SC-006).
- [ ] T048 [US5] [tier:balanced] Wire `fidelity.ts` into `acquire`'s master-select step (between the quality gate and extraction) with a test proving the image-set is fetched only on the degraded branch.

**Checkpoint**: master selection is evidence-driven and frugal; ambiguity fails loud.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T049 [P] [tier:balanced] Add the `--dry-run` semantics test (D-11 / TASK-29): `ctx.dryRun` performs the fetch + gate + extract to staging, writes **zero** B2 objects, retains staging, and the subsequent real run performs **no** re-download. Implement any `dryRun` handling needed in `adapter.ts`.
- [ ] T050 [P] [tier:fast] Assert the never-`bib migrate` invariant (INV-F) is honored by the IA path (no code path invokes migrate) — a guard test.
- [ ] T051 [P] [tier:fast] File-size audit: confirm every new/edited file is ≤ 500 lines (`adapter.ts` especially); refactor into the sibling modules if any exceeds it (Principle VII).
- [ ] T052 [P] [tier:balanced] Run the full quickstart contract-scenario matrix as an integration-style test pass (fakes only) and confirm each row maps to a passing test; fix gaps.
- [ ] T053 [tier:fast] Run `npm run typecheck` and `npm test`; resolve any failures. Confirm no `any`/`as`/`@ts-ignore` introduced (grep guard).
- [ ] T054 [tier:fast] Update the research log with a short note that spec 013 (the Internet Archive adapter) is implemented and ready for its first acquisition (in-session doc note; the *measured* de Groote fidelity ratio is recorded by the operator-acceptance task T055, not here).
- [~] T055 **Operator acceptance (manual, live archive.org fetch — audit-before-acceptance).** The operator runs the live de Groote acquisition end-to-end per `quickstart.md` (SC-001): `bib inventory --repository internet-archive --item nouvellefrancec00groogoog` → `rights-assess` → `promote` → `acquire` (`--dry-run` first) → `reconcile` → `coverage`; confirms the masters + source PDF in B2, record `archived`, and records the **measured** fidelity ratio (confirming/adjusting the 0.90 threshold, research D-4). Marked `- [~]` so the `tasks-complete` gate excludes it — the cross-model audit runs **before** this live-prod acceptance spends a real archive.org fetch (Principle XII).

---

## Dependencies & completion order

```text
Phase 1 (Setup) ─┐
                 ├─> Phase 2 (Foundational: vocab + models + poppler) ─┐
                 │                                                      ├─> Phase 3 (US1, P1, MVP)
                 │   US1 integrates the resolve/rights/extract/fidelity slices, so in practice:
                 │        Phase 5 (US3 rights)  ─┐
                 │        Phase 4 (US2 quality) ─┤
                 │        Phase 6 (US4 extract) ─┼─> complete US1 end-to-end
                 │        Phase 7 (US5 fidelity)─┘
                 └─────────────────────────────────> Phase 8 (Polish)
```

- **Phase 2 blocks everything.** The vocab widenings + models + poppler runner are prerequisites.
- **US1 (P1)** is the spine; **US2 (P1)** and **US3 (P2)** are the fail-closed gates that make US1
  safe; **US4 (P2)** is the extraction correctness; **US5 (P3)** is the frugal edge behavior.
- Stories are testable independently (each module has its own tests with fakes), but a *full* US1
  end-to-end run needs US2–US5's modules — build in the order US1-scaffold → US3 → US2 → US4 → US5,
  or implement the slices in parallel and integrate at T025.

## Parallel opportunities

- **Phase 1**: T001–T004 all `[P]` (distinct files).
- **Phase 2**: T005, T006, T007 `[P]` (distinct model files); T013 `[P]`. T008/T009 chain (same
  model area); T010/T011/T012 chain within their areas.
- **Story modules** are mostly distinct files, so tests within a story (e.g. T038–T041) can be
  authored in parallel, then the single implementing module lands.
- **Phase 8**: T049–T052 `[P]`.

## Independent test criteria (per story)

- **US1**: `nouvellefrancec00groogoog` acquires → masters + source PDF in B2, record `archived`,
  `coverage` held; re-acquire idempotent.
- **US2**: `unsound` → zero B2 bytes + no advance; `sound` → only approved range produced.
- **US3**: `collectRightsEvidence` = evidence, no verdict; non-PD record → `acquire` throws pre-fetch.
- **US4**: lossless vs rasterised per page test; count == range or throw; excluded leaves recorded + retained.
- **US5**: equivalent PDF → exploded (no image-set fetch); degraded → image-set used; ambiguous → throw.

## Suggested MVP scope

**Phase 1 + Phase 2 + Phase 3 (US1)**, with the US2/US3 gates (Phases 4–5) — the P1 stories — folded
in, since a public archive must not write unsound or non-public-domain material to shared storage. US4
extraction correctness is required for US1 to produce real masters, so in practice the MVP is
**Phases 1–6**; US5 (fidelity edge) can follow as the first increment after MVP.

## Format validation

55 tasks (T001–T055). All use `- [ ] T### [P?] [US#?] Description with file path`, except **T055**
which uses the `- [~]` operator-acceptance marker (excluded from the `tasks-complete` govern gate —
audit-before-acceptance). Setup/Foundational/Polish tasks carry no story label; user-story tasks
(T014–T048) carry their `[US#]` label; every task names an exact file path or command. ✅
