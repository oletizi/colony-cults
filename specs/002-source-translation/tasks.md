---

description: "Task list for Source Translation implementation"
---

# Tasks: Source Translation

**Input**: Design documents from `specs/002-source-translation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cli.md, quickstart.md

**Tests**: INCLUDED. The house rules (CLAUDE.md/AGENTS.md) and quickstart.md require vitest unit + integration coverage, and the shipped fetcher is test-first; the `claude` runner and clock are dependency-injected so no test ever invokes the real CLI.

**Organization**: Tasks are grouped by user story (spec.md priorities) so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 for user-story phases; Setup/Foundational/Polish carry no story label
- Paths are repo-root-relative; single-project layout per plan.md.

## Reuse note

This feature REUSES the shipped fetcher modules — do not reimplement: `@/archive/location` (`resolveArchiveRoot`, `findIssueDir`, `assertInsideArchive`), `@/archive/store` (`storeAsset`, `companionYamlPath`, `isAssetRecorded`), `@/archive/provenance` (`ProvenanceFields`, `writeProvenance`, `readProvenance`), `@/archive/checksum`, and `execCommand` from `@/ocr/exec`. New code lives under `src/claude/`, `src/translate/`, `src/cli/translate.ts`, and `src/translate-index.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire the second bin and module skeleton.

- [x] T001 [tier:fast] Add `bin: { "translate": "src/translate-index.ts" }` and a `"translate": "tsx src/translate-index.ts"` script to `package.json` (leave the existing `gallica` bin/script untouched).
- [x] T002 [P] [tier:fast] Create module directories with `.gitkeep`: `src/claude/`, `src/translate/`, and confirm `tests/unit/` and `tests/integration/` exist.
- [x] T003 [P] [tier:fast] Add a real `issue.txt` fixture (a small excerpt containing at least two `\f` page breaks) at `tests/fixtures/issue-sample.txt` for the page-split unit test, plus a minimal page-provenance `.yml` fixture at `tests/fixtures/page-provenance.yml` (rights_status: public-domain).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared translation primitives every user story depends on. MUST complete before US1/US2/US3.

- [x] T004 [P] [tier:balanced] Implement the Claude CLI adapter `src/claude/exec.ts` — re-export/reuse the generic `execCommand` from `@/ocr/exec` (per research R8) with a `ClaudeCommandRunner` interface (`run(command, args, stdin?)`), so tests can inject a fake. Confirm `execCommand` supports passing stdin; if not, extend the reused runner minimally (document the touch to shipped code).
- [x] T005 [P] [tier:balanced] Implement `src/claude/preflight.ts` — `assertClaudeAvailable(deps)` modeled on `@/ocr/preflight` `assertOcrToolchain`: fail loud naming `claude` + how to install/authenticate when absent; PATH lookup + runner injected. Fires only when translation runs (wired later), never on dry-run.
- [x] T006 [tier:balanced] Implement `src/claude/client.ts` — `ClaudeCli` with `run(prompt: string, sourceText: string, model?: string): Promise<string>`: one `claude --print` invocation, sourceText on stdin, prompt as instruction, capture stdout, throw a descriptive error on non-zero exit or empty output (no fallback). Model recorded for provenance.
- [x] T007 [P] [tier:fast] Implement `src/translate/pages.ts` — `splitPages(issueText: string): string[]` splitting on `\f`, dropping a trailing empty final element; `assemble(pages: string[]): string` joining page text in order. Pure functions.
- [x] T008 [P] [tier:balanced] Implement `src/translate/rights.ts` — `readIssueRights(sourceId, issueArk, archiveRoot)`: locate the issue dir via `findIssueDir` (offline), `readProvenance` the first page `.yml`, return `{ rights_status, citation: {title, catalog_url, language} }`; fail loud if no provenance found (per research R3).
- [x] T009 [tier:powerful] Decide + implement the provenance machine-assisted fields (data-model.md "Provenance additions"): extend `ProvenanceFields` in `@/archive/provenance` with additive OPTIONAL keys `engine?`, `model?`, `translation?` (keeping existing fetcher records valid), and include them in `KEY_ORDER`/`emitField`/`parseProvenance`. If the additive change is judged too invasive, fall back to a structured `notes` line — document the choice in the task. Update `@/archive/provenance` tests accordingly.
- [x] T010 [P] [tier:balanced] Implement `src/translate/artifacts.ts` — path helpers for `issue.fr.txt`, `issue.en.txt` (whole-issue, in the issue dir) and per-page intermediates `translation/pNNN.fr.txt` / `translation/pNNN.en.txt`; and a `buildTranslationProvenance(base, kind, model, retrieved)` that populates the FR-006 fields (engine=`claude-code-cli`, model, date, translation=`machine-assisted`, citation, rights_status, type, format=`text/plain`) reusing the source page provenance as base.

