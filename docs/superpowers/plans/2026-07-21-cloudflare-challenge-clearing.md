# Cloudflare Managed-Challenge Clearing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PlaywrightBrowserSession.navigate()` dwell on a Cloudflare managed-challenge interstitial until it self-clears, then return the settled real page (with an honest re-goto status), so the governed client stops hard-blocking on the initial 403.

**Architecture:** A new pure predicate leaf (`cloudflare-challenge.ts`) decides "is this a Cloudflare managed challenge?" and "has it cleared?". `navigate()` uses those to run a bounded, injected-clock settle loop; on clear it re-`goto`s the URL once for an honest post-challenge status. `classify()` and every other module are unchanged — they simply receive a settled page.

**Tech Stack:** TypeScript (ESM, `@/` path alias), Playwright (`chromium.launchPersistentContext`, injected/faked at the `LaunchFn` boundary — no real browser in tests), Vitest, the existing `@/sourcequery/clock` (`Clock`/`Sleep`/`createFakeClock`).

## Global Constraints

- **Imports:** always the `@/` alias for internal modules (e.g. `@/sourcequery/clock`). Never relative deep paths.
- **No type escapes:** no `any`, no `as Type`, no `@ts-ignore`, no non-null `!`. Narrow with guards and local `const`s.
- **No fallbacks/mocks outside tests.** Fail loud with descriptive `Error`s (Principle V). The only new "fallback" permitted is the documented timeout→return-challenge path, which is an honest block, not a silent success.
- **No direct time:** the settle loop uses the injected `Clock`/`Sleep` (default `realClock`/`realSleep`); never call `Date.now()`/`setTimeout` directly in core logic. Tests use `createFakeClock` — zero real waits.
- **Cloudflare-managed only:** the new predicates must be NARROWER than `looksLikeWafChallenge`. Incapsula/Anubis pages must NOT enter the settle loop — their handling stays byte-for-byte unchanged.
- **No regression:** a non-Cloudflare page (normal, empty, Incapsula, errored, `goto`→null) must return exactly as today, with `goto` called exactly once and zero settle polls.
- **Constants:** `MAX_SETTLE_MS = 20000`, `POLL_INTERVAL_MS = 500` (overridable via constructor options for tests).
- **File size:** keep files well under 500 lines; `cloudflare-challenge.ts` is a small leaf.
- **Honest status:** on clear, report the re-goto's real status; on timeout, the original `goto` status. Never fabricate a status.

---

### Task 1: Cloudflare managed-challenge predicates

**Files:**
- Create: `src/sourcequery/cloudflare-challenge.ts`
- Test: `tests/unit/sourcequery/cloudflare-challenge.test.ts`

