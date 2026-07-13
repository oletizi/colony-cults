---
description: "Task list for Coverage (Gap Audit) Web View"
---

# Tasks: Coverage (Gap Audit) Web View

**Input**: Design documents from `specs/008-coverage-web-view/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/, quickstart.md

**Tests**: The helper unit test is explicitly requested (contracts/load-coverage-report.md), so
test tasks are included for the data layer.

## Format: `[ID] [P?] [Story] [tier:label] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: US1/US2/US3 (from spec.md); setup/foundational/polish carry no story label.
- **[tier:…]**: `fast` (haiku) | `balanced` (sonnet) | `powerful` (opus) — from stack-control tier-vocab.
- **Frontend-design gate (Constitution XI)**: every UI task's FIRST step is to invoke
  `/frontend-design:frontend-design` before any markup/CSS. These are `[tier:powerful]`.

---

## Phase 1: Setup

- [ ] T001 [tier:fast] Confirm the Astro site build resolves `@/bibliography/*` build-time imports (the coverage model + the new helper) — check `site/`'s tsconfig/astro path alias against the existing `@/browser/*` usage, and add the `@/bibliography` alias only if missing. No app code yet.

## Phase 2: Foundational (blocks all user stories)

**Purpose**: the report-loading path every section renders from. Fail-loud, reuses the shipped projection/loaders unchanged.

- [ ] T002 [tier:balanced] Implement `loadCoverageReport(repoRoot?)` in `src/bibliography/coverage/load-coverage-report.ts`: resolve repo root (default `resolveRepoRoot()`), then `loadAllSources(<root>/bibliography/sources)` + `loadSearchLog(<root>/bibliography/search-log.yml)` → `buildCoverageReport({ sources, searchLog })`; return the `CoverageReport`. Fail-loud (propagate loader errors; no fallback/partial). `@/` imports; no `any`/`as`/`@ts-ignore`; ≤300–500 lines. Per contracts/load-coverage-report.md (G-1..G-5). Reuse the projection/loaders UNCHANGED.
- [ ] T003 [P] [tier:balanced] Unit-test the helper in `tests/unit/bibliography/load-coverage-report.test.ts` (vitest): returns a well-formed `CoverageReport` from the committed bibliography incl. the `PB-P004` campaign; fails loud on a malformed source fixture (no partial report); does not throw when the search log is absent (empty `searchHistory`). Per contracts/load-coverage-report.md test obligations.

**Checkpoint**: `npx vitest run tests/unit/bibliography/load-coverage-report.test.ts` green before any UI.

## Phase 3: User Story 1 — See the corpus's research status at a glance (P1) 🎯 MVP

**Goal**: `/coverage` renders the four report sections from committed data; counts and the literal `unknown` only, never a percentage; explicit empty states.

**Independent test**: `npm run site:build` then open `/coverage`; the four sections render from the committed bibliography (incl. `PB-P004`), with no percentage/progress indicator and explicit empty states where data is absent.

