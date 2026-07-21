# Design — Warn the agent about stale-cookie WAF re-challenges (TASK-44)

Date: 2026-07-21
Branch: `feature/stale-cookie-warning`
Status: approved-in-conversation

## Problem

A stale/expired WAF (Incapsula) session cookie in the persistent Playwright
browser profile forces an immediate re-challenge, so a source that worked before
suddenly returns a challenge page (TASK-44). It surfaced twice this session, both
with unhelpful errors:

- **Query path** — `SourceQueryClient` throws `hard block detected (kind="status"/"challenge")` with no hint that clearing the profile fixes it.
- **Acquire path** — the papers-past adapter's `parseArticle` throws the *generic*
  `not an article page (fail-loud)` on a challenge interstitial — actively
  misleading (it reads as "wrong URL", not "WAF re-challenge").

The fix each time was to clear the profile (`rm -rf <profileDir>`) and retry. We
do NOT want to auto-flush the session (operator decision) — but the tooling
should TELL the agent this is a likely cause and how to fix it.

## Decision

Diagnostics only: enrich the two failure surfaces with a consistent, actionable
stale-cookie hint naming the profile path and the remediation. No behavior
change to the fetch/retry logic; no auto-flush.

### 1. Profile path + hint helper (`src/sourcequery/browser-profile.ts`, new leaf)

- `defaultBrowserProfileDir(): string` — the single source of truth for
  `os.tmpdir()/corpus-gap-closure/browser-profile` (moved here so both the query
  client and the acquire adapter can name it without importing Playwright).
- `staleCookieHint(profileDir = defaultBrowserProfileDir()): string` — one
  consistent message: *"If a source that previously worked now returns a WAF
  challenge, the persistent browser profile may hold a stale/expired WAF session
  cookie forcing an immediate re-challenge (TASK-44). Fix: clear the profile and
  retry — `rm -rf <profileDir>`."*
- `browser-session-playwright.ts` imports `defaultBrowserProfileDir` (replacing
  its private `defaultUserDataDir`), so there is one path definition.

### 2. Challenge detector (`src/sourcequery/block-detection.ts`)

- `looksLikeWafChallenge(html: string): boolean` — reuses the existing
  `FINGERPRINTS` (Incapsula incident ID, "Request unsuccessful", the
  automatic/redirect/challenge triad, cf-chl, Anubis, …): true when any
  fingerprint matches. Lets the acquire path distinguish a WAF challenge from a
  genuinely non-article page.

### 3. Wire into both surfaces

- **Query path** (`source-query-client.ts`): when the block `kind` is
  `'challenge'` or `'status'`, append `staleCookieHint()` to the hard-block error
  messages (the "Tailscale unavailable" / "no usable exit node" throws) — the
  agent sees it right where it's stuck.
- **Acquire path** (`papers-past/adapter.ts` `navigateAndParse`): wrap the
  `parseArticle(...)` call; if it throws AND `looksLikeWafChallenge(page.html)`,
  re-throw a clear error — *"fetched a WAF challenge page, not an article
  (kind=challenge); "* + `staleCookieHint()` — instead of the misleading generic
  parse error. A genuinely non-article page (no challenge fingerprint) still
  throws the original `parseArticle` error unchanged.

### 4. Tests (hermetic)

- `looksLikeWafChallenge` true on an Incapsula-fingerprint fixture, false on a
  normal HTML page.
- `staleCookieHint()` contains the profile path and `rm -rf`.
- Query client: a `challenge`/`status` hard block → the thrown error contains the
  hint + profile path (extend the existing block-path test with a challenge
  fixture; drive the Tailscale-unavailable branch so it throws).
- Adapter: `navigateAndParse` on a WAF-challenge HTML fixture → error mentions
  "challenge" + "stale" + the profile path; on a real non-article page (no
  fingerprint) → the plain `not an article page` error is preserved.

## Governance

Direct TDD on `feature/stale-cookie-warning`. Diagnostics only — explicitly NOT
automating profile flushing (operator decision). Closes the agent-experience half
of TASK-44 (the robustness/auto-heal half stays open).

## Out of scope

- Auto-detecting/clearing stale cookies or re-solving the challenge (TASK-44's
  robustness fix).
- Other adapters (only papers-past hits the WAF-challenge-as-non-article-page
  symptom today).
