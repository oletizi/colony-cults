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
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import type { BrowserSession } from '@/sourcequery/browser-session';
import type { PageResult } from '@/sourcequery/types';

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
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Default persistent-profile dir: stable across runs, under the OS tmp dir. */
function defaultUserDataDir(): string {
  return path.join(os.tmpdir(), 'corpus-gap-closure', 'browser-profile');
}

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
  private context: InjectedContext | undefined;
  private page: InjectedPage | undefined;

  constructor(options: PlaywrightBrowserSessionOptions = {}) {
    this.userDataDir = options.userDataDir ?? defaultUserDataDir();
    this.forcedHeadless = options.headless;
    this.launch = options.launch ?? realLaunch;
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
    try {
      const response = await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      const html = await this.page.content();
      const snapshotMarkdown = await this.page.ariaSnapshot();
      return {
        status: response === null ? null : response.status(),
        html,
        snapshotMarkdown,
        errored: false,
      };
    } catch {
      return { status: null, html: '', snapshotMarkdown: '', errored: true };
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