**Interfaces:**
- Consumes: nothing (pure leaf; no imports).
- Produces:
  - `looksLikeCloudflareChallenge(html: string, status: number | null): boolean`
  - `cloudflareChallengeCleared(html: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/sourcequery/cloudflare-challenge.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  looksLikeCloudflareChallenge,
  cloudflareChallengeCleared,
} from '@/sourcequery/cloudflare-challenge';

// The SRCH-0033 interstitial shape: the cdn-cgi challenge-platform script +
// the "Just a moment..." title, served under HTTP 403.
const CF_INTERSTITIAL =
  '<!DOCTYPE html><html><head><title>Just a moment...</title>' +
  '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=abc"></script>' +
  '</head><body><div class="main-wrapper"><noscript>Enable JavaScript and cookies to continue' +
  '</noscript></div><script>window._cf_chl_opt={cRay:"abc"};</script></body></html>';

const CLEARED_RESULTS_PAGE =
  '<html><body><div class="results"><h3>CONVICTION OF MARQUIS DE RAYS</h3></div></body></html>';

// An Incapsula interstitial — a DIFFERENT WAF that must NOT match the
// Cloudflare-specific predicate (it is handled unchanged elsewhere).
const INCAPSULA_INTERSTITIAL =
  '<html><head><script src="/_Incapsula_Resource?SWJIYLWA=x"></script></head>' +
  '<body>Request unsuccessful. Incapsula incident ID: 123-456</body></html>';

describe('looksLikeCloudflareChallenge', () => {
  it('is true for a Cloudflare managed-challenge interstitial served under 403', () => {
    expect(looksLikeCloudflareChallenge(CF_INTERSTITIAL, 403)).toBe(true);
  });

  it('is true under a null status (goto resolved null on the interstitial)', () => {
    expect(looksLikeCloudflareChallenge(CF_INTERSTITIAL, null)).toBe(true);
  });

  it('is true under 503 (the other status Cloudflare serves the interstitial under)', () => {
    expect(looksLikeCloudflareChallenge(CF_INTERSTITIAL, 503)).toBe(true);
  });

  it('is FALSE for a 200 page even if it bears a residual cf marker (already solved)', () => {
    const solvedWithResidualScript =
      '<html><body>real content<script>cf-chl residue</script></body></html>';
    expect(looksLikeCloudflareChallenge(solvedWithResidualScript, 200)).toBe(false);
  });

  it('is FALSE for a normal results page', () => {
    expect(looksLikeCloudflareChallenge(CLEARED_RESULTS_PAGE, 200)).toBe(false);
  });

  it('is FALSE for an Incapsula interstitial (Cloudflare-specific, not broad WAF)', () => {
    expect(looksLikeCloudflareChallenge(INCAPSULA_INTERSTITIAL, 403)).toBe(false);
  });
});

describe('cloudflareChallengeCleared', () => {
  it('is false while the active challenge markers are still present', () => {
    expect(cloudflareChallengeCleared(CF_INTERSTITIAL)).toBe(false);
  });

  it('is true once the challenge markers are gone (auto-reloaded to real content)', () => {
    expect(cloudflareChallengeCleared(CLEARED_RESULTS_PAGE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/sourcequery/cloudflare-challenge.test.ts`
Expected: FAIL — `Cannot find module '@/sourcequery/cloudflare-challenge'` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/sourcequery/cloudflare-challenge.ts`:

```typescript
/**
 * Cloudflare managed-challenge predicates (spec 2026-07-21).
 *
 * Pure, Playwright-free content probes used by the browser session's settle
 * loop to decide (a) whether a page is a Cloudflare MANAGED-challenge
 * interstitial worth dwelling on, and (b) whether that challenge has since
 * cleared. Deliberately NARROWER than block-detection's
 * `looksLikeWafChallenge`: only Cloudflare's self-solving managed challenge
 * (which a real browser can wait out) matches here. Incapsula/Anubis are
 * intentionally excluded so their handling stays unchanged.
 */

/**
 * Active Cloudflare managed-challenge content markers (case-insensitive).
 * Any one present ⇒ the page carries an active Cloudflare challenge.
 * These are Cloudflare-specific on purpose — no Incapsula/Anubis strings.
 */
const CHALLENGE_MARKERS: readonly string[] = [
  'cdn-cgi/challenge-platform',
  'challenges.cloudflare.com',
  'cf-chl',
  '_cf_chl_opt',
  'just a moment',
];