### Foundational tests

- [x] T011 [P] [tier:fast] Unit test `tests/unit/pages.test.ts` — `splitPages` on the `issue-sample.txt` fixture asserts the page count (== form-feeds + 1, trailing-empty dropped) and `assemble` round-trips.
- [x] T012 [P] [tier:balanced] Unit test `tests/unit/rights.test.ts` — `readIssueRights` returns public-domain + citation from the fixture; fails loud when provenance is absent.
- [x] T013 [P] [tier:balanced] Unit test `tests/unit/claude-preflight.test.ts` — `assertClaudeAvailable` passes when the injected PATH lookup finds `claude`, throws a descriptive error naming install/auth when absent.

**Checkpoint**: primitives exist and are unit-tested; user stories can start.

---

## Phase 3: User Story 1 — Translate a single issue to English (Priority: P1) 🎯 MVP

**Goal**: One archived public-domain issue → corrected French + English artifacts, page-chunked and idempotent, with YAML provenance, stored alongside the source.

**Independent test**: Run `translate <issueArk>` against a fixtured tmp archive with a faked `ClaudeCli`; assert `issue.fr.txt`, `issue.en.txt` + `.yml` companions land in the issue dir, English derives from corrected French, and provenance carries the machine-assisted label + citation.

- [x] T014 [US1] [tier:balanced] Implement `src/translate/cleanup.ts` — `cleanupPage(claude, pageText, model)`: build the cleanup instruction (dehyphenate, join broken lines, repair obvious scan errors, drop condition markers, stay faithful) and return corrected French via `ClaudeCli`.
- [x] T015 [US1] [tier:balanced] Implement `src/translate/translate-page.ts` — `translatePage(claude, correctedFrench, model)`: build the translation instruction (readable English from the corrected French) and return English via `ClaudeCli`.
- [x] T016 [US1] [tier:powerful] Implement `src/translate/issue.ts` — `translateIssue(issueArk, ctx)`: guard-first; read `issue.txt`, `splitPages`; per page run cleanup → translate; persist each page intermediate idempotently (reuse `storeAsset`/`isAssetRecorded` for skip); assemble whole-issue fr/en; write `issue.fr.txt`/`issue.en.txt` + `.yml` via `storeAsset`; return a per-issue result (pagesDone/pagesTotal, outcome). `ctx` injects `claude`, `archiveRoot`, `clock`, `force`, `model`, `log`.
- [x] T017 [US1] [tier:powerful] Enforce the rights gate + engine preflight in `translateIssue`: refuse (fail loud, write nothing) when `readIssueRights` ≠ public-domain (FR-008); call `assertClaudeAvailable` before the first `claude` call (FR-009); never emit partial/fabricated output on any failure (FR-013).
- [x] T018 [US1] [tier:balanced] Implement `src/cli/translate.ts` `runTranslate(args)` + extend `src/cli/parse.ts` to recognize `translate`/`translate-source` commands and the `--model` option (reuse existing `--dry-run`/`--force` flags); implement `src/translate-index.ts` bin dispatch mirroring `src/index.ts` (help/version/error-to-stderr, exit codes per contracts/cli.md).

### US1 tests

- [x] T019 [P] [US1] [tier:balanced] Integration test `tests/integration/translate-issue.test.ts` — faked `ClaudeCli` (deterministic outputs) + tmp archive + injected clock: asserts fr/en artifacts + `.yml` land alongside source, English derived from corrected French, provenance fields (engine/model/date/machine-assisted/citation), and page count == fixture pages.
- [x] T020 [P] [US1] [tier:balanced] Integration test `tests/integration/translate-idempotent.test.ts` — second run skips (no `claude` calls); deleting one page intermediate then re-running reprocesses only that page (FR-011/FR-012/SC-008); `--force` regenerates.
- [x] T021 [P] [US1] [tier:balanced] Integration test `tests/integration/translate-guards.test.ts` — non-public-domain provenance ⇒ refusal + nothing written (FR-008); `claude` preflight absent ⇒ fail loud, nothing written (FR-009); a faked `claude` failure ⇒ descriptive error, no partial artifact (FR-013).

**Checkpoint**: US1 is a complete, demonstrable MVP.

---

## Phase 4: User Story 2 — Translate an entire source (Priority: P2)

**Goal**: Iterate a source's archived issues, translating each not-yet-translated one, paced, resumable, aborting after N=3 consecutive failures.

**Independent test**: Run `translate-source <sourceId>` over a tmp archive with several fixtured issues + faked `ClaudeCli`; assert untranslated issues translated, translated ones skipped, a per-issue report, and (with a forced-failing runner) abort after 3 consecutive failures.