- [ ] T004 [tier:powerful] [US1] THROUGH `/frontend-design:frontend-design` (invoke before any markup/CSS): design the `/coverage` view as a whole — the page layout composing the four sections and their explicit empty states, adopting the site's existing Prospectus/Dossier visual identity and the no-percentage/counts-and-`unknown` constraint. Output is the design the section components in T005–T009 implement.
- [ ] T005 [P] [tier:powerful] [US1] THROUGH `/frontend-design` output: implement `site/src/components/coverage/CampaignCoverage.astro` — per campaign: `membersByLifecycleState` state→count, `actualMemberCount`, believed extent as *N held of M believed (gap G)* or *believed extent unknown* (literal `unknown`, never coerced/percentage); explicit empty-members state. Contracts G-2, G-6, G-8.
- [ ] T006 [P] [tier:powerful] [US1] THROUGH `/frontend-design` output: implement `site/src/components/coverage/EvidenceDistribution.astro` — each `evidenceClassDistribution` row as class→**count** incl. `unclassified`; no percentage/ratio/progress. Contracts G-3, G-6.
- [ ] T007 [P] [tier:powerful] [US1] THROUGH `/frontend-design` output: implement `site/src/components/coverage/ReferenceRegister.astro` — `register.byCampaign` grouped by campaign then `register.ungrouped` under an explicit "no campaign" heading; each entry marked *cited-but-unidentified reference* vs *suspected gap* with its `basis` and `owner`; explicit "nothing unresolved" empty state. Contracts G-4, G-8.
- [ ] T008 [P] [tier:powerful] [US1] THROUGH `/frontend-design` output: implement `site/src/components/coverage/SearchHistory.astro` — `searchHistory.matrix` (repository × campaign: `lastSearched`, `openQuestions`) plus the `byRepository` rollup; explicit "no searches logged yet" empty state. Contracts G-5, G-8.
- [ ] T009 [tier:powerful] [US1] THROUGH `/frontend-design` output: implement `site/src/pages/coverage/index.astro` — call `loadCoverageReport()` in build-time frontmatter and compose the four components; the build fails loud if the helper throws (no partial page). Contracts G-1, G-9. Depends on T002, T005–T008.

**Checkpoint**: US1 is a complete, shippable MVP — `/coverage` builds and renders the four sections with the invariants held.

## Phase 4: User Story 2 — Cross into the held record from a gap (P2)

**Goal**: campaign ids and register owners link to `/sources/<id>` when that reading page exists; never a dangling link; source-groups never linked.

**Independent test**: on `/coverage`, every identifier with a reading page links to it and every one without (a source-group id) renders unlinked.

- [ ] T010 [tier:powerful] [US2] THROUGH `/frontend-design` output: resolve the set of source ids that have a `/sources/<id>` reading page (the corpus-browser source list) at build time, pass it into `CampaignCoverage.astro` and `ReferenceRegister.astro`, and render an identifier as a link iff its id is in that set — otherwise a plain identifier; a source-group id (campaign) is never linked; emit no dangling link. Contracts G-7.

## Phase 5: User Story 3 — Reach coverage from anywhere (P3)

**Goal**: exactly one global-nav link to `/coverage`.

**Independent test**: from any site page, one masthead link leads to `/coverage`.

- [ ] T011 [tier:powerful] [US3] THROUGH `/frontend-design:frontend-design` (invoke before any markup/CSS): add exactly one coverage link to the global masthead `site/src/components/Masthead.astro`, consistent with the site's existing nav. Contracts G-10.

## Phase 6: Polish & Cross-Cutting

- [ ] T012 [P] [tier:balanced] Run the quickstart validation (specs/008-coverage-web-view/quickstart.md): `npm run site:build`; confirm `/coverage` renders the four sections, contains no coverage percentage/ratio/progress indicator, cross-links resolve with zero dangling links, exactly one masthead link, and a malformed-bibliography fixture fails the build (then revert). Confirm the search-log-absent empty state.
- [ ] T013 [P] [tier:fast] Type/lint gate: `npx tsc --noEmit` clean; verify no `any`/`as`/`@ts-ignore` and every new/changed file ≤300–500 lines.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002, T003)** → **US1 (T004→{T005,T006,T007,T008}→T009)**.
- **US2 (T010)** depends on US1 components (T005, T007) existing.
- **US3 (T011)** depends only on the site building (after US1).
- **Polish (T012, T013)** last.
- **Story independence**: US1 is a standalone MVP; US2 and US3 are additive and independently testable.

## Parallel Opportunities

- T003 runs in parallel with UI design (T004) once T002 exists.
- T005, T006, T007, T008 are all `[P]` — different files, implemented in parallel under the T004 design.
- T012 and T013 are `[P]` at the end.

## Implementation Strategy

Ship **US1** first (the MVP snapshot page), verifying its invariants, then add **US2** cross-links and **US3** the nav link. Every UI task runs through `/frontend-design` before any markup/CSS (Constitution XI). The data layer (T002/T003) reuses the shipped coverage projection and loaders unchanged.
