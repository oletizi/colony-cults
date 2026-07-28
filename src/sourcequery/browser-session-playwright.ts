/**
 * PlaywrightBrowserSession: the real, Playwright-backed `BrowserSession`
 * (Phase 1, T013; research.md R2).
 *
 * Kept in its OWN module -- NOT in `browser-session.ts` -- so that the many
 * modules importing the plain `BrowserSession` interface never transitively
 * pull in Playwright (a deliberate deviation from the literal task path; see
 * the T013 report).
 *
 * research.md R2: launch the REAL installed Chrome (not bundled Chromium)
 * via `chromium.launchPersistentContext(userDataDir, { channel: 'chrome' })`
 * with a persistent profile. Real Chrome + a persistent profile + cookies is
 * what clears JS/cookie WAF walls (Incapsula/Cloudflare/Anubis) that a
 * headless stateless client cannot -- bundled headless Chromium is the most
 * bot-detectable configuration and is never used here. Headed-first: try
 * `headless: false`; if that launch throws (e.g. no display), retry once
 * with `headless: 'new'`. If BOTH fail, `open()` THROWS (fail-loud,
 * Principle V) -- there is no silent fallback to an ad-hoc fetch.
 *
 * DEVIATIONS FROM THE LITERAL TASK TEXT, both forced by the installed
 * Playwright version (1.61.1), not stylistic choices:
 *
 *  1. `page.accessibility.snapshot()` (the CDP accessibility-tree API) no
 *     longer exists in this Playwright version -- there is no `accessibility`
 *     member on `Page` at all. Its replacement, `page.ariaSnapshot()`,
 *     already returns a rendered, indented role/name string (a YAML-like
 *     ARIA snapshot), so `snapshotMarkdown` uses that string directly
 *     instead of a hand-written recursive renderer over a node tree.
 *
 *  2. `launchPersistentContext`'s `headless` option is `boolean` only in
 *     this version -- there is no `headless: 'new'` literal accepted by the
 *     real Playwright API. The public DI contract (`LaunchFn`) still offers
 *     `'new'` as a distinct second attempt, exactly as specced, so a fake
 *     `launch` in tests can assert the two attempts are distinguishable.
 *     The DEFAULT real-launch adapter (`realLaunch`) maps `'new'` to
 *     `headless: true` when calling the installed
 *     `chromium.launchPersistentContext` -- boolean `headless: true` is
 *     already Chromium/Chrome's "new" headless architecture in this
 *     Playwright version (the old headless mode was removed upstream).
 */
import { chromium } from 'playwright';
import { defaultBrowserProfileDir } from '@/sourcequery/browser-profile';
import type { BrowserSession } from '@/sourcequery/browser-session';
import type { PageResult } from '@/sourcequery/types';
import { realClock, realSleep, type Clock, type Sleep } from '@/sourcequery/clock';
import {
  looksLikeCloudflareChallenge,
  cloudflareChallengeCleared,
} from '@/sourcequery/cloudflare-challenge';

/** Minimal subset of Playwright's `Response` this module reads. */
export interface InjectedGotoResponse {
  status(): number;
}

/** Minimal subset of Playwright's `Page` this module drives. */
export interface InjectedPage {
  goto(
    url: string,
    options: { waitUntil: 'domcontentloaded' },
  ): Promise<InjectedGotoResponse | null>;
  content(): Promise<string>;
  ariaSnapshot(): Promise<string>;
  /**
   * Playwright's `Page.evaluate`: run `fn` (serialized into the page and
   * re-hydrated there) inside the page's JS context with an optional `arg`,
   * returning its result. Used by {@link PlaywrightBrowserSession.fetchBytes}
   * to run an in-page `fetch` that reuses the WAF-cleared browser's
   * cookies/TLS/origin, returning the bytes as a base64 `string` (a JSON-safe
   * transport across the CDP boundary). Typed to `Promise<string>` -- the only
   * shape this module needs; the real, generic `Page.evaluate` satisfies it
   * structurally (instantiate its result type to `string`).
   */
  evaluate(fn: string | Function, arg?: unknown): Promise<string>;
}

/** Minimal subset of Playwright's `BrowserContext` this module drives. */
export interface InjectedContext {
  pages(): InjectedPage[];
  newPage(): Promise<InjectedPage>;
  close(): Promise<void>;
}

/** The launch function signature `open()` retries under (headed, then `'new'`). */
export type LaunchFn = (
  userDataDir: string,
  opts: { channel: 'chrome'; headless: boolean | 'new' },
) => Promise<InjectedContext>;

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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Default max wall-clock dwell on a Cloudflare managed challenge. */
const DEFAULT_MAX_SETTLE_MS = 20000;
/** Default poll interval while dwelling on a Cloudflare managed challenge. */
const DEFAULT_POLL_INTERVAL_MS = 500;

// The default persistent-profile dir (stable across runs, under the OS tmp dir)
// is defined once in `@/sourcequery/browser-profile` so diagnostics elsewhere
// (the query client, the acquire adapter) can name the same path without
// importing Playwright. See `defaultBrowserProfileDir`.

