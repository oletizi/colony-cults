# Quickstart / Validation Guide: Source Query Client

Runnable scenarios that prove the feature works end to end. Details live in [contracts/](./contracts) and [data-model.md](./data-model.md).

## Prerequisites

- Repo deps installed; `playwright` added and the Chrome channel available (`npx playwright install chrome` if needed).
- Tailscale present (only exercised live in the manual escalation scenario).

## Scenario 1 — Governed query persists before returning (P1, core)

```
bib query-source papers-past --query "Marquis de Rays"
```

Expect: exit 0; a `QueryResult` JSON on stdout with a count and first-page candidates; and a raw capture written under `bibliography/repository-responses/papers-past/` **before** the summary is produced. Verify the returned count string is present in the persisted `.html`.

## Scenario 2 — Persistence failure fails loud (P1)

Point the capture dir at an unwritable path (or inject a failing writer in a unit test). Expect: non-zero exit, error on stderr, and **no** `QueryResult` — never an unpersisted result.

## Scenario 3 — Hermetic end-to-end (integration test)

Env-gated `vitest` integration test against a **local fixture server** serving a static results page and a static challenge page. Asserts: result page → persisted capture + grounded summary; challenge page → `OperatorPermissionRequest` on stdout with exit 3 and a persisted `block-*` evidence file; **no** exit-node switch occurred (fake `TailscaleRunner`).

## Scenario 4 — Operator-gated escalation, host restored (P2, unit)

Unit test with a fake `BrowserSession` (scripts a block, then a result after switch) + fake `TailscaleRunner`:
1. First `query(...)` returns an `OperatorPermissionRequest` (source, evidence path, current origin, proposed geo node, exact command, host-impact warning, minimal plan) and performs **no** switch.
2. Re-invoke with the approved node → asserts: `setExitNode(node)` called once, settle delay applied, only the minimal set run under extra-slow pacing, each page persisted, then `setExitNode(<prior>)` restores host state.
3. Assert the fake host's exit state equals its pre-run value (SC-004).

## Scenario 5 — Unit suite is hermetic

```
npx vitest run tests/unit/sourcequery
```

Expect: all policy units pass with injected fakes; zero network calls; the real `tailscale` binary is never invoked (SC-006 / FR-015).

## Scenario 6 — One-time live smoke (manual, NOT in CI)

Manual, operator-run validation only. **Never part of CI** — this hits a live source and requires a real browser.

**Purpose:** One-time real-world confirmation that a governed query against a LIVE source persists a capture, grounding the fixture-based tests against actual live markup.

**Prerequisite:** `npx playwright install chrome`.

**Command:**

```
bib query-source papers-past --query "Marquis de Rays"
```

**Expected:** Exit 0; a `QueryResult` JSON on stdout with count and candidates; and a raw capture written under `bibliography/repository-responses/papers-past/` (both a `.html` and a `.md` file). Verify the returned count string is literally present in the persisted `.html` (the grounding invariant).

**Validation note:** The Papers Past `resultSelector` in `src/sourcequery/sources/papers-past.ts` is provisional, validated only against a synthetic fixture in unit tests. This live smoke is where it is confirmed against real, live markup. If the parse returns 0 or throws, the selector/parse logic needs adjusting against the persisted live HTML.

**Caution:** This is the **only sanctioned way** to hit the live source — via the governed `bib query-source` client. Never use `curl`, `WebFetch`, or an ad-hoc browser against Papers Past or any source URL.

## Done / acceptance

Maps to Success Criteria: SC-001 (persist-before-return), SC-002 (grounding), SC-003/SC-004 (no autonomous switch; host restored), SC-005 (one command, no tool-choice), SC-006 (hermetic units).