- [x] T022 [US2] [tier:balanced] Implement source issue discovery in `src/translate/source.ts` — enumerate the source's archived issue dirs on disk (reuse the fetcher's on-disk enumeration pattern / `sourceLayout`), yielding issue arks in order; fail loud for an unregistered source.
- [x] T023 [US2] [tier:powerful] Implement `translateSource(sourceId, ctx)` in `src/translate/source.ts` — iterate issues calling `translateIssue`; skip already-translated (unless force); pace calls with an injected delay (default polite constant); track consecutive failures and ABORT after N=3 (FR-017); accumulate a `TranslateRunReport` (translated/skipped/refused/failed/incomplete per issue) (FR-015).
- [x] T024 [US2] [tier:balanced] Wire `runTranslateSource(args)` in `src/cli/translate.ts` + dispatch in `src/translate-index.ts`; print the per-issue outcome report; exit non-zero on a consecutive-failure abort.

### US2 tests

- [x] T025 [P] [US2] [tier:balanced] Integration test `tests/integration/translate-source.test.ts` — mixed archive: untranslated translated, translated skipped, report shape correct, pacing delay invoked (injected spy).
- [x] T026 [P] [US2] [tier:balanced] Integration test `tests/integration/translate-source-abort.test.ts` — faked `claude` forced to fail: run aborts after exactly 3 consecutive issue failures, reports the condition, exits non-zero (FR-017/SC-009).

**Checkpoint**: US2 scales the MVP to whole sources independently of US3.

---

## Phase 5: User Story 3 — Preview intended work without writing (Priority: P3)

**Goal**: `--dry-run` reports intended per-issue work + rights status, writes nothing, needs no engine.

**Independent test**: Run both commands with `--dry-run` over a tmp archive; assert zero files written and a report distinguishing would-translate / would-skip / refuse-on-rights, with no `claude` preflight required.

- [x] T027 [US3] [tier:balanced] Implement dry-run in `translateIssue`/`translateSource` — when `ctx.dryRun`, compute rights status + page/issue counts + skip/translate/refuse classification WITHOUT calling `assertClaudeAvailable` or `ClaudeCli` and WITHOUT any write; return the same report shape (FR-010).
- [x] T028 [US3] [tier:balanced] Surface the dry-run report in `src/cli/translate.ts` for both commands (per-issue translate/skip/refuse + rights status).

### US3 tests

- [x] T029 [P] [US3] [tier:balanced] Integration test `tests/integration/translate-dry-run.test.ts` — dry-run writes zero files (archive byte-identical), reports intended work + rights, and does not require `claude` present (preflight not called) (FR-010/SC-007/FR-009).

**Checkpoint**: all three user stories independently testable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T030 [P] [tier:fast] Add `translate`/`translate-source` help text to `src/translate-index.ts` matching contracts/cli.md; verify `--help`/`--version` and exit codes.
- [x] T031 [P] [tier:fast] Confirm every new file is ≤ 300–500 lines, `@/` imports only, no `any`/`as`/`@ts-ignore`; run `npm run typecheck`.
- [~] T032 [tier:powerful] Run the full suite `npm test` (vitest) green; walk quickstart.md Scenarios A–F manually against the real archive (`/Users/orion/work/colony-cults-archive`, `PB-P001`) with a real `claude` for at least one issue (verify actual `claude --print` flag spelling on the installed version — research R1 open item).
- [x] T033 [P] [tier:fast] Update `README.md` with the `translate` CLI usage; note the machine-assisted labeling + PD-only policy (AGENTS.md).

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T013)** → user stories.
- **Foundational blocks all stories**: the `claude` adapter (T004–T006), pages (T007), rights (T008), provenance fields (T009), artifacts (T010) are prerequisites.
- **US1 (T014–T021)** is the MVP and must precede US2 (US2's `translateSource` calls `translateIssue`).
- **US2 (T022–T026)** depends on US1.
- **US3 (T027–T029)** depends on US1's `translateIssue`/`translateSource` (adds a no-write branch); can follow US2 or interleave after T016/T023.
- **Polish (T030–T033)** last.

### Parallel opportunities

- Setup: T002, T003 in parallel.
- Foundational: T004, T005, T007, T008, T010 in parallel (distinct files); T006 after T004; T009 standalone; tests T011–T013 in parallel after their targets.
- US1 tests T019–T021 in parallel after T018. US2 tests T025–T026 in parallel after T024. US3 test T029 after T028.

## Implementation Strategy

- **MVP = Phase 1 + Phase 2 + Phase 3 (US1)**: a working `translate <issueArk>` producing provenanced corrected-French + English for one public-domain issue, page-chunked and idempotent.
- **Increment 2 = US2**: whole-source runs with pacing + consecutive-failure abort.
- **Increment 3 = US3**: dry-run preview.
- Deliver and test each phase before starting the next.
