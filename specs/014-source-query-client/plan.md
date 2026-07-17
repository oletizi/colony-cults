# Implementation Plan: Source Query Client

**Branch**: `feature/corpus-gap-closure` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-source-query-client/spec.md`

## Summary

Ship one code-enforced mechanism (`SourceQueryClient`, exposed as a `bib query-source` CLI verb) that drives its own real browser (Playwright, real Chrome channel + persistent profile) for every query against an external source, and bakes politeness + frugality into code: single session, paced navigations, persist-raw-page-before-return, bounded queries, and verify-in-code grounding. A Tailscale exit-node escalation is available as an operator-gated, grace-disciplined last resort that restores host state — approval is agent-mediated in-session (the client emits a permission request and stops; the agent asks the operator; on approval the client is re-invoked with the approved node). Every host-affecting or network-affecting boundary is behind an injectable interface so the whole thing is unit-testable with no network and no host mutation.

## Technical Context

**Language/Version**: TypeScript (ES modules), Node 22, executed via `tsx` (matches the existing repo toolchain).

**Primary Dependencies**: `playwright` (NEW — real Chrome channel via `channel: 'chrome'`, persistent context); reuse `src/gallica/rate-limiter.ts` for pacing; the host `tailscale` CLI (v1.96.4+) driven through an injectable runner; `vitest` for tests.

**Storage**: files under `bibliography/repository-responses/<source>/` — persisted raw captures (`<slug>-<UTC>.html` + `.md` accessibility snapshot) and block evidence (`block-<UTC>.{html,md}`). No database.

**Testing**: `vitest` — unit tests with injected fakes (no network, no host mutation); one opt-in, env-gated integration test against a local fixture server (and optionally a live benign source).

**Target Platform**: local macOS/Linux host (darwin dev host); Node process invoked by operator/agent.

**Project Type**: single project — a library module (`src/sourcequery/`) plus one CLI verb.

**Performance Goals**: not latency-bound. Correctness + politeness: default min inter-navigation interval ~1 req/s; extra-slow pacing (default ~15s) during a post-switch grace window.

**Constraints**: unit tests make zero network calls; the exit-node path never mutates the real host in tests (fake `TailscaleRunner` only); persist-before-return is invariant (persistence failure → hard error); genuine Chrome UA (no bot-flagging descriptive UA); host exit-node mutation is operator-gated and always restored; TypeScript strictness per Principle VII (no `any`/`as`/`@ts-ignore`); files ≤300–500 lines (split modules).

**Scale/Scope**: a handful of `SourceConfig` entries; one browser session per pass; single-digit navigations per query by default.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|-----------|------------|
| I. Evidence Before Narrative | **Directly served** — verify-in-code grounds every returned fact in a persisted capture; ungrounded output fails loud. |
| III. Provenance Is Mandatory | **Directly served** — every query persists its raw source response before analysis. |
| IV. Respect Copyright (Fail Closed) | Honored — per-source ToS retention rule (Trove-class = derived-facts-only); no paywall/login circumvention. |
| V. Fail Loud, No Fallbacks | **Central** — persistence failure, browser-launch failure, ungrounded output all hard-error; no silent degradation to an ad-hoc fetch; injected fakes live only in tests. |
| VI. Composition Over Inheritance | Honored — `BrowserSession`, `TailscaleRunner`, policies, `SourceConfig` are composed via interfaces; no class inheritance. |
| VII. Type Safety | Honored — no `any`/`as`/`@ts-ignore`; typed config + results. |
| VIII. Faithful Tool Adoption | Honored — faithful use of Playwright + the `tailscale` CLI; reuse of the existing `RateLimiter`. |
| IX / X | Commit-and-push early; no git hooks. |
| XI. Design Through the Design Skill | Satisfied — brainstormed design doc approved before this plan. |
| **XII. Respect the Source** | **This feature IS the operationalization of XII** — frugal, polite, non-wasteful, verify-before-store access. |
| XIII. No Agent Memory | N/A — the client holds no agent memory. |
| XIV. Operator Owns Scope | Honored — non-goals are operator-confirmed boundaries; exit-node mutation is operator-gated, never autonomous. |

**Verdict: PASS — no violations, Complexity Tracking not required.** The one notable dependency addition (`playwright`) is justified in research (R2): a real browser is the only mechanism that clears the WAF walls the mandate must survive.

## Project Structure

### Documentation (this feature)

```text
specs/014-source-query-client/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI verb + injectable interfaces)
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/sourcequery/
├── source-query-client.ts     # orchestrator (one governed query pass)
├── browser-session.ts         # injectable Playwright wrapper (real Chrome channel)
├── politeness-policy.ts       # single session + min-interval pacing (reuses RateLimiter)
├── frugality.ts               # persist-before-return, bounded query, verify-in-code grounding
├── persistence.ts             # capture writer (HTML + a11y snapshot) + slug/paths
├── exit-node-policy.ts        # enumerate/geo-select/permission-request/switch+grace+restore
├── tailscale-runner.ts        # injectable exec wrapper over the `tailscale` CLI
├── block-detection.ts         # WAF/challenge fingerprinting + status/drop classification
├── source-config.ts           # SourceConfig type + the registry of per-source configs
└── types.ts                   # QueryResult, OperatorPermissionRequest, ExitNode, etc.

src/cli/
└── bib-query-source.ts        # the `bib query-source` verb (wires the client)

tests/unit/sourcequery/        # injected-fake unit tests (no network, no host mutation)
tests/integration/sourcequery/ # opt-in env-gated: local fixture server end-to-end
```

**Structure Decision**: single project; a focused `src/sourcequery/` module (each file one purpose, ≤300–500 lines) plus one CLI verb under the existing `src/cli/`. Mirrors the `src/gallica/` shape (client + rate-limiter + typed boundaries) the repo already uses.

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.

## Phase Outputs

- **Phase 0** → `research.md`: block-detection strategy, browser channel/headed decision, first reference source, Tailscale command specifics, persistence format, grace-window defaults, verify-in-code grounding.
- **Phase 1** → `data-model.md` (entities), `contracts/` (CLI verb contract + injectable interfaces), `quickstart.md` (validation scenarios). Agent context (`CLAUDE.md` SPECKIT marker) updated to point at this plan.
- **Phase 2** → `tasks.md` via `/speckit-tasks` (not created here).
