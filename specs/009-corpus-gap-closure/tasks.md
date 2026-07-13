# Tasks: Corpus Gap Closure

**Feature dir**: `specs/009-corpus-gap-closure/` · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

A research program with a small tooling tail. Tasks are of two kinds: **[code]** (typed units + tests) and **[research]** (durable actions against the bibliography SSOT / search-log, committed + pushed). Reuses shipped `bib` verbs; new code lives in `src/sourcegroup/adapters/` + a search-log authoring path. Work in a per-session archive clone (never the shared tree).

## Phase 1: Setup

- [ ] T001 Confirm shipped prerequisites resolve (`bib coverage`, `bib reconcile`, `bib inventory|verify-member|promote|acquire|discover`, `bib validate`) and capture the baseline coverage snapshot into `RESEARCH_LOG.md` (the pre-program measured gap).
- [ ] T002 [P] Document the per-session archive-clone + env setup in the loop runbook reference (quickstart.md is canonical); no shared working tree.

## Phase 2: Foundational (blocking prerequisites for the loop)

- [ ] T003 [code] Define the `RepositoryAdapter` interface (`search`/`resolveIdentifier`/`determineRights`/`acquire`) in `src/sourcegroup/adapters/adapter.ts` (typed, `@/` imports, no `any`).
- [ ] T004 [code] Implement the Gallica adapter wrapping the shipped fetcher in `src/sourcegroup/adapters/gallica.ts`; unit tests for INV-2 (unverifiable → throw), INV-3 (rights gate), INV-6 (never `bib migrate`).
- [ ] T005 [code] Add the append-safe **search-log authoring** path in `src/bibliography/search-log.ts` (write a `SearchLogRecord` without rewriting others' entries); unit test for INV-1 (a search always yields a committed record, incl. `dry`).
- [ ] T006 [code] Add the evidence-class facet (open seed vocab from research R2) to the Source model + `bib` assignment path; soft-warn on unknown class.

## Phase 3: User Story 1 — Search a repository and log the result (P1)

**Goal**: turn the empty search history into measured coverage. **Independent test**: one search-and-log makes `PB-P004 × <repo>` appear in `bib coverage` with a date.

- [ ] T007 [US1] [code] Wire the loop step: `adapter.search(campaign)` → append `SearchLogRecord` (outcome found|dry) → surface candidates. Integration test against a fixture adapter.
- [ ] T008 [US1] [research] First search-and-log pass: **PB-P004 × Gallica** and **× BnF catalogue**; record coverage + remaining-questions; commit + push.
- [ ] T009 [US1] [research] Search-and-log **PB-P006 × New Italy Museum** and **× Trove** (manual-backed where no automated mechanism); commit.
- [ ] T010 [US1] [research] Verify `bib coverage` Search History + repository rollup are no longer `(none)` for searched pairs (SC-001).

## Phase 4: User Story 2 — Reconcile already-acquired into the SSOT (P1)

**Goal**: immediate visible closure of acquired-but-unreconciled sources. **Independent test**: `bib reconcile PB-P003` → `archived`; coverage reflects it.

- [ ] T011 [US2] [research] `bib reconcile PB-P003` (Baudouin book — masters in B2); expect `archived`; `bib validate` clean; commit.
- [ ] T012 [US2] [research] `bib reconcile PB-P001` (newspaper, partial); expect `collected` (not overstated); commit.
- [ ] T013 [US2] [research] Confirm SC-003 for these: no acquired-but-unreconciled remain among reconciled sources; re-run `bib coverage`.

## Phase 5: User Story 3 — Acquire a known-missing source from any repository (P2)

**Goal**: multi-repository acquisition. **Independent test**: acquire a Gallica source end-to-end; separately acquire a non-Gallica source via a new adapter.

- [ ] T014 [US3] [research] Resolve PB-P002's Gallica ark via `bib inventory`/discovery; then `bib acquire PB-P002 --object-store` → `bib reconcile PB-P002`.
- [ ] T015 [US3] [code] Implement the **Trove adapter** in `src/sourcegroup/adapters/trove.ts` (Trove API search + resolve + rights + bespoke acquire); tests for INV-2/3/4/5.
- [ ] T016 [US3] [research] Acquire **PB-P005** (Trove) via the new adapter → reconcile (proves SC-006, the non-Gallica end-to-end claim).
- [ ] T017 [US3] [code] Add an IIIF acquire helper reused by IIIF-exposing repositories (Internet Archive, libraries) behind the adapter interface; test.

## Phase 6: User Story 4 — Discover sources not yet known (forward discovery) (P2)

**Goal**: surface unknown-unknowns. **Independent test**: mine an acquired source's bibliography → identify a cited work → inventory it.

- [ ] T018 [US4] [code] Add a **bibliographic-mining** discovery source feeding `bib discover`/`inventory` (extract citations/footnotes/advertisements from acquired-source text); fail loud on unverifiable (INV-2).
- [ ] T019 [US4] [research] Resolve PB-P006 **suspected** items (New Italy Museum photographs, survivor accounts): identify → inventory, or document as unavailable/undigitized with basis (SC-004); commit.
- [ ] T020 [US4] [research] Mine each acquired source's bibliography for new works → candidates → inventory/verify/promote the genuine ones.

## Phase 7: User Story 5 — Classify every source by evidence-class (P2)

**Goal**: empty the `unclassified` bucket. **Independent test**: classify a source; the audit distribution reflects it.

- [ ] T021 [US5] [research] Assign an evidence-class to all 13 current sources; `bib coverage` `unclassified` → 0 (SC-002); commit.
- [ ] T022 [US5] [research] Classify each newly-discovered source at inventory time (standing rule for the loop).

## Phase 8: User Story 6 — Establish known-extent where researchable (P3)

**Goal**: numeric denominator where defensible. **Independent test**: set a campaign extent from research; coverage shows a numeric gap.

- [ ] T023 [US6] [research] Research + set `knownMemberCount` + `extentBasis` for campaigns whose extent is boundable (e.g. the trial corpus); leave others explicit `unknown` with basis (SC-005).

## Phase 9: User Story 7 — Declare measured closure (P3)

**Goal**: defensible stopping condition. **Independent test**: after closure conditions hold, `bib coverage` shows only documented `unknown` residual.

- [ ] T024 [US7] [code] Track consecutive dry rounds per repository × campaign; mark searched-for-now at 2 (research R1); test INV against fixtures.
- [ ] T025 [US7] [research] Per campaign, evaluate + record measured-closure (all leads resolved/acquired, all repos logged, residual documented); update `RESEARCH_LOG.md`.

## Phase 10: Polish & cross-cutting

- [ ] T026 [P] [research] After every loop iteration: `bib validate` clean, `bib coverage` shows no silently-empty dimension (SC-007), and confirm single-work-once holds — multiple repository copies of one work stay counted once (FR-015) — then commit + push (Principle IX).
- [ ] T027 [P] [research] Capture each surfaced per-repository capability gap (missing adapter, e.g. HathiTrust/WorldCat/archives) as a backlog item (FR-013) — tracked, not blocking.
- [ ] T028 [P] Honesty pass: RESEARCH_LOG entries state progress as measured deltas + milestone/phase terms — no temporal projections or baseless statistics (Additional Constraints).

## Dependencies & order

- Setup (T001–T002) → Foundational (T003–T006) → user-story phases.
- **P1 first** (US1 search-and-log, US2 reconcile) delivers the MVP: measured search history + immediate closure of already-acquired.
- US3 depends on US1/US4 producing approved members; the Trove adapter (T015) unblocks T016.
- Forward discovery (US4) feeds US3/US5 continuously — the loop iterates.

## Parallel opportunities

- T004/T005/T006 (independent code units) can proceed in parallel [P].
- Research passes across different campaigns/repositories (T008/T009, T019/T020) are independent [P].

## MVP scope

**US1 + US2** (P1): search-and-log the primary repositories and reconcile the already-acquired sources — the audit's dominant `unknown` (empty search history) becomes measured and the understated acquisitions are closed. Everything else extends the loop.
