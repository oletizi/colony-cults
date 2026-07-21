# Cloudflare Managed-Challenge Clearing — Design

**Status:** approved (brainstorm), pending spec review
**Date:** 2026-07-21
**Origin:** SRCH-0033 (Chronicling America recon). loc.gov migrated (2025-08) behind a
Cloudflare managed challenge; the governed `bib query-source` client cannot clear it and
hard-blocks on the initial HTTP 403, leaving the US-press vein unmeasured.

## Goal

Make `PlaywrightBrowserSession.navigate()` return a *settled* `PageResult` — dwelling on a
Cloudflare **managed-challenge** interstitial until it self-clears — so `classify()` sees the
real page instead of the 403 stall. This extends the client's existing WAF-clearing mandate
(Incapsula/Anubis) to Cloudflare's managed variant, unblocking loc.gov (Chronicling America)
and any other Cloudflare-fronted source.

## Background: why it currently fails

A Cloudflare managed challenge works like this: the first response is an HTTP 403 (or 503)
"Just a moment…" interstitial carrying the `/cdn-cgi/challenge-platform` orchestrate script.
That script runs in a real browser, transparently solves a proof-of-work / fingerprint check,
sets a `cf_clearance` cookie, and then **auto-reloads the page itself** to the real 200 content
(~5 s typical). No human interaction is required for a *managed* challenge.

The governed client never gives it that window:

- `navigate()` (browser-session-playwright.ts) does `page.goto(url, { waitUntil: 'domcontentloaded' })`
  and reads `response.status()` **immediately**. `domcontentloaded` fires on the 403 interstitial's
  DOM, long before the challenge JS solves and reloads. So `navigate()` captures the 403 page.
- `classify()` (block-detection.ts) treats a 403 status as a hard block in its **first** step,
  before it even inspects content.

Result: an immediate, honest-but-premature hard block. Clearing the browser profile does **not**
help — this is not a stale cookie (confirmed in SRCH-0033); it is a missing dwell.

## Scope

**In scope:** Cloudflare **managed** challenges (the self-solving `challenge-platform` interstitial),
handled entirely inside `navigate()`.

**Out of scope (YAGNI):**
- CAPTCHA / Cloudflare Turnstile / interactive challenges (no self-solve; would need human/solver).
- Any change to Incapsula/Anubis handling (they already work; untouched).
- Any change to `classify()` or the exit-node / escalation logic.
- Defeating IP-reputation blocks (see Risks) — out of our control, explicitly not promised.

## Design

### Unit 1 — `cloudflare-challenge.ts` (new leaf module)

A dependency-free module holding the Cloudflare-specific predicates, unit-testable in isolation
and free of Playwright imports.

