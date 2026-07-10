---
description: "Task list for Corpus Browser implementation"
---

# Tasks: Corpus Browser

**Input**: Design documents from `specs/005-corpus-browser/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED — the spec explicitly requests vitest unit + integration coverage (including the fail-loud / corrupted-copy cases). Write each test before its implementation and confirm it fails first.

**Tier tags**: every task carries `[tier:fast|balanced|powerful]` (stack-control tier-vocab: fast=haiku, balanced=sonnet, powerful=opus).

**Frontend-design gate (Constitution Principle I — NON-NEGOTIABLE)**: tasks marked **🎨 via `/frontend-design:frontend-design`** MUST invoke that skill BEFORE writing any markup/CSS. No off-road UI.

## Format: `[ID] [P?] [Story] [tier] Description`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1–US6 (user-story phases only)

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [P] [tier:fast] Add `astro`, `openseadragon`, `pagefind` (+ `@types/openseadragon`) to root `package.json` devDeps/deps and run install.
- [x] T002 [tier:fast] Scaffold the Astro project at `site/` — `site/astro.config.mjs` (static output), `site/tsconfig.json` path-mapping `@/*` → root `src/*`, `site/src/{pages,components,islands}/` dirs.
- [x] T003 [P] [tier:fast] Add npm scripts: `browser:test` (vitest for `tests/**/browser`), `site:build`, `site:preview` in root `package.json`; ensure `vitest.config.ts` includes `tests/unit/browser` + `tests/integration/browser`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user-story work begins until this phase is complete.

- [x] T004 [tier:balanced] Define the browser view-model in `src/browser/model.ts` — `CorpusView`, `SourceView`, `IssueView`, `PageView`, `ImageDescriptor`, `ImageProviderConfig` (discriminated union), `ProvenanceRecord`, `SearchDocument` (per data-model.md). No `any`/`as`; `@/` imports.
- [x] T005 [tier:fast] Create `src/browser/config.ts` — resolve `LoadConfig` (`archivePath`, `sources`, `provider`) from `CORPUS_ARCHIVE_PATH` / `CORPUS_IMAGE_PROVIDER` / `CORPUS_CDN_BASE` (env/flag; **no secrets**). Throw on an unknown provider or an invalid archive path.
- [x] T006 [P] [tier:fast] Add the integration fixture harness in `tests/integration/browser/fixtures.ts` — resolve the real PB-P001 issue `1879-08-15_bpt6k56068358` from the archive clone and a scratch-copy helper that mutates a copy (drop translation / drop a provenance field / skew page count) for fail-loud cases. No mock corpus data — operate on the real clone copy.

**Checkpoint**: view-model + config + fixtures ready.

---

## Phase 3: User Story 1 — Read a page as facsimile & parallel text (Priority: P1) 🎯 MVP

**Goal**: A page route shows the deep-zoom scan beside page-aligned French OCR + English translation.

**Independent Test**: build for one PB-P001 page; the page route renders the scan (zoom/pan), its French OCR, and its English translation; missing corpus data fails the build loud.

### Tests for User Story 1

- [x] T007 [P] [US1] [tier:balanced] Unit test OCR page-splitting in `tests/unit/browser/ocr-pages.test.ts` — `issue.txt` split on `\f` yields N segments; count-mismatch throws.
- [x] T008 [P] [US1] [tier:balanced] Unit test translation pairing in `tests/unit/browser/translation.test.ts` — pairs `translation/pNNN.{fr,en}.txt` + sidecar; missing `english` or provenance field throws.
- [x] T009 [P] [US1] [tier:balanced] Integration test in `tests/integration/browser/corpus.test.ts` — `loadCorpus` normalizes the real PB-P001 issue (8 pages) end-to-end (loader G-1..G-6), and each corrupted-copy case throws naming source/issue/page.

### Implementation for User Story 1

- [x] T010 [US1] [tier:balanced] `src/browser/load/ocr-pages.ts` — split `issue.txt` on form-feeds → per-page raw French OCR; detect an OCR-condition note (e.g. "Contraste insuffisant") → `PageView.ocrCondition`.
- [x] T011 [US1] [tier:balanced] `src/browser/load/translation.ts` — read `translation/pNNN.fr.txt` (→ `correctedFrench|null`), `pNNN.en.txt` (→ `english`), and the `.yml` provenance sidecar (→ `ProvenanceRecord`); throw on missing required layers.
- [x] T012 [US1] [tier:powerful] `src/browser/load/corpus.ts` — the fail-loud normalization core: load SSOT via `@/bibliography` → `SourceView`; enumerate issue dirs → `IssueView`; assemble `PageView[]`; enforce page-count coherence across images/OCR/translations (loader G-1); assemble `ProvenanceRecord`; **no fallbacks**. Keep ≤500 lines (split helpers if needed).
- [x] T013 [US1] [tier:balanced] `src/browser/providers/provider.ts` (interface + `ImageProviderConfig` + `makeProvider` factory, throws on missing config) and `src/browser/providers/source-iiif.ts` (build IIIF descriptor from source `ark` + `folioId`).
- [x] T014 [P] [US1] [tier:balanced] Unit test providers in `tests/unit/browser/providers.test.ts` — image-provider contract G-1..G-4 for `source-iiif` (missing ark throws; no placeholder URL).
- [x] T015 [US1] [tier:powerful] 🎨 via `/frontend-design:frontend-design` — the **reading-view page** `site/src/pages/sources/[sourceId]/issues/[issueId]/pages/[pageId].astro` + reading-view components: layout ① (deep-zoom scan leading ~56%, French OCR + English stacked beside it), consuming `PageView` from the data layer. Invoke the skill first; elaborate the approved mockup, do not hand-roll.
- [x] T016 [US1] [tier:balanced] `site/src/islands/viewer.ts` — OpenSeadragon island initialized from an `ImageDescriptor` (`iiif` tile source vs `full-image`); provider-agnostic. (Library wiring; the reading-view placement/design is T015.)

**Checkpoint**: US1 is independently testable — a page reads as facsimile + parallel text.

---

## Phase 4: User Story 2 — Navigate source → issue → page (Priority: P1)

**Goal**: Reader moves source → issue → page and forward/back within an issue; every route is stable + deep-linkable.

**Independent Test**: from a source, select an issue, land on a page, page ±1; each hop is a stable URL.

- [x] T017 [US2] [tier:balanced] `getStaticPaths` route enumeration from `CorpusView` for source, issue, and page routes (`site/src/pages/**`); build throws if any emitted page is incomplete (routes G-2).
- [x] T018 [P] [US2] [tier:balanced] Integration test in `tests/integration/browser/routes.test.ts` — the enumerated path set matches the normalized corpus (every page has exactly one route; prev/next resolve within the issue).
- [x] T019 [US2] [tier:powerful] 🎨 via `/frontend-design:frontend-design` — corpus landing `site/src/pages/index.astro` (source list), source overview `sources/[sourceId]/index.astro` (issue list, date-ordered), and within-issue prev/next page navigation UI. Invoke the skill first.

**Checkpoint**: US1 + US2 both work independently.

---

## Phase 5: User Story 3 — Search over OCR + translation (Priority: P2)

**Goal**: Client-side, per-page search over both languages; results link to the page reading view.

**Independent Test**: build with the index; a PB-P001 term returns results client-side and links to the right page.

- [x] T020 [US3] [tier:balanced] `src/browser/search/documents.ts` — build one `SearchDocument` per page (`french` = OCR + corrected French; `english`; `routeUrl`; ids).
- [x] T021 [P] [US3] [tier:balanced] Unit test in `tests/unit/browser/search.test.ts` — per-page docs cover both languages and carry a resolvable `routeUrl` (search G-2/G-3).
- [x] T022 [US3] [tier:fast] Wire Pagefind into `site:build` — index the emitted reading-view HTML at build; ensure page markup exposes both language texts for indexing.
- [x] T023 [US3] [tier:powerful] 🎨 via `/frontend-design:frontend-design` — the search UI island + results list linking to page routes (search behavior B-1..B-4). Invoke the skill first.

**Checkpoint**: US1–US3 independently functional.

---

## Phase 6: User Story 4 — Archival frame & provenance rail (Priority: P2)

**Goal**: The "Prospectus/Dossier" identity + the monospace provenance rail on every page.

**Independent Test**: a page shows a provenance rail populated from real metadata; source vs apparatus voices are visually distinct; the display font loads with no external host.

- [x] T024 [US4] [tier:powerful] 🎨 via `/frontend-design:frontend-design` — the monospace **provenance rail** component rendering `ProvenanceRecord` (sourceId, ark, date, rights, page, sha256) in the apparatus voice (FR-014). Invoke the skill first.
- [x] T025 [US4] [tier:powerful] 🎨 via `/frontend-design:frontend-design` — the **"Prospectus/Dossier" visual system**: warm serif/Didone source voice vs cool grotesque/monospace apparatus voice, oxide stamp-red reserved for critical marks only (OCR-condition note, rights stamp), single archival theme, and the noisy-OCR framing. Invoke the skill first.
- [x] T026 [US4] [tier:balanced] Embed the display typeface as a data-URI `@font-face` in site CSS; verify no external font/asset-host requests (FR-016, SC-007). (Asset mechanism for the faces chosen under T025.)

**Checkpoint**: the editorial frame is present; propaganda reads as evidence.

---

## Phase 7: User Story 5 — Configurable image-source provider (Priority: P3)

**Goal**: Same reading view under `source-iiif` and `b2-cdn`, selected by flag; fail-loud on missing provider config.

**Independent Test**: build twice with each provider; same page renders correct URLs; `b2-cdn` without a CDN base fails loud.

- [x] T027 [US5] [tier:balanced] `src/browser/providers/b2-cdn.ts` — build a `full-image` descriptor from the archive `object_store` key + `cdnBase`; throw on missing `cdnBase` (image-provider G-1).
- [x] T028 [P] [US5] [tier:balanced] Extend `tests/unit/browser/providers.test.ts` — `b2-cdn` URL construction, missing-config throw, and provider-swap descriptor parity with `source-iiif` (SC-005).
- [x] T029 [US5] [tier:fast] Thread `CORPUS_IMAGE_PROVIDER` / `CORPUS_CDN_BASE` through `config.ts` → `site:build`; document the swap in quickstart Scenario 4.

**Checkpoint**: the browser is provider-portable.

---

## Phase 8: User Story 6 — Deliberate public export (Priority: P3)

**Goal**: A distinct export producing only public-domain material, separate from the internal build. (OQ-4 deferred — implement the seam, keep scope minimal.)

**Independent Test**: producing a public deployment is an explicit action whose output excludes non-public-domain material; the internal build is unchanged.

- [x] T030 [US6] [tier:balanced] A distinct `site:export-public` entrypoint (script) — separate from `site:build`, gated on an explicit editorial-readiness decision — that produces the public deployment. The corpus is already public-domain, so this is a readiness/curation gate, not a rights filter. Document it as a deliberate step. Note OQ-4 is deferred; do not fold export into the internal build.

**Checkpoint**: the internal/public boundary is explicit.

---

## Phase 9: Polish & Cross-Cutting

- [x] T031 [P] [tier:fast] Run all six quickstart.md scenarios; record pass/fail evidence.
- [x] T032 [P] [tier:fast] `site/README.md` — build/preview, provider selection, deploy (Netlify/Cloudflare Pages) notes.
- [x] T033 [tier:balanced] Typecheck (`tsc --noEmit`) across `src/browser` + `site`; confirm no `any`/`as`/`@ts-ignore`, `@/` imports throughout, and every file ≤300–500 lines (split if over).
- [x] T034 [tier:balanced] `/verify` end-to-end drive of the reading view (scan + FR/EN + provenance rail + nav + search) against real PB-P001 content.

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** blocks everything.
- **US1 (P1)** is the MVP; the data-layer core (T010–T014) is a prerequisite for US2/US3/US5 too (they consume `CorpusView` / providers).
- **US2, US3, US4** can proceed after US1's data layer + reading view exist; US4's visual system (T025) styles surfaces US1–US3 render.
- **US5** extends the provider surface built in US1 (T013).
- **US6** depends on a working build (US1–US4).
- **Polish (P9)** last.

### Within each story
- Tests before implementation (confirm they fail first).
- Data layer (model → loaders → providers → search docs) before the Astro surfaces that consume it.
- 🎨 UI tasks: invoke `/frontend-design:frontend-design` before any markup/CSS.

## Parallel Opportunities

- Setup: T001/T003 parallel.
- US1 tests: T007/T008 parallel; T014 parallel with them.
- Data-layer unit tests across stories (T014, T021, T028) are independent files.
- Different user stories can be staffed in parallel once US1's data layer lands.

## Implementation Strategy

**MVP** = Phase 1 + Phase 2 + Phase 3 (US1): a single page reads as facsimile + parallel text, fail-loud on bad data. STOP and validate (quickstart Scenario 1–2), then layer US2 (nav), US3 (search), US4 (identity), US5 (provider), US6 (export) incrementally.

## Notes

- `[tier:...]` drives model-sized dispatch at `/stack-control:execute`.
- 🎨 tasks are the frontend-design gate; the data layer (`src/browser/`) is headless and ungated.
- No fallbacks/mock data outside tests; commit after each task or logical group; never bypass with git hooks (none exist).
