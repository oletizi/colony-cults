---
description: "Task list for Source Query Client"
---

# Tasks: Source Query Client

**Input**: Design documents from `specs/014-source-query-client/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/
**Tests**: INCLUDED — the spec explicitly requests them (FR-018, SC-006).
**Tiers**: each task carries `[tier:fast|balanced|powerful]` (fast→haiku, balanced→sonnet, powerful→opus) for model-sized dispatch at execute.

## Format: `[ID] [P?] [Story?] [tier:X] Description with file path`

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [tier:fast] Add `playwright` to package.json deps and document the `npx playwright install chrome` step in specs/014-source-query-client/quickstart.md; create the `src/sourcequery/` directory.
- [ ] T002 [P] [tier:fast] Create core type definitions in src/sourcequery/types.ts (QuerySummary, Candidate, QueryResult, PersistedCapture, ExitNode, HostExitState, BlockEvidence, OperatorPermissionRequest, GraceWindowConfig, PageResult) per data-model.md — types only, no logic.
- [ ] T003 [P] [tier:fast] Create tests/unit/sourcequery/ and tests/integration/sourcequery/ directories and a shared fixtures module tests/unit/sourcequery/fakes.ts (stub exports for FakeBrowserSession, FakeTailscaleRunner, fake clock/sleep).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shared boundaries + persistence that every user story builds on. MUST complete before US1.

- [ ] T004 [tier:balanced] Define SourceConfig + the source registry in src/sourcequery/source-config.ts (fields per data-model.md; GraceWindowConfig defaults from research R6: settleMs 8000, extraSlowIntervalMs 15000, maxRequests 3, maxWindowMs 60000).
- [ ] T005 [P] [tier:balanced] Define the `BrowserSession` interface (open/navigate/close → PageResult) in src/sourcequery/browser-session.ts and a `FakeBrowserSession` in tests/unit/sourcequery/fakes.ts that returns scripted PageResults keyed by URL.
- [ ] T006 [P] [tier:balanced] Define the `TailscaleRunner` interface (listExitNodes/currentExitNode/setExitNode) in src/sourcequery/tailscale-runner.ts and a `FakeTailscaleRunner` in tests/unit/sourcequery/fakes.ts that records calls and never execs (FR-015).
- [ ] T007 [P] [tier:fast] Add injectable clock/sleep helpers in src/sourcequery/clock.ts mirroring src/gallica/http-client.ts (real + fake).
- [ ] T008 [tier:balanced] Implement persistence in src/sourcequery/persistence.ts (write raw HTML + a11y snapshot under bibliography/repository-responses/<source>/<slug>-<UTC>.{html,md}; block-<UTC> variant; slug/path builders); persistence failure throws.
- [ ] T009 [P] [tier:balanced] Unit test persistence in tests/unit/sourcequery/persistence.test.ts (writes both artifacts before returning; throws on unwritable dir — persist-before-return / fail-loud, SC-001).
- [ ] T009a [tier:balanced] Implement the `retention: 'derived-facts-only'` branch (FR-009) in src/sourcequery/frugality.ts + source-query-client.ts: for a retention-forbidden source, persist NOTHING and return derived facts + attribution (still paced + bounded); unit-test it in tests/unit/sourcequery/frugality.test.ts (no capture written; attribution present).

---

## Phase 3: User Story 1 — Governed query, code-enforced (Priority: P1) 🎯 MVP

**Goal**: one command runs a real-browser query, persists before returning, and grounds every returned fact in the saved page.
**Independent test**: `bib query-source <fixture> --query "…"` writes a capture before the summary and the count appears in the saved HTML; disabling persistence fails loud.

- [ ] T010 [P] [US1] [tier:powerful] Implement block/result/empty classification in src/sourcequery/block-detection.ts per research R1 (positive-signal-only block; legit empty ≠ block; needs resultSelector + status + fingerprints).
- [ ] T011 [P] [US1] [tier:balanced] Implement PolitenessPolicy in src/sourcequery/politeness-policy.ts (single session; min inter-navigation interval reusing src/gallica/rate-limiter.ts).
- [ ] T012 [US1] [tier:powerful] Implement Frugality in src/sourcequery/frugality.ts: persistThenParse(pageResult, config) → persist (T008), parse summary from the PERSISTED copy, verify-in-code that the count string is a literal substring of the persisted bytes (ungrounded → throw, FR-007/SC-002).
- [ ] T013 [US1] [tier:balanced] Implement the real BrowserSession in src/sourcequery/browser-session.ts using Playwright launchPersistentContext({ channel: 'chrome' }, genuine Chrome UA; headed-first with headless:'new' fallback; launch failure throws — research R2).
- [ ] T014 [US1] [tier:powerful] Implement SourceQueryClient (result/empty happy path) in src/sourcequery/source-query-client.ts: open → navigate → persist → classify → (result|empty) → grounded QueryResult; always close(); constructor-injected browser/clock/sleep/registry.
- [ ] T015 [US1] [tier:balanced] Add the `bib query-source` CLI verb in src/cli/bib-query-source.ts per contracts/cli-query-source.md (args/flags; JSON QueryResult on stdout; fail-loud non-zero on persistence/launch/ungrounded).
- [ ] T016 [P] [US1] [tier:balanced] Register a Papers Past SourceConfig (paperspast.natlib.govt.nz/newspapers: buildQueryUrl, resultSelector, parseSummary) in src/sourcequery/source-config.ts (research R3).
- [ ] T017 [P] [US1] [tier:balanced] Unit tests for US1 in tests/unit/sourcequery/source-query-client.test.ts + block-detection.test.ts (result vs legit-empty via FakeBrowserSession; grounded summary; ungrounded fails loud).
- [ ] T018 [US1] [tier:powerful] Env-gated integration test in tests/integration/sourcequery/fixture.test.ts against a local fixture server (static results + challenge pages): result page → persisted capture + grounded summary; no host mutation (FakeTailscaleRunner). (quickstart Scenario 3)

**Checkpoint**: US1 is an independently shippable MVP — governed queries against non-walled sources, fully code-enforced.

---

## Phase 4: User Story 2 — Operator-gated exit-node escalation (Priority: P2)

**Goal**: a hard block escalates to an agent-mediated, operator-approved switch that runs a grace-disciplined minimal set and restores host state.
**Independent test**: fake block → OperatorPermissionRequest + persisted block evidence, no switch; on approved re-invocation → switch → minimal set (extra-slow, bounded) → restore.

- [ ] T019 [P] [US2] [tier:balanced] Implement ExitNode enumeration + geo-selection in src/sourcequery/exit-node-policy.ts (parse `tailscale exit-node list`; capture prior state via currentExitNode; pick by preferredGeo — research R4).
- [ ] T020 [US2] [tier:powerful] Implement OperatorPermissionRequest construction + the STOP behavior in src/sourcequery/exit-node-policy.ts and src/sourcequery/source-query-client.ts: on a detected block, persist BlockEvidence (T008) then return the request; NEVER switch autonomously (FR-010/FR-011).
- [ ] T021 [US2] [tier:powerful] Implement runApprovedSwitch in src/sourcequery/exit-node-policy.ts: setExitNode(node) → settle → run only the minimal set under extra-slow pacing → stop at window bound (time/count) → persist each page → restore prior exit state; one switch per pass (FR-012/FR-013/FR-014).
- [ ] T022 [US2] [tier:balanced] Wire the `--approve-exit-node <node>` flag + exit code 3 (unapproved escalation) into src/cli/bib-query-source.ts per contracts/cli-query-source.md.
- [ ] T023 [P] [US2] [tier:powerful] Unit tests for US2 in tests/unit/sourcequery/exit-node-policy.test.ts (permission-request contents; no autonomous switch; approved switch calls setExitNode once, applies grace bounds, persists each page, and restores prior state — SC-003/SC-004; escalation budget of 1/pass; AND the no-usable-node / Tailscale-unavailable path reports honestly and stops without switching — spec Edge Case).
- [ ] T024 [P] [US2] [tier:balanced] Extend the fixture integration test: challenge page → exit 3 + OperatorPermissionRequest + persisted block-* evidence, and FakeTailscaleRunner records no set until approval (quickstart Scenario 3/4).

**Checkpoint**: US1 + US2 = the full governed mechanism including the walled-source backstop.

---

## Phase 5: User Story 3 — Skill & commandment point at the client (Priority: P3)

**Goal**: the discipline docs name the shipped client as the one mechanism; MCP browser demoted to governed manual fallback.

- [ ] T025 [US3] [tier:fast] Update .claude/skills/fetching-online-sources/SKILL.md: the single sanctioned mechanism becomes `bib query-source`; demote the Playwright MCP browser to a governed manual fallback; add "reaching for the MCP browser or any tool instead of the client" to the rationalization table + red flags (FR-017).
- [ ] T026 [P] [US3] [tier:fast] Update the CLAUDE.md commandment to point at the client and list the forbidden ad-hoc channels (curl, WebFetch, WebSearch-for-content, raw HttpClient, ungoverned browser calls).

**Checkpoint**: code + discipline docs are consistent; the sanctioned path is the path of least resistance.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T027 [P] [tier:balanced] Register a local-fixture-server SourceConfig used only by the integration test in src/sourcequery/source-config.ts.
- [ ] T028 [tier:balanced] Run `npx tsc --noEmit` + `npx vitest run tests/unit/sourcequery` and fix any type/lint issues (no `any`/`as`/`@ts-ignore`; files ≤300–500 lines — split if needed).
- [ ] T029 [P] [tier:fast] Add a one-time live smoke check to quickstart.md (Papers Past governed query, verify a capture landed) — manual, not in CI.

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T009)** → **US1 (T010–T018)** → **US2 (T019–T024)** → **US3 (T025–T026)** → **Polish (T027–T029)**.
- US1 is the MVP and is independently shippable after Phase 3.
- US2 depends on Foundational (browser/tailscale/persistence boundaries) and on US1's block-detection + orchestrator; it does not modify US1's happy path.
- US3 depends only on the client existing (US1); it is docs-only.

## Parallel Opportunities

- Setup: T002, T003 in parallel.
- Foundational: T005, T006, T007 in parallel (distinct files); T009 parallel with T005/T006/T007 after T008.
- US1: T010, T011, T016, T017 parallel (distinct files); T012/T014 sequential (frugality → orchestrator).
- US2: T019, T023 parallel; T020→T021 sequential.
- US3: T025, T026 parallel.

## Implementation Strategy

MVP = Phase 1 → 2 → 3 (US1): a fully code-enforced governed query for non-walled sources. Add US2 (walled-source escalation) as the second increment, then US3 (docs) to close the seam. Tests accompany each story (SC-006: hermetic units, no host mutation).

## Format Validation

All 30 tasks follow `- [ ] Txxx [P?] [US?] [tier:X] <description + file path>`; setup/foundational/polish carry no story label; every story task carries [US n]; every task carries a tier.
