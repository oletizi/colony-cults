# Tasks: Page-range (excerpt) acquisition

**Input**: Design documents from `/specs/012-page-range-acquisition/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (cli.md, model.md), quickstart.md
**HOW source-of-truth**: `docs/superpowers/specs/2026-07-15-page-range-acquisition-design.md`

**Tests**: included — the project uses vitest with injected fake runners (TDD convention).

## Format: `[ID] [P?] [Story] [tier:label] Description`

- **[P]**: parallelizable (different files, no incomplete-task dependency).
- **[Story]**: US1 / US2 / US3 (user-story phases only).
- **[tier:label]**: model tier — `fast` (haiku) / `balanced` (sonnet) / `powerful` (opus); cheapest that does it correctly.

---

## Phase 1: Setup

- [ ] T001 [tier:fast] Confirm test/module locations: `src/fetch/` (parser lands here), `src/model/repository-record.ts`, `src/cli/fetch-source.ts` + `src/cli/fetch-shared.ts`, `src/bibliography/{load-fields,authored-record,migrate-serialize,validate-checks,vocab}.ts` all exist and are the correct edit targets; run `npm test` once to confirm a green baseline before changes.

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**Purpose**: the pure parser and the model field that the user-story phases build on.

- [ ] T002 [P] [tier:fast] Write failing unit tests for the folio-range parser in `src/fetch/folio-range.test.ts` covering every row of contracts/model.md: `"48"→[48]`, `"48-50"→[48,49,50]`, `"48,50,52"`, `"48-50,55"`, dedup `"48-50,49"→[48,49,50]`, whitespace tolerance, and fail-loud throws for `"50-48"`, `"0-3"`, `"-1"`, `"48-"`, `"a-b"`, `"48,,50"`, `""`, `"   "`.
- [ ] T003 [tier:balanced] Implement `parseFolioRange(spec: string): number[]` in `src/fetch/folio-range.ts` — pure, no document knowledge; returns a deduped ascending positive-integer array; throws a descriptive error naming the offending token on reversed range / folio `<1` / malformed token / empty selection. Make T002 green. (@/ imports, no any/as, ≤300 lines.)
- [ ] T004 [tier:balanced] Add optional `folios?: number[]` to the `RepositoryRecord` interface in `src/model/repository-record.ts` with a doc comment (present ⇒ excerpt of these folios of the record's ark; absent ⇒ whole-document, unchanged).
- [ ] T005 [P] [tier:fast] Write a failing round-trip test (in the nearest existing bibliography test, e.g. `src/cli/bibliography.test.ts` or a new `src/bibliography/folios-roundtrip.test.ts`): a repositoryRecord with `folios: [48,49,50]` loads → serializes losslessly; and `bib validate` rejects a malformed `folios` (non-array, non-integer, `<1`, unsorted, duplicate).
- [ ] T006 [tier:balanced] Thread `folios` through the bibliography loader/serializer/validate/vocab: `src/bibliography/load-fields.ts` + `authored-record.ts` (read), `src/bibliography/migrate-serialize.ts` (write, order-stable), `src/bibliography/validate-checks.ts` (fail-loud on malformed), `src/bibliography/vocab.ts` (allow-list the field if allow-list-driven). Make T005 green; whole-document records (no `folios`) round-trip unchanged.

**Checkpoint**: parser + model field exist, tested, and green.

---

## Phase 3: User Story 1 — Acquire only the pertinent folios (Priority: P1) 🎯 MVP

**Goal**: `fetch-source --pages` acquires exactly the selected folios (masters + provenance).
**Independent test**: with an injected fake client/store, a `folios` selection fetches only those folios; live, PB-P054 folios 48–50 land in B2.

- [ ] T007 [P] [US1] [tier:balanced] Write failing fetch-core tests in `src/fetch/issue.test.ts` (injected fake `FetchClient` + object store): (a) context with `folios:[48,49,50]` on a 200-page doc ⇒ IIIF fetched for exactly folios 48,49,50, files `f048/049/050.jpg`, nothing else; (b) a requested folio `>pageCount` or `<1` throws and writes nothing.
- [ ] T008 [US1] [tier:powerful] Implement the fetch-core change in `src/fetch/issue.ts`: add optional `folios?: number[]` to `FetchMonographContext` (and the shared context if applicable); after resolving `pageCount = ctx.client.pagination(ark)`, when `folios` present bounds-check every folio (`<1` or `>pageCount` ⇒ throw, write nothing) and iterate the set instead of `for (page = 1..pageCount)`; add `requestedFolios?`/`fetchedCount` to `FetchIssueResult` for the summary. Make T007 green. **Preserve the no-`folios` path byte-for-byte.** (The risky core edit — a regression here corrupts existing whole-document acquisitions.)
- [ ] T009 [US1] [tier:balanced] Wire `--pages <spec>` into `src/cli/fetch-source.ts` + `src/cli/fetch-shared.ts`: parse with `parseFolioRange`, thread `folios` into `fetchMonograph`; when `--pages` is given on the periodical `fetch-issue` path, fail with a usage error (exit non-zero).
- [ ] T010 [US1] [tier:balanced] On an excerpt acquire, record the selected folios onto the source's `RepositoryRecord.folios` (in the acquire/reconcile write path that persists the repository record), so the SSOT is self-describing after acquisition.

**Checkpoint**: `bib fetch-source <ark> --pages <spec> --object-store` fetches exactly the selection and records `folios`. MVP shippable.

---

## Phase 4: User Story 2 — Whole-document acquisition unchanged (Priority: P1)

**Goal**: no `--pages` ⇒ today's behavior, no regression.
**Independent test**: fetch with no selection fetches every folio `1..pageCount`, identical to pre-feature.

- [ ] T011 [P] [US2] [tier:balanced] Add a regression test in `src/fetch/issue.test.ts`: a context with NO `folios` fetches every folio `1..pageCount` exactly as before (assert against the pre-existing whole-document expectation); and an already-acquired whole doc re-run is idempotent (skips held folios). Confirm existing fetch tests still pass unchanged.

**Checkpoint**: whole-document path proven unperturbed.

---

## Phase 5: User Story 3 — Excerpt is self-describing & verifiable (Priority: P2)

**Goal**: dry-run previews only the selection; reconcile verifies held == declared folios.
**Independent test**: `--dry-run --pages` reports only the selected folios; `bib reconcile` verifies them.

- [ ] T012 [P] [US3] [tier:balanced] Write a failing test that `--dry-run --pages 48-50` (via `dryRunDocument`) reports exactly 3 folios (count + estimate), writes nothing.
- [ ] T013 [US3] [tier:balanced] Scope the dry-run estimate to the selected folios: `dryRunDocument` in `src/cli/fetch-shared.ts` and `estimateIssue` in `src/fetch/estimate.ts` estimate only the requested folios when `folios` is present. Make T012 green.
- [ ] T014 [US3] [tier:balanced] Have `bib reconcile <id>` report the excerpt relative to its declared `folios` (e.g. "N/N declared folios in object store") — read `RepositoryRecord.folios`; verify present folios against B2 (existing verify path; no held==pageCount gate). Add/adjust a reconcile test.

**Checkpoint**: excerpt holdings preview and reconcile correctly against their declared extent.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T015 [P] [tier:fast] Record PB-P054's excerpt extent: set `folios: [48, 49, 50]` on the Gallica repository record in `bibliography/sources/PB-P054.yml`; run `bib regenerate` (scratch archive root ok) and confirm `bib validate` clean.
- [ ] T016 [tier:balanced] Run the quickstart scenarios A, B, C, E (unit/CLI, no live B2) and confirm each passes; `npm run typecheck` (tsc) clean and full `npm test` green. Scenario D (live PB-P054 acquire → archived) is operator-run with the archive-clone + B2 env (archive-acquisition-setup) — document the exact command in the PR and leave the live run to the operator.
- [ ] T017 [P] [tier:fast] Update `docs/superpowers/specs/2026-07-15-page-range-acquisition-design.md` status note if any design detail shifted during implementation (keep design doc and code consistent).

---

## Dependencies & order

- **Phase 2 (T002–T006)** blocks everything: the parser (T003) and model field (T004/T006) are prerequisites.
- **US1 (Phase 3)** is the MVP: T008 (core) depends on T007 (tests) + T003 (parser used by T009); T009 depends on T003 + T008; T010 depends on T004/T006 + T008.
- **US2 (Phase 4)** T011 depends on T008 (verifies the no-`folios` branch it introduces).
- **US3 (Phase 5)** T013 depends on T008 (folios in context); T014 depends on T004/T006 (folios recorded).
- **Polish (Phase 6)** T015 depends on T006 (validate accepts folios); T016 depends on all impl; T017 last.

## Parallel opportunities

- T002 and T005 (foundational tests, different files) can run in parallel.
- Within US1, T007 (tests) is [P] with T004/T006 model work already done.
- T011 (US2 regression) and T012 (US3 dry-run test) touch different concerns.
- T015 and T017 (docs/data edits) are [P].

## MVP scope

**User Story 1 (Phase 2 + Phase 3)** is the minimum shippable increment: it delivers excerpt acquisition end-to-end. US2 (regression lock) and US3 (dry-run/reconcile ergonomics) are fast-follow.