- `looksLikeCloudflareChallenge(html: string, status: number | null): boolean` — true when the
  page is a Cloudflare managed-challenge interstitial. Positive signal = a Cloudflare-specific
  content marker **and** a challenge-consistent status. Markers (case-insensitive substring, any
  one suffices): `cdn-cgi/challenge-platform`, `challenges.cloudflare.com`, `cf-chl`,
  `_cf_chl_opt`, `just a moment`. Status gate: `null`, `403`, or `503` (the interstitial's typical
  statuses); a `200` bearing the marker is NOT treated as a live challenge (the marker can appear
  in a solved page's residual script), so the settle loop is not entered spuriously.
  **Cloudflare-specific on purpose** — narrower than `looksLikeWafChallenge` — so we dwell ONLY on
  challenges that self-solve.
- `cloudflareChallengeCleared(html: string): boolean` — true when a page that WAS a challenge no
  longer shows the active-challenge markers (`cdn-cgi/challenge-platform`, `cf-chl`, `_cf_chl_opt`,
  `just a moment`). The settle loop polls this to detect resolution.

### Unit 2 — `navigate()` settle loop (browser-session-playwright.ts)

Revised flow:

1. Attach a main-frame document **response listener** before `goto` (see Unit 3).
2. `goto(url, { waitUntil: 'domcontentloaded' })` as today.
3. Read initial `content()`. If `looksLikeCloudflareChallenge(html, status)` is **false**, return
   the `PageResult` immediately — behavior is byte-for-byte unchanged for every non-Cloudflare page
   (Incapsula, normal results, empties, errors).
4. Otherwise enter the **settle loop**: poll every `POLL_INTERVAL_MS` (500 ms), re-reading
   `content()`, until `cloudflareChallengeCleared(html)` is true OR `MAX_SETTLE_MS` (20 000 ms)
   of wall-clock elapses.
5. After the loop, read final `content()` + `ariaSnapshot()`, and take `status` from the response
   listener's **last recorded main-frame document status** (Unit 3).
   - Cleared → settled HTML + real post-challenge status (200) → `classify()` returns result/empty.
   - Timed out → the still-challenged HTML + last status (403) → `classify()` hard-blocks exactly as
     today. Evidence is persisted by the caller; the honest-stop contract is preserved.

Timing uses an **injected clock/sleep** (DI) so tests are deterministic and never wait real seconds —
consistent with the codebase rule that core modules never call `Date`/timers directly.

### Unit 3 — honest status capture

Settle-in-place creates a status-honesty problem: after the auto-reload to 200, the original
`response` object from step 2's `goto` still reads 403. Fabricating a 200 would be dishonest.

Fix: a **main-frame document response listener**. Before `goto`, subscribe to the page's response
stream; record the status of each response whose URL is a main-frame document navigation. After the
settle loop, `navigate()` reports the **last** recorded document status — the genuine post-challenge
200 when cleared, or the still-403 when not.

This extends the minimal `InjectedPage` interface with one hook (an `on('response', handler)`-style
subscription, or an injected accessor exposing "last main-frame document status"). Kept DI-friendly:
the test fakes drive recorded statuses directly. If no document response is ever recorded (edge
case), fall back to the `goto` response's status — never fabricate.

## Data flow

```
navigate(url)
  → attach document-response listener
  → goto(url, domcontentloaded)             [initial: 403 + challenge interstitial]
  → looksLikeCloudflareChallenge? — no  → return PageResult (unchanged path)
                                  — yes → settle loop:
        poll content() every 500ms until cloudflareChallengeCleared() or 20s
  → read final content() + ariaSnapshot()
  → status = last recorded main-frame document status (200 cleared | 403 timed out)
  → return PageResult  → classify()  → result / empty / block (as the settled page warrants)
```

## Error handling / fail-loud

- A navigation throw still returns `{ status: null, html: '', snapshotMarkdown: '', errored: true }`
  (unchanged) → `classify()` reports a `drop` block.
- The settle loop NEVER converts a still-present challenge into a false success: if the markers
  remain at timeout, the 403 interstitial is returned and the caller hard-blocks (Principle V).
- The dwell is bounded (`MAX_SETTLE_MS`); no unbounded hang.
- No new silent fallback: an unclearable challenge fails loud with persisted evidence, as today.

## Testing

Unit (via the injected fake page + injected clock — no real waits, no network):

1. **Challenge-then-clear** — `content()` yields the interstitial for the first N polls, then the
   settled results page; document-status stream yields 403…then 200. Assert `navigate()` returns the
   settled HTML and status 200, and that `classify()` (real) then returns `result`.
2. **Challenge-never-clears** — `content()` always yields the interstitial; clock advances past
   `MAX_SETTLE_MS`. Assert `navigate()` returns the interstitial + 403 and that `classify()` returns a
   `status`/`challenge` block. Assert the loop is bounded (a fixed poll count).
3. **Non-challenge page (no regression)** — a normal 200 results page: assert `navigate()` returns
   immediately, performs zero settle polls, byte-identical to current behavior. Same for an Incapsula
   interstitial (must NOT enter the Cloudflare settle loop).
4. **Status honesty** — assert the reported status is the last recorded document status, and the
   no-document-recorded fallback uses the `goto` response status (never a fabricated 200).
5. **Predicate units** — `looksLikeCloudflareChallenge` / `cloudflareChallengeCleared` table tests,
   including the real persisted SRCH-0033 interstitial capture and a solved-page fixture.

Live (env-gated smoke, NOT a CI gate): a real `bib query-source chronicling-america --query "Marquis de Rays"`
attempt against loc.gov. Passing confirms end-to-end clearing; **failing is acceptable** and does not
fail the build — Cloudflare may hard-loop this environment's IP regardless of a correct client (see Risks).

## Risks

- **IP reputation (out of scope, documented).** A managed challenge can loop indefinitely without ever
  issuing `cf_clearance` if Cloudflare deems the source IP bad-reputation (datacenter/VPN IPs are more
  suspect, not less). This feature makes the client *correctly wait and clear when solvable, and fail
  loud when not* — it does not and cannot guarantee loc.gov access. If the live smoke loops to timeout,
  the follow-up is an operator-set residential-reputation exit node, tracked separately — not a defect
  in this feature.
- **Marker drift.** Cloudflare may change interstitial markup. Mitigation: multiple independent markers;
  a table test pinned to the persisted SRCH-0033 capture; the fail-loud path means drift degrades to an
  honest block, never a false success.
- **Playwright interface surface.** Adding the response-listener hook widens `InjectedPage`. Mitigation:
  keep it to one minimal method; the real adapter maps to Playwright's `page.on('response', …)`, the
  fakes drive it directly.

## Acceptance criteria

1. `navigate()` dwells on a Cloudflare managed-challenge interstitial and returns the settled page when
   the challenge self-clears within `MAX_SETTLE_MS`.
2. On a challenge that never clears, `navigate()` returns the interstitial and the client hard-blocks
   with persisted evidence — no regression to the honest-stop contract.
3. Non-Cloudflare pages (normal, empty, Incapsula, errored) are byte-for-byte unchanged — zero settle
   polls, no new latency.
4. Reported status is honest (last real document status; documented fallback; never fabricated).
5. Full unit coverage per the Testing section; the live smoke exists and is env-gated (not a CI gate).