/**
 * Default `launch`: the real `chromium.launchPersistentContext`. Maps the DI
 * contract's `headless: 'new'` to boolean `true` (see module doc, deviation
 * 2) since this Playwright version has no `'new'` headless literal.
 */
const realLaunch: LaunchFn = async (userDataDir, opts) => {
  const headless = opts.headless === 'new' ? true : opts.headless;
  return chromium.launchPersistentContext(userDataDir, {
    channel: opts.channel,
    headless,
  });
};

/**
 * Real, Playwright-backed `BrowserSession` (research.md R2). Launches the
 * genuine installed Chrome via a persistent profile, headed-first with a
 * single headless-fallback retry; a failure of BOTH throws (Principle V).
 * Navigation errors are NOT thrown -- they surface as an `errored: true`
 * `PageResult` for the block-detection classifier to read.
 */
export class PlaywrightBrowserSession implements BrowserSession {
  private readonly userDataDir: string;
  private readonly forcedHeadless: boolean | 'new' | undefined;
  private readonly launch: LaunchFn;
  private readonly clock: Clock;
  private readonly sleep: Sleep;
  private readonly maxSettleMs: number;
  private readonly pollIntervalMs: number;
  private context: InjectedContext | undefined;
  private page: InjectedPage | undefined;

  constructor(options: PlaywrightBrowserSessionOptions = {}) {
    this.userDataDir = options.userDataDir ?? defaultBrowserProfileDir();
    this.forcedHeadless = options.headless;
    this.launch = options.launch ?? realLaunch;
    this.clock = options.clock ?? realClock;
    this.sleep = options.sleep ?? realSleep;
    this.maxSettleMs = options.maxSettleMs ?? DEFAULT_MAX_SETTLE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Launch the browser: headed-first (`headless: false`), retrying once with
   * `headless: 'new'` on failure -- unless the caller forced a specific
   * `headless` value via the constructor, in which case only that single
   * mode is attempted. Throws a descriptive error (never a silent fallback)
   * if every attempt fails.
   */
  async open(): Promise<void> {
    const attempts: Array<boolean | 'new'> =
      this.forcedHeadless !== undefined ? [this.forcedHeadless] : [false, 'new'];

    let lastError: unknown;
    for (const headless of attempts) {
      try {
        this.context = await this.launch(this.userDataDir, {
          channel: 'chrome',
          headless,
        });
        this.page = this.context.pages()[0] ?? (await this.context.newPage());
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `PlaywrightBrowserSession: failed to launch Chrome (tried ${attempts
        .map((h) => `headless=${String(h)}`)
        .join(', then ')}) for userDataDir ${this.userDataDir}: ${describeError(lastError)}`,
    );
  }

  /**
   * Navigate to `url` and return its `PageResult`. A navigation error /
   * timeout / connection drop is CAUGHT and returned as
   * `{ status: null, html: '', snapshotMarkdown: '', errored: true }` -- a
   * valid errored result the block-detection classifier reads (research.md
   * R1) -- rather than thrown; only `open()`'s launch failure throws.
   */
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

  /**
   * Fetch the raw bytes at `url` INSIDE the open, WAF-cleared browser context
   * (research.md R1, CONFIRMED): the Papers Past `/imageserver/` CDN sits
   * behind the same Incapsula WAF as the article page, so a stateless byte
   * fetch is challenged, not served the GIF. Running an in-page `fetch`
   * (`credentials: 'include'`) in the already-navigated page reuses the
   * cleared browser's cookies/TLS/origin, so the CDN serves the real asset.
   * The bytes are marshalled back across the CDP boundary as base64 (a
   * JSON-safe transport) and decoded in Node. Throws (fail-loud, Principle V)
   * if the session was never opened/navigated, or on any non-OK response /
   * in-page error — never returns a challenge body as if it were the asset.
   */
  async fetchBytes(url: string): Promise<Uint8Array> {
    if (this.page === undefined) {
      throw new Error(
        `PlaywrightBrowserSession: fetchBytes('${url}') called before a successful ` +
          'open()/navigate() — the in-page fetch needs an open page on the same origin.',
      );
    }
    try {
      const base64 = await this.page.evaluate(
        async (u: string) => {
          const res = await fetch(u, { credentials: 'include' });
          if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + u);
          const bytes = new Uint8Array(await res.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          return btoa(bin);
        },
        url,
      );
      return Uint8Array.from(Buffer.from(base64, 'base64'));
    } catch (error) {
      throw new Error(
        `PlaywrightBrowserSession: in-page fetchBytes('${url}') failed inside the ` +
          `WAF-cleared browser context: ${describeError(error)}`,
      );
    }
  }

  /** Close the context, releasing resources. Safe to call if never opened. */
  async close(): Promise<void> {
    if (this.context === undefined) {
      return;
    }
    await this.context.close();
    this.context = undefined;
    this.page = undefined;
  }
}
