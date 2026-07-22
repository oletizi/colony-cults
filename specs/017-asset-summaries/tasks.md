---
description: "Task list for Asset Summaries (spec 017)"
---

# Tasks: Asset Summaries

**Input**: Design documents from `specs/017-asset-summaries/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED (TDD). The project tests runners/engines and pipelines heavily
(`vitest`), and Constitution V requires the fail-loud/no-mock discipline be proven; each
story writes its tests RED-first. External engines are faked ONLY inside test code, behind the
injected `SummarizationRunner` interface (legitimate, not a production mock).

**Organization**: grouped by user story (spec.md priorities). Model-tier tag `[tier:<label>]`
on every task (`fast`→haiku, `balanced`→sonnet, `powerful`→opus); resolved by `tier_map` at
`resolve-tiers`/execute time.

## Format: `[ID] [P?] [Story] [tier:<label>] Description with file path`

- **[P]**: parallelizable (different files, no incomplete-task dependency)
- **[Story]**: US1..US5 for user-story tasks; none for Setup/Foundational/Polish

## Constitution guardrails (apply to every task)

- Type-safe: `@/` imports, no `any`/`as`/`@ts-ignore`, files ≤ 300–500 lines (VII).
- Fail loud, no fallback/mock outside tests (V).
- Summary artifacts written **only** via `storeAsset` (XV — sidecar + manifest welded; no orphan).
- Summaries are machine-labeled interpretation, stored separate from evidence (I/III).
- Website UI (US2) built **only** through `/frontend-design:frontend-design` (XI).
- Commit + push after each task or logical group (IX).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: module skeleton + CLI verb registration

- [x] T001 [tier:fast] Create `src/summarize/` module directory with a barrel `src/summarize/index.ts` (placeholder exports, no logic)
- [x] T002 [tier:fast] Add `'summarize'` and `'summarize-source'` to the `Command` union in `src/cli/parse.ts`
- [x] T003 [P] [tier:fast] Add `bib summarize` / `bib summarize-source` entries to the help text in `src/cli/dispatch.ts` (handlers wired later)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the engine seam + shared provenance the generation core and the rollup both need

**⚠️ CRITICAL**: no user story can be implemented until this phase is complete

- [x] T004 [P] [tier:balanced] Define `SummarizationRunner`, `StructuredSummaryFields`, `SummaryResult`, `SummarizerName` interfaces in `src/summarize/types.ts` (per contracts/summarization-runner.md)
- [x] T005 [tier:powerful] Extend provenance for summary fields — `interpretation`, `input_layers` (`{path,sha256}[]`), `input_quality` (`{tier,note}`) — in `src/archive/provenance.ts` as additive-optional fields, preserving byte-identical re-serialization of existing records (unset → omitted); update `KEY_ORDER` + parse/serialize
- [x] T006 [P] [tier:balanced] RED unit test for the provenance extension (T005): summary fields round-trip; unrelated fixtures re-serialize byte-identically, in `tests/unit/summarize/provenance.test.ts`
- [x] T007 [P] [tier:fast] Summary model config: `DEFAULT_SUMMARY_MODEL = 'claude-sonnet-5'` + `resolveSummaryModel(flag, config)` (flag > config > default) in `src/summarize/config.ts`
- [x] T008 [P] [tier:balanced] Two-depth structured prompt (thorough = structured fields + prose; concise distilled from thorough, no new claims) in `src/summarize/prompt.ts`
- [x] T009 [tier:powerful] Claude summarizer adapter `createClaudeSummarizer(runner: ClaudeCommandRunner): SummarizationRunner` in `src/summarize/runner-claude.ts` — shells `claude --print … --model <model>` (reuse `src/claude/exec.ts`), parses the two-depth structured output, throws on empty/malformed (fail loud; no HTTP SDK — research Decision 1)
- [x] T010 [P] [tier:fast] RED unit test for the Claude adapter with a fake `ClaudeCommandRunner`: parses structured output; throws on empty/malformed, in `tests/unit/summarize/runner-claude.test.ts`
- [x] T011 [tier:balanced] Summarizer factory `createSummarizer(name)` + preflight (`assertClaudeAvailable`) in `src/summarize/factory.ts` (wires `'claude'`; mirrors `src/engine/factory.ts`)

**Checkpoint**: engine + provenance ready — user stories can begin

---

## Phase 3: User Story 1 - Generate a per-issue two-depth summary (Priority: P1) 🎯 MVP

**Goal**: for one issue with usable text, produce thorough + concise artifacts + sidecars; fail loud on no text.

**Independent Test**: `bib summarize <src> <issue>` on a seeded issue writes both artifacts each with a provenance sidecar (interpretation label, engine/model/input_layers); an issue with no text layer fails loud and writes nothing.

### Tests for User Story 1 (RED first)

- [x] T012 [P] [US1] [tier:fast] RED unit test for best-available-text selection (English OCR; French OCR + translation; else fail-loud) in `tests/unit/summarize/select-input.test.ts`
- [x] T013 [P] [US1] [tier:balanced] RED unit test for `buildSummaryProvenance` (derives from source page; sets summary fields + input_layers) in `tests/unit/summarize/artifacts.test.ts`
- [x] T014 [P] [US1] [tier:balanced] RED integration test: seed `issue.en.txt` + companion, run summarize (fake runner) → asserts both artifacts + sidecars + manifest entry; concise introduces no claim absent from thorough, in `tests/integration/summarize.test.ts`
- [x] T015 [P] [US1] [tier:fast] RED integration test: issue with no `issue.txt`/`issue.en.txt` → non-zero exit, descriptive error, zero artifacts, in `tests/integration/summarize-fail-loud.test.ts`

### Implementation for User Story 1

- [x] T016 [P] [US1] [tier:balanced] Best-available-text selection pure function in `src/summarize/select-input.ts` (returns chosen input layers + text, or fail-loud sentinel error)
- [x] T017 [US1] [tier:balanced] `buildSummaryProvenance(base, depth, engineName, model, retrieved, inputLayers, inputQuality?)` in `src/summarize/artifacts.ts` (mirror `buildTranslationProvenance`; file-name helpers for `issue.summary.long/short.en.md`); populate `input_quality` when the input OCR tier is `low` (FR-016)
- [x] T018 [US1] [tier:balanced] `summarizeIssue(issueDir, ctx)` in `src/summarize/issue.ts` — select input (fail loud on none), run `SummarizationRunner`, write BOTH artifacts + sidecars via `storeAsset` (Constitution XV weld); no direct `fs.writeFile` of summary markdown
- [x] T019 [US1] [tier:balanced] `runSummarize` + `buildSummarizeCliDeps` in `src/cli/summarize.ts` and wire the `summarize` HANDLER in `src/cli/dispatch.ts` (`--model`/`--engine`/`--force`/`--dry-run`; `resolveArchiveRoot`, `ensureMemberLayoutRegistered`, `resolveFetchedDir`; polite pacing + consecutive-failure abort)
- [x] T020 [US1] [tier:fast] Make T012–T015 green; run quickstart Scenarios 1–3 + 5; grep `src/summarize/` to confirm zero direct summary-markdown writes bypassing `storeAsset` (XV check)

**Checkpoint**: US1 fully functional and independently testable — MVP

---

## Phase 4: User Story 2 - Read the concise abstract on the website (Priority: P2)

**Goal**: researcher sees the concise abstract per issue (and source rollup on the landing page), labeled machine-generated.

**Independent Test**: with concise artifacts present, the browser data layer populates `IssueView.conciseSummary`/`SourceView.conciseSummary`; unsummarized units yield `null` and render gracefully.

### Tests for User Story 2 (RED first)

- [x] T021 [P] [US2] [tier:fast] RED unit test: `loadIssueSummary` honest-absence (missing → `null`; corrupt → throws) in `tests/unit/browser/summary.test.ts`

### Implementation for User Story 2

- [x] T022 [US2] [tier:balanced] `loadIssueSummary(issueDir)` in `src/browser/load/summary.ts` (mirror `load/translation.ts`; reads concise artifact + sidecar via `yaml`; `MachineAssistLabel`)
- [x] T023 [US2] [tier:balanced] Add `conciseSummary?` to `IssueView`/`SourceView` in `src/browser/model.ts`; wire the loader into `src/browser/load/corpus.ts` (additive, optional)
- [x] T024 [US2] [tier:powerful] Build the concise-abstract UI (issue view + source landing) in `site/` — issue/source abstract, visible machine-generated-summary label, graceful no-summary state. **PRECONDITION: invoke `/frontend-design:frontend-design` FIRST** (Constitution XI); validate quickstart Scenario 7

**Checkpoint**: US1 + US2 both independently functional

---

## Phase 5: User Story 3 - Reference the thorough finding-aid from the bibliography (Priority: P2)

**Goal**: the source record references the thorough summary by path; SSOT holds no inlined prose.

**Independent Test**: for a source with a rollup, `bibliography/sources/<id>.yml` carries a resolvable `summaryRef` and no inlined summary prose.

### Tests for User Story 3 (RED first)

- [x] T025 [P] [US3] [tier:balanced] RED integration test: after rollup, `summaryRef` present + resolves to the artifact; source YAML has no inlined prose, in `tests/integration/summary-reference.test.ts`

### Implementation for User Story 3

- [x] T026 [P] [US3] [tier:balanced] Add optional `summaryRef` (archive-relative path, `census:`-style) to `src/model/source.ts` + `src/model/repository-record.ts` and its serialization in `src/bibliography/source-writer.ts`
- [x] T027 [US3] [tier:powerful] `writeSummaryRef` / `readSummaryRef` + light "resolves to an existing artifact" validation in `src/bibliography/summary-reference.ts` (stay outside the B2-key-prefix false-positive scope of `validate-companion-coverage.ts`)

**Checkpoint**: US1–US3 independently functional

---

## Phase 6: User Story 4 - Per-source rollup abstract (Priority: P3)

**Goal**: concise + thorough source rollup synthesized from issue summaries (cover-what-exists); writes the bibliography reference in the same operation.

**Independent Test**: `bib summarize-source <src>` on a source with some summarized issues writes both rollup artifacts (sidecars record covered/missing issues) and the `summaryRef`; partial coverage does not error.

### Tests for User Story 4 (RED first)

- [x] T028 [P] [US4] [tier:balanced] RED integration test: `summarize-source` covers available issue summaries, records `covered_issues`/`missing_issues`, writes rollup + `summaryRef` in one op; partial coverage is not an error, in `tests/integration/summarize-source.test.ts`

### Implementation for User Story 4

- [x] T029 [US4] [tier:balanced] `summarizeSource(...)` rollup in `src/summarize/source-rollup.ts` (synthesize from existing issue summaries; cover-what-exists; coverage provenance)
- [x] T030 [US4] [tier:balanced] `runSummarizeSource` in `src/cli/summarize.ts` + wire the `summarize-source` HANDLER — write rollup artifacts via `storeAsset` AND the `summaryRef` (T027) in the SAME operation (XV weld)

**Checkpoint**: US1–US4 independently functional

---

## Phase 7: User Story 5 - Resumable, idempotent re-runs keyed to input layers (Priority: P3)

**Goal**: skip already-summarized issues with unchanged inputs; regenerate when OCR/translation changes.

**Independent Test**: rerun with no input change → zero regeneration; change an issue's input layer → only that issue regenerates.

### Tests for User Story 5 (RED first)

- [x] T031 [P] [US5] [tier:fast] RED unit test: input-layer sha key compute + compare-vs-recorded in `tests/unit/summarize/idempotency.test.ts`
- [x] T032 [P] [US5] [tier:balanced] RED integration test: rerun skips (no runner call); mutate `issue.en.txt` → only that issue regenerates, in `tests/integration/summarize-idempotent.test.ts`

### Implementation for User Story 5

- [x] T033 [US5] [tier:balanced] Input-layer sha key (compute from input companions; compare vs sidecar `input_layers`) in `src/summarize/idempotency.ts`
- [x] T034 [US5] [tier:balanced] Integrate skip/regenerate + `--force` override into `src/summarize/issue.ts` (and the rollup's staleness check) using the T033 key

**Checkpoint**: all user stories independently functional

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T035 [P] [tier:fast] Run the FULL quickstart.md validation (Scenarios 1–7) and record results
- [x] T036 [P] [tier:fast] Update `bib` help + a short `docs/` note for `summarize` / `summarize-source`
- [x] T037 [tier:balanced] Final type/size sweep on `src/summarize/*` (no `any`/`as`/`@ts-ignore`; each file ≤ 300–500 lines; `@/` imports) and `npm test` green

---

## Dependencies & Execution Order

### Phase dependencies

- Setup (P1) → Foundational (P2, BLOCKS all stories) → User Stories (P3–P7) → Polish (P8).
- US1 (P1) is the MVP and the generation core; US2/US3/US4/US5 all build on US1's output.
  - US2 (website) needs concise artifacts (US1). US3 (reference) + US4 (rollup) are paired —
    US4 writes the rollup, US3 provides the `summaryRef` write path US4 calls (do T027 before
    T030). US5 (idempotency) layers skip/regen onto US1's `summarizeIssue`.
- Polish depends on the desired stories being complete.

### Within each story

- Tests RED first (assert failure) → implementation → green. Models/types before services;
  services before CLI wiring; core before integration.

### Parallel opportunities

- Setup T003; Foundational T004/T006/T007/T008/T010 (different files) run [P].
- US1 tests T012–T015 run [P]; then T016 [P] alongside T017.
- Cross-story: once Foundational is done, US2 (T021–T023) and the US3/US4 pair can proceed in
  parallel with US5, staffing permitting (US1 first as MVP).

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (CRITICAL) → 3. Phase 3 US1 → STOP & validate
(quickstart 1–3, 5) → the generation core ships value on its own (finding-aid files exist).

### Incremental delivery

US1 (MVP) → US2 (website abstract) → US3+US4 (bibliography reference + rollup) → US5
(resumable). Each adds value without breaking prior stories.

---

## Notes

- `[tier:<label>]` on every task; `fast`→haiku, `balanced`→sonnet, `powerful`→opus. `powerful`
  reserved for high-blast-radius/ambiguous work: shared provenance extension (T005), structured
  LLM-output parsing (T009), the SSOT reference + validation (T027), and the design-gated UI
  (T024).
- Reuse the canonical archive writer (`storeAsset`/`writeProvenance`/`isAssetRecorded`) — do NOT
  add a second companion serializer.
- The `SummarizationRunner` is a shelled `claude` CLI adapter (research Decision 1); an HTTP-SDK
  adapter is a future swap behind the same interface (operator override, surfaced).
- Commit + push after each task or logical group (IX); no git hooks (X).

---

## Phase 9: Papers Past input adapter (US6) — extend 2026-07-22

**Goal**: make the summarizer source-aware so the English-language Papers Past articles are
summarizable (FR-018–FR-023). Test-first.

- [ ] T038 [US6] [tier:balanced] Make input resolution source-aware: change `selectSummaryInput` to take `{ issueDir, source, archiveRoot }` and add `origin` (+ optional `sourceRepresentation`) to `SelectedInputLayer` in `src/summarize/select-input.ts`; thread the source record + archiveRoot from `src/summarize/issue.ts`, `src/summarize/source-rollup.ts`, and `src/cli/summarize.ts` (load the `LoadedSource` once, pass it down)
- [ ] T039 [P] [US6] [tier:powerful] Papers Past branch in `select-input.ts`: when `isPapersPastSource(source)` (reuse `@/browser/load/papers-past`), resolve the `ocr-text` asset via `papersPastOcrAsset`, read `path.join(archiveRoot, objectStoreKey)`, English-only (no translation); attribute the layer `origin:'papers-past-ocr'`, `sourceRepresentation:'papers-past-text-tab'`
- [ ] T040 [US6] [tier:powerful] B2 pre-fetch: ensure the Papers Past `ocr-text` `.txt` is local — reuse the shipped CDN/B2 fetch the browser snapshot uses; if unfetchable, **fail loud** naming the asset (FR-020); respect Constitution XII on any network access
- [ ] T041 [US6] [tier:balanced] Provenance origin attribution: `buildSummaryProvenance` (`src/summarize/artifacts.ts`) records each input layer's `origin` (project-ocr / project-translation / papers-past-ocr) + `sourceRepresentation`; extend provenance fields as additive-optional (byte-identity preserved) — Papers Past attributed to source-downloaded (FR-021)
- [ ] T042 [US6] [tier:balanced] AUDIT-17 fix (FR-023): in the source-aware routing, a known-French Gallica source with `issue.en.txt` absent MUST fail loud ("translation pending"), never fall through to English-native single-layer
- [ ] T043 [P] [US6] [tier:balanced] RED-first tests: Papers Past source reads `ocr-text` + generates + provenance attributes Papers Past + no translation layer (`tests/integration/summarize-papers-past.test.ts`); Papers Past `.txt` missing → fail loud; French source translation-absent → fail loud "translation pending"

**Checkpoint**: `bib summarize <PapersPastSourceId>` generates; a full corpus run covers Gallica + Papers Past.

---

## Phase 10: Round-3 govern remediation — extend 2026-07-22

- [ ] T044 [tier:balanced] AUDIT-14/15/12: **enforce** `summaryRef` — wire `validateSummaryRef` into a real check point (a doctor/validate rule or validating load path) so a dangling ref fails loud at check time, and reject archive-root-escaping paths (`..`/absolute); fixture proving a dangling + a traversing ref are rejected by a WIRED path (`src/bibliography/summary-reference.ts`, `src/bibliography/load.ts`)
- [ ] T045 [tier:balanced] AUDIT-11: rollup idempotency must key on the coverage SET (not just covered layers) so a newly-missing issue refreshes `missing_issues` provenance on rerun (`src/summarize/source-rollup.ts` `isUpToDate`/`gatherCoverage`)
- [ ] T046 [tier:balanced] AUDIT-16: freshness must require the summary **markdown artifact to exist** (not sidecar-only) — a deleted `.md` with a surviving sidecar reads as stale/regenerate (`src/summarize/idempotency.ts`)
- [ ] T047 [tier:fast] AUDIT-13: `loadSummaryConfig` must **reject** malformed known keys (wrong-typed `model`/`engine`) with a descriptive error, not silently accept (`src/summarize/config.ts`)