/** True when `html` carries any active Cloudflare managed-challenge marker. */
function hasChallengeMarker(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * HTTP statuses a Cloudflare managed-challenge interstitial is served under:
 * 403, 503, or `null` (a `goto` that resolved null on the interstitial). A
 * `200` is NOT a challenge status — a solved page can carry a residual marker.
 */
function isChallengeStatus(status: number | null): boolean {
  return status === null || status === 403 || status === 503;
}

/**
 * True when the page is a Cloudflare managed-challenge interstitial worth
 * dwelling on: an active challenge marker AND a challenge-consistent status.
 * The status gate keeps an already-solved 200 (which may retain a residual
 * challenge script) from spuriously entering the settle loop.
 */
export function looksLikeCloudflareChallenge(html: string, status: number | null): boolean {
  return isChallengeStatus(status) && hasChallengeMarker(html);
}

/**
 * True when a page that WAS a Cloudflare challenge no longer shows the active
 * challenge markers — i.e. the managed challenge self-solved and the page
 * auto-reloaded to real content. The settle loop polls this to detect
 * resolution.
 */
export function cloudflareChallengeCleared(html: string): boolean {
  return !hasChallengeMarker(html);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/sourcequery/cloudflare-challenge.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/sourcequery/cloudflare-challenge.ts tests/unit/sourcequery/cloudflare-challenge.test.ts
git commit -m "feat(sourcequery): Cloudflare managed-challenge predicates"
```

---

### Task 2: navigate() settle loop + honest re-goto status

**Files:**
- Modify: `src/sourcequery/browser-session-playwright.ts` (constructor options + fields; `navigate()`; a private `settleCloudflareChallenge`)
- Test: `tests/unit/sourcequery/browser-session-playwright.test.ts` (add a describe block; the shared `fakePage` helper needs no change — no new `InjectedPage` members)

**Interfaces:**
- Consumes: `looksLikeCloudflareChallenge`, `cloudflareChallengeCleared` from `@/sourcequery/cloudflare-challenge`; `Clock`, `Sleep`, `realClock`, `realSleep` from `@/sourcequery/clock`; existing `InjectedPage`, `LaunchFn`, `PageResult`.
- Produces: unchanged `navigate(url: string): Promise<PageResult>` signature; new **optional** constructor options `clock?`, `sleep?`, `maxSettleMs?`, `pollIntervalMs?` on `PlaywrightBrowserSessionOptions`.

**Context:** `navigate()` currently does `goto(url, {waitUntil:'domcontentloaded'})`, reads status/content/aria, returns. The existing tests (lines 93–155) construct `new PlaywrightBrowserSession({ launch })` and script `goto`/`content`/`ariaSnapshot` via a `fakePage` helper. `createFakeClock()` returns `{ clock, sleep, advance }` where `sleep(ms)` advances fake time immediately.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/sourcequery/browser-session-playwright.test.ts` (add the clock import at the top: `import { createFakeClock } from '@/sourcequery/clock';`). Add this describe block:

```typescript
describe('PlaywrightBrowserSession.navigate(): Cloudflare managed-challenge settle', () => {
  const CF_INTERSTITIAL =
    '<html><head><title>Just a moment...</title>' +
    '<script src="/cdn-cgi/challenge-platform/x"></script></head>' +
    '<body>Enable JavaScript and cookies to continue</body></html>';
  const CLEARED_PAGE =
    '<html><body><div class="results">CONVICTION OF MARQUIS DE RAYS</div></body></html>';

  it('dwells until the challenge clears, then re-gotos for the real 200 page', async () => {
    let gotoCalls = 0;
    let contentCalls = 0;
    const page = fakePage({
      goto: async () => {
        gotoCalls += 1;
        // First navigation: the 403 interstitial. Re-goto: the real 200.
        return gotoCalls === 1 ? { status: () => 403 } : { status: () => 200 };
      },
      content: async () => {
        contentCalls += 1;
        // Reads 1-2 still show the challenge; read 3+ shows cleared content.
        return contentCalls >= 3 ? CLEARED_PAGE : CF_INTERSTITIAL;
      },
      ariaSnapshot: async () => '- text "results"',
    });
    const fake = createFakeClock();
    const session = new PlaywrightBrowserSession({
      launch: async () => fakeContext(page),
      clock: fake.clock,
      sleep: fake.sleep,
    });
    await session.open();

    const result = await session.navigate('https://www.loc.gov/collections/chronicling-america/?q=x');

    expect(result.status).toBe(200);          // honest re-goto status, not the 403
    expect(result.html).toBe(CLEARED_PAGE);   // settled content
    expect(result.errored).toBe(false);
    expect(gotoCalls).toBe(2);                // one settle + one honest re-goto
  });

  it('returns the interstitial + original 403 when the challenge never clears (bounded)', async () => {
    let gotoCalls = 0;
    let contentCalls = 0;
    const page = fakePage({
      goto: async () => {
        gotoCalls += 1;
        return { status: () => 403 };
      },
      content: async () => {
        contentCalls += 1;
        return CF_INTERSTITIAL; // never clears
      },
      ariaSnapshot: async () => '- text "Just a moment"',
    });
    const fake = createFakeClock();
    const session = new PlaywrightBrowserSession({
      launch: async () => fakeContext(page),
      clock: fake.clock,
      sleep: fake.sleep,
      maxSettleMs: 2000,
      pollIntervalMs: 500,
    });
    await session.open();

    const result = await session.navigate('https://www.loc.gov/x');

    expect(result.status).toBe(403);      // original goto status preserved
    expect(result.html).toBe(CF_INTERSTITIAL);
    expect(gotoCalls).toBe(1);            // NO re-goto on timeout
    // Bounded: initial content read + one read per poll until the deadline.
    // 2000ms / 500ms = 4 polls, plus the initial read = 5 content() calls.
    expect(contentCalls).toBe(5);
  });

  it('does NOT settle a non-Cloudflare page (normal 200) — one goto, no polls', async () => {
    let gotoCalls = 0;
    let contentCalls = 0;
    const page = fakePage({
      goto: async () => {
        gotoCalls += 1;
        return { status: () => 200 };
      },
      content: async () => {
        contentCalls += 1;
        return '<html><body><div class="results">rows</div></body></html>';
      },
    });
    const fake = createFakeClock();
    const session = new PlaywrightBrowserSession({
      launch: async () => fakeContext(page),
      clock: fake.clock,
      sleep: fake.sleep,
    });
    await session.open();

    const result = await session.navigate('https://example.test/');

    expect(result.status).toBe(200);
    expect(gotoCalls).toBe(1);
    expect(contentCalls).toBe(1); // no settle loop entered
  });

  it('does NOT settle an Incapsula interstitial (Cloudflare-specific settle only)', async () => {
    let gotoCalls = 0;
    const incapsula =
      '<html><head><script src="/_Incapsula_Resource?x"></script></head>' +
      '<body>Request unsuccessful. Incapsula incident ID: 9</body></html>';
    const page = fakePage({
      goto: async () => {
        gotoCalls += 1;
        return { status: () => 403 };
      },
      content: async () => incapsula,
    });
    const fake = createFakeClock();
    const session = new PlaywrightBrowserSession({
      launch: async () => fakeContext(page),
      clock: fake.clock,
      sleep: fake.sleep,
    });
    await session.open();

    const result = await session.navigate('https://incap.test/');

    expect(result.status).toBe(403);
    expect(result.html).toBe(incapsula);
    expect(gotoCalls).toBe(1); // no Cloudflare settle, no re-goto — unchanged path
  });

  it('returns the re-goto challenge + 403 without re-settling when the reload is re-challenged', async () => {
    let gotoCalls = 0;
    let contentCalls = 0;
    const page = fakePage({
      goto: async () => {
        gotoCalls += 1;
        return { status: () => 403 };
      },
      content: async () => {
        contentCalls += 1;
        // Clears once (read 3) → triggers re-goto → reload is re-challenged again (read 4+).
        return contentCalls === 3 ? CLEARED_PAGE : CF_INTERSTITIAL;
      },
    });
    const fake = createFakeClock();
    const session = new PlaywrightBrowserSession({
      launch: async () => fakeContext(page),
      clock: fake.clock,
      sleep: fake.sleep,
    });
    await session.open();

    const result = await session.navigate('https://www.loc.gov/x');

    expect(gotoCalls).toBe(2);          // settle cleared → one re-goto
    expect(result.status).toBe(403);    // re-goto's status; no second settle loop
    expect(result.html).toBe(CF_INTERSTITIAL); // re-goto's content (re-challenged)
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/unit/sourcequery/browser-session-playwright.test.ts`
Expected: FAIL — the challenge-then-clear test fails because current `navigate()` does not settle (returns status 403, `gotoCalls` 1). The constructor also rejects the new `clock`/`sleep`/`maxSettleMs` options (type error / ignored).

- [ ] **Step 3: Add constructor options + fields**

In `src/sourcequery/browser-session-playwright.ts`, add the clock import near the other imports:

```typescript
import { realClock, realSleep, type Clock, type Sleep } from '@/sourcequery/clock';
```

Extend `PlaywrightBrowserSessionOptions`:

```typescript
export interface PlaywrightBrowserSessionOptions {
  /** Persistent profile dir (default: a stable path under the OS tmp dir). */
  userDataDir?: string;
  /** Force a specific headless mode, skipping the headed-first auto-retry. */
  headless?: boolean | 'new';
  /** Injected launch function (default: the real `chromium.launchPersistentContext`). */
  launch?: LaunchFn;
  /** Monotonic clock for the challenge settle loop (default: `realClock`). */
  clock?: Clock;
  /** Sleep for the challenge settle loop (default: `realSleep`). */
  sleep?: Sleep;
  /** Max wall-clock to dwell on a Cloudflare challenge before giving up (default 20000). */
  maxSettleMs?: number;
  /** Poll interval while dwelling on a Cloudflare challenge (default 500). */
  pollIntervalMs?: number;
}
```

Add fields + constructor wiring (place the two constants as module-level `const`s above the class):

```typescript
/** Default max wall-clock dwell on a Cloudflare managed challenge. */
const DEFAULT_MAX_SETTLE_MS = 20000;
/** Default poll interval while dwelling on a Cloudflare managed challenge. */
const DEFAULT_POLL_INTERVAL_MS = 500;
```

Inside the class, add fields:

```typescript
  private readonly clock: Clock;
  private readonly sleep: Sleep;
  private readonly maxSettleMs: number;
  private readonly pollIntervalMs: number;
```

Extend the constructor body (keep the existing three assignments):

```typescript
  constructor(options: PlaywrightBrowserSessionOptions = {}) {
    this.userDataDir = options.userDataDir ?? defaultBrowserProfileDir();
    this.forcedHeadless = options.headless;
    this.launch = options.launch ?? realLaunch;
    this.clock = options.clock ?? realClock;
    this.sleep = options.sleep ?? realSleep;
    this.maxSettleMs = options.maxSettleMs ?? DEFAULT_MAX_SETTLE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }
```

Add the predicate import near the top:

```typescript
import {
  looksLikeCloudflareChallenge,
  cloudflareChallengeCleared,
} from '@/sourcequery/cloudflare-challenge';
```

- [ ] **Step 4: Rewrite `navigate()` and add the settle helper**

Replace the current `navigate()` body with:

```typescript
  async navigate(url: string): Promise<PageResult> {
    if (this.page === undefined) {
      throw new Error(
        'PlaywrightBrowserSession: navigate() called before a successful open()',
      );
    }
    // Local const so TS keeps the non-undefined narrowing across awaits and the
    // private helper (no non-null assertions — Global Constraints).
    const page = this.page;
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
      let status = response === null ? null : response.status();
      let html = await page.content();

      // Cloudflare managed challenge: dwell until it self-clears, then re-goto
      // ONCE for an honest post-challenge status (the cf_clearance cookie is now
      // set). A challenge that never clears falls through with its original 403
      // so the client hard-blocks exactly as before (honest stop).
      if (looksLikeCloudflareChallenge(html, status)) {
        html = await this.settleCloudflareChallenge(page, html);
        if (cloudflareChallengeCleared(html)) {
          const reload = await page.goto(url, { waitUntil: 'domcontentloaded' });
          status = reload === null ? null : reload.status();
          html = await page.content();
        }
      }

      const snapshotMarkdown = await page.ariaSnapshot();
      return { status, html, snapshotMarkdown, errored: false };
    } catch {
      return { status: null, html: '', snapshotMarkdown: '', errored: true };
    }
  }

  /**
   * Dwell on a Cloudflare managed-challenge interstitial, polling the page
   * content every `pollIntervalMs` until the challenge clears (the managed
   * challenge self-solves and auto-reloads to real content) or `maxSettleMs`
   * of wall-clock elapses. Returns the final HTML — the cleared page on
   * success, or the still-challenged interstitial on timeout (the caller then
   * reports an honest block). Uses the injected clock/sleep so tests never
   * wait real time.
   */
  private async settleCloudflareChallenge(
    page: InjectedPage,
    initialHtml: string,
  ): Promise<string> {
    let html = initialHtml;
    const deadline = this.clock() + this.maxSettleMs;
    while (!cloudflareChallengeCleared(html) && this.clock() < deadline) {
      await this.sleep(this.pollIntervalMs);
      html = await page.content();
    }
    return html;
  }
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `npx vitest run tests/unit/sourcequery/browser-session-playwright.test.ts`
Expected: PASS — all existing `navigate()`/`open()`/`fetchBytes()`/`close()` tests still green (they never enter the settle loop: their pages carry no Cloudflare marker, so `goto` is called once and status comes straight from the `goto` response), plus the five new settle tests pass.

- [ ] **Step 6: Run the full sourcequery suite for regressions**

Run: `npx vitest run tests/unit/sourcequery`
Expected: PASS — no regression in block-detection, source-query-client, or the other sourcequery tests (this change is confined to `navigate()`; `classify()` and the client are untouched).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/sourcequery/browser-session-playwright.ts tests/unit/sourcequery/browser-session-playwright.test.ts
git commit -m "feat(sourcequery): clear Cloudflare managed challenges in navigate()"
```

---

### Task 3: Env-gated live smoke test against loc.gov

**Files:**
- Create: `tests/integration/sourcequery/chronicling-america-live.test.ts`

**Interfaces:**
- Consumes: the shipped `runQuerySource`/CLI path OR the `SourceQueryClient` with a real `PlaywrightBrowserSession` and the registered `chronicling-america` config. Use whatever the existing live/env-gated tests use (grep for `process.env` gating in `tests/`).
- Produces: nothing importable — a skipped-by-default smoke.

**Context:** This test actually hits loc.gov through the governed client. It MUST be skipped unless an env var is set, because (a) it needs network + a real Chrome, and (b) Cloudflare may hard-loop this environment's IP regardless of a correct client (documented residual — a timeout here is NOT a build failure). It is a manual validation hook, not a CI gate.

- [ ] **Step 1: Find the existing env-gating pattern**

Run: `grep -rn "process.env" tests/ | grep -iE "live|smoke|skip|SMOKE|LIVE" | head`
Expected: reveals the gate convention (e.g. `describe.skipIf(!process.env.CORPUS_LIVE_SMOKE)`). Use the SAME convention; if none exists, use `describe.skipIf(process.env.CORPUS_LIVE_SMOKE !== '1')`.

- [ ] **Step 2: Write the smoke test**

Create `tests/integration/sourcequery/chronicling-america-live.test.ts`:

```typescript
/**
 * LIVE smoke: exercise the governed client against loc.gov's Cloudflare-fronted
 * Chronicling America collection end-to-end. SKIPPED unless CORPUS_LIVE_SMOKE=1.
 *
 * A PASS confirms navigate()'s Cloudflare settle actually clears the managed
 * challenge and grounds a real result count. A FAILURE is ACCEPTABLE and is NOT
 * a build gate: Cloudflare may hard-loop this environment's IP regardless of a
 * correct client (spec Risks — IP reputation). Never add this to CI.
 */
import { describe, expect, it } from 'vitest';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';
import { getSourceConfig } from '@/sourcequery/source-config';

describe.skipIf(process.env.CORPUS_LIVE_SMOKE !== '1')(
  'LIVE: chronicling-america Cloudflare clearing',
  () => {
    it('clears the loc.gov managed challenge and grounds a result count for "Marquis de Rays"', async () => {
      const config = getSourceConfig('chronicling-america');
      const session = new PlaywrightBrowserSession();
      await session.open();
      try {
        const url = config.buildQueryUrl('Marquis de Rays');
        const page = await session.navigate(url);
        // The settled page must NOT be the 403 challenge: either a real results
        // page (status 200) or an honest classifiable page. Assert we got past
        // the interstitial.
        expect(page.errored).toBe(false);
        expect(page.status).not.toBe(403);
        expect(page.html.toLowerCase()).not.toContain('cdn-cgi/challenge-platform');
      } finally {
        await session.close();
      }
    }, 60000);
  },
);
```

- [ ] **Step 3: Verify it is skipped by default**

Run: `npx vitest run tests/integration/sourcequery/chronicling-america-live.test.ts`
Expected: the suite is SKIPPED (0 tests run, 1 skipped) because `CORPUS_LIVE_SMOKE` is unset. No network access occurs.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/sourcequery/chronicling-america-live.test.ts
git commit -m "test(sourcequery): env-gated live loc.gov Cloudflare smoke (skipped by default)"
```

---

## Notes for the executor

- **Do not** modify `block-detection.ts`, `classify()`, `source-query-client.ts`, or the `chronicling-america` SourceConfig in this plan — the fix is confined to `navigate()` plus the new predicate leaf. The `chronicling-america` config already exists (committed on this branch).
- After Task 2, the existing `browser-session-playwright.test.ts` tests must remain green **unmodified** except for the added import and describe block — if any existing assertion breaks, the change regressed the non-challenge path; fix the code, not the test.
- The actual live validation run against loc.gov (setting `CORPUS_LIVE_SMOKE=1`, through the governed client, recorded as the next search-log entry SRCH-0034) is a follow-up AFTER this branch merges — it is the resumed Chronicling America recon, not part of this plan's committed test runs.
