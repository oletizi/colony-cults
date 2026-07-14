---
description: "Task list — New Italy Museum acquisition path"
---

# Tasks: New Italy Museum acquisition path

**Input**: Design documents from `specs/011-museum-acquisition-path/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included (TDD requested) — characterization tests for the Gallica cutover MUST be authored and green **before** the hardwired path is removed.

**Organization**: grouped by user story. `[tier:<label>]` per task maps to this installation's `tier_map` (fast→haiku, balanced→sonnet, powerful→opus). Each task is independently committable (commit + push on coherence, Principle IX).

**Status legend**: `[x]` = built + tested + committed this session (26 tasks). `[~]` = **live-environment / operator step, gate-excluded** (audit-before-acceptance, gh-499): **T020** (inventory the real PB-P006 candidates via live fetch), **T021** (acquire one candidate → mirror a real image to B2 → reconcile), **T028** (update PB-P006 notes to reference the *acquired* masters — depends on T021), **T030** (full live quickstart e2e). These need the private archive clone + B2 credentials + polite live fetching; the operator runs them after the whole-feature audit. (T013/T026/T027 were absorbed into T012/T025 respectively — see ledger.)

## Format: `[ID] [P?] [Story] [tier:X] Description with file path`

---

## Phase 1: Setup

- [x] T001 [tier:fast] Create the new module directories `src/repository/` (with `gallica/`, `new-italy-museum/`) and `src/extraction/`, each with an `index.ts` barrel; no logic yet.

---

## Phase 2: Foundational (blocking prerequisites for all stories)

**⚠️ Model + contracts every story depends on. No behavior cutover here.**

- [x] T002 [P] [tier:fast] Add `'archival-item'` to the structural `kind` union in `src/model/source.ts` and the kind vocab in `src/bibliography/vocab.ts`; update the kind-validity rule (member kinds may be `archival-item`).
- [x] T003 [P] [tier:fast] Add `'accession'` to `CopyLevelIdentifierType` + `COPY_LEVEL_TYPES` in `src/model/identifiers.ts`.
- [x] T004 [P] [tier:balanced] Extend the `Rights` type in `src/model/rights.ts` with `rightsRaw`, `rightsStatus` (`public-domain|restricted|uncertain`), `rightsBasis`, `rightsJurisdiction`, `assessedBy`, `assessedAt`; basis required when status set.
- [x] T005 [P] [tier:balanced] Add the `AcquiredAsset` type + `assets?`/`sourceUrl?` fields to `src/model/repository-record.ts` (sourceUrl, mediaType, objectStoreKey, checksum, byteLength, provenancePath, role?, sequence?, representationChoice?).
- [x] T006 [tier:fast] Define the `RepositoryAdapter` interface + typed I/O (`ResolvedRepositoryItem`, `RightsEvidence`, `AcquisitionResult`, `RepositoryLocator`, `RepositoryName`) in `src/repository/adapter.ts` per `contracts/repository-adapter.md`.
- [x] T007 [tier:balanced] Implement the adapter registry in `src/repository/registry.ts`: dispatch by copy-identifier type where a record exists (`ark`→gallica, `accession`→museum), explicit `--repository` for a raw locator; **return exactly one adapter or throw** with the three enumerated failure cases (INV-D). Unit tests in `src/repository/registry.test.ts`.
- [x] T008 [P] [tier:fast] Define the `StructuredExtractor<T>`, `GroundedField` (incl. `interpretation`), `GroundedExtraction`, `MuseumItemFields`, `FetchedDocument` types in `src/extraction/structured-extractor.ts` per `contracts/structured-extractor.md`.
- [x] T009 [tier:balanced] Implement the deterministic grounding verifier `verifyGrounded` in `src/extraction/grounding-verifier.ts` (excerpt-verbatim-on-page, whitespace-normalized; rights-critical date excerpt contains value; throw on failure). Tests `src/extraction/grounding-verifier.test.ts` cover INV-X1..X3 (fabricated value throws; date-excerpt-missing-value throws; deterministic across runs).

**Checkpoint**: model compiles; registry + verifier tested; no shipped behavior changed yet.

---

## Phase 3: User Story 2 — Gallica unchanged through the adapter (Priority: P1)

**Goal**: full cutover of the shipped Gallica path onto the adapter seam with zero behavior change.
**Independent test**: `npm test -- src/repository/gallica src/sourcegroup/acquire` green; the removed hardwired path is unreferenceable.

- [x] T010 [US2] [tier:powerful] Author **characterization tests** in `src/repository/gallica/characterization.test.ts` capturing the *current* Gallica behavior via the shipped path (ARK inventory, PD verification, archive layout + provenance, object-store keys + checksums, source-group guardrails, reconcile transitions) against `src/sourcegroup/__fixtures__`. These MUST pass against `main` before any cutover edit.
- [x] T011 [US2] [tier:powerful] Implement `GallicaAdapter` in `src/repository/gallica/adapter.ts` wrapping the shipped `src/gallica` fetcher + `gallica-ark-resolver`, conforming to `RepositoryAdapter` and returning a typed `AcquisitionResult`.
- [x] T012 [US2] [tier:powerful] Cut over `src/sourcegroup/acquire.ts`: select the RepositoryRecord → `registry.select` → `adapter.acquire`; **remove** the hardwired `ark → runFetchSource` path (acquire.ts:184-210) and the direct Gallica resolver injection in `src/cli/bib-sourcegroup.ts`. No dual path / alias / shim; a reference to the removed shape fails to compile.
- [x] T013 [US2] [tier:balanced] Run the T010 characterization tests through the adapter; confirm byte-identical behavior (SC-003). Fix drift until green. Update `src/sourcegroup/acquire.test.ts` for the new dispatch.

**Checkpoint**: Gallica acquires identically through `GallicaAdapter`; hardwired path gone.

---

## Phase 4: User Story 1 — Acquire an identified museum public-domain item (Priority: P1)

**Goal**: the museum path end-to-end — inventory → rights-assess → acquire → reconcile for one identified candidate.
**Independent test**: acquire one PB-P006 candidate; master + provenance in B2, reconciled `archived`, coverage counts it once; re-run is idempotent.

- [x] T014 [P] [US1] [tier:balanced] Implement DOM-direct mechanical pull in `src/repository/new-italy-museum/musarch-dom.ts` (asset URL(s) from `<img>`/`<a href>`, accession id from its stable pattern) + tests `musarch-dom.test.ts` against a captured Musarch page fixture in `src/repository/new-italy-museum/__fixtures__/`.
- [x] T015 [US1] [tier:powerful] Implement the museum `StructuredExtractor` binding in `src/repository/new-italy-museum/extractor.ts`: build the engine via `createEngine` (default codex, model configurable), inject the page as fenced data (injection fencing, FR-009), extract `MuseumItemFields` with `interpretation`, then run `verifyGrounded`; engine-absent → throw (INV-X4). Tests with a fake engine runner (no shell-out).
- [x] T016 [US1] [tier:powerful] Implement `NewItalyMuseumAdapter` in `src/repository/new-italy-museum/adapter.ts`: `resolve` (rate-limit-safe HTTP fetch → musarch-dom + extractor), `collectRightsEvidence` (grounded date + credit; proposes only), `acquire` (best-representation deterministic choice + record how; download master; write provenance to B2; typed `AcquisitionResult`). Tests with injected fake HTTP + object store.
- [x] T017 [US1] [tier:balanced] Wire `bib inventory` in `src/cli/bib-sourcegroup.ts` + `src/sourcegroup/inventory.ts` to accept `--repository <name>` and resolve a raw museum locator via the registry/adapter; create the member Source (`kind: archival-item`, `partOf` PB-P006, `status: discovered`); fail loud on an unverifiable locator. Tests.
- [x] T018 [US1] [tier:balanced] Implement the `bib rights-assess <sourceId>` verb in `src/rights/` + `src/cli/bib-sourcegroup.ts`: surface `collectRightsEvidence` output (excerpt, date + `interpretation`, credit), require operator confirmation of the date's interpretation, write the `Rights` fields on the RepositoryRecord (`assessedBy: operator`). Never auto-clears. Tests.
- [x] T019 [US1] [tier:powerful] Make museum `acquire` convergent + idempotent in the adapter + `src/sourcegroup/acquire.ts`: staging→verify→commit boundary (FR-020); already-acquired detection by object-store key + verified checksum (generic, not fetcher-specific); enforce recorded `public-domain` before acquire; remote-bytes-mismatch → throw, write nothing (FR-021). Tests: idempotent re-run (no dup), rights-not-PD refused, remote-change throws.
- [~] T020 [US1] [tier:fast] Inventory the identified PB-P006 candidates into `bibliography/sources/` as `archival-item` members (Survivors arrival 1881, Landing site at Port Breton, Pioneers Group 1890, School Group 1903) with accession identifiers + sourceUrls (run `bib inventory ... --repository new-italy-museum`); record in `RESEARCH_LOG.md`.
- [~] T021 [US1] [tier:balanced] End-to-end validation (quickstart §3): rights-assess + acquire + reconcile one candidate; verify master + provenance in B2, record `archived`, coverage counts once (SC-001/SC-006). Record measured result in `RESEARCH_LOG.md` (no projections).

**Checkpoint**: one museum public-domain item acquired, provenance-borne, reconciled — the MVP.

---

## Phase 5: User Story 3 — Coverage reflects lead resolution (Priority: P2)

**Goal**: resolved suspected leads render distinctly (SC-004).
**Independent test**: PB-P006's two leads render as `identified`; an `excluded`/`unavailable` lead requires + shows a reason.

- [x] T022 [US3] [tier:balanced] Extend `SUSPECTED_KEYS` + add the `resolution` discriminated-union loader/validator in `src/bibliography/load-coverage-fields.ts` (state-specific payloads; `excluded`/`unavailable` require `reason`; fail loud on an invalid combination). Tests in `load-coverage-fields` + `tests/unit/bibliography/`.
- [x] T023 [US3] [tier:balanced] Render `resolution.status` distinctly in `src/bibliography/coverage/coverage-register.ts` + `coverage-render.ts` (resolved ≠ open bullet; `inventoried` references its Source; reason shown). Tests + fixtures under `tests/fixtures/coverage/`.
- [x] T024 [US3] [tier:fast] Migrate PB-P006's two leads in `bibliography/sources/PB-P006.yml` (and the coverage fixture) from free-text `RESOLVED` notes to `resolution: { state: identified, candidate, resolvedAt }`; the `inventoried` leads link to the T020 Sources.

**Checkpoint**: coverage audit shows resolved leads as resolved (SC-004).

---

## Phase 6: User Story 4 — Coverage reports honest extent (Priority: P2)

**Goal**: three-state `knownExtent`; no bare `unknown` (SC-005).
**Independent test**: PB-P006 extent renders as its explicit state with basis; a bare `unknown`/old scalar fails loud.

- [x] T025 [US4] [tier:balanced] Replace `validateKnownMemberCount` with the `knownExtent` discriminated-union loader/validator in `src/bibliography/load-coverage-fields.ts` (`measured{count,basis}`/`unexamined`/`irreducible{basis}`); **remove** the `'unknown'` literal + scalar shape (fail loud on either). Tests.
- [x] T026 [US4] [tier:balanced] Render each `knownExtent` state distinctly with basis in `coverage-render.ts`; extent gap uses the state word, never a bare `unknown`. Tests + fixtures.
- [x] T027 [US4] [tier:fast] Set PB-P006's extent in `bibliography/sources/PB-P006.yml` (and fixture) to `{ state: irreducible, basis: ... }` (confirm at inventory); migrate any other source carrying the old scalar/`unknown` shape so the suite loads.

**Checkpoint**: no bare `unknown` extent anywhere; PB-P006 extent explicit (SC-005).

---

## Phase 7: Polish & cross-cutting

- [~] T028 [P] [tier:fast] Update `bibliography/sources/PB-P006.yml` `notes` to reference the acquired masters + rights determinations; scrub now-redundant free-text resolution prose.
- [x] T029 [P] [tier:balanced] Full suite + typecheck green: `npm test` and `npm run typecheck` (no `any`/`as`/`@ts-ignore`; `@/` imports; files ≤500 lines — split any that grew).
- [~] T030 [tier:balanced] Run the full quickstart end-to-end (all sections) and record the measured closure in `RESEARCH_LOG.md` (milestone/phase terms only, no temporal projections).

---

## Dependencies & order

- **Phase 1 → Phase 2** (setup before foundational).
- **Phase 2 (Foundational)** blocks all stories.
- **US2 (Phase 3)** before **US1 (Phase 4)** — the Gallica cutover establishes the shared acquire-dispatch path the museum reuses; T010 characterization tests before T012 removal.
- **US1 T020/T024** — the `inventoried` lead linkage in US3 (T024) references the Sources T020 creates; run T020 before T024.
- **US3 (Phase 5)** and **US4 (Phase 6)** are independent of each other; both independent of acquisition (coverage side).
- **Phase 7** last.

## Parallel opportunities

- Foundational: T002, T003, T004, T005, T008 are `[P]` (distinct files); T006/T007 depend on the types; T009 depends on T008.
- US1: T014 `[P]` (dom) parallel to early extractor scaffolding; T015→T016→T019 sequential (same adapter).
- Polish: T028, T029 `[P]`.

## MVP scope

**US1 (Phase 4)** delivers the headline value — one museum public-domain item acquired end-to-end — but requires **Foundational (Phase 2) + US2 (Phase 3)** for the adapter seam + dispatch. Minimum shippable increment = Phases 1–4. US3/US4 (audit surfaces) follow as P2.

## Tier summary

- **powerful** (opus): T010, T011, T012 (Gallica characterization + cutover), T015, T016, T019 (museum extractor + adapter + idempotent acquire).
- **balanced** (sonnet): T004, T005, T007, T009, T013, T014, T017, T018, T021, T022, T023, T025, T026, T029, T030.
- **fast** (haiku): T001, T002, T003, T006, T008, T020, T024, T027, T028.
