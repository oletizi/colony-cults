/**
 * Unit tests for PlaywrightBrowserSession (T013). The Playwright `launch`
 * boundary is fully injected -- NOTHING here ever launches a real browser.
 */
import { describe, expect, it } from 'vitest';
import {
  PlaywrightBrowserSession,
  type InjectedContext,
  type InjectedGotoResponse,
  type InjectedPage,
  type LaunchFn,
} from '@/sourcequery/browser-session-playwright';
import { createFakeClock } from '@/sourcequery/clock';

/** A scripted fake page: goto/content/ariaSnapshot/evaluate are all overridable. */
function fakePage(overrides: Partial<InjectedPage> = {}): InjectedPage {
  const response: InjectedGotoResponse = { status: () => 200 };
  return {
    goto: async () => response,
    content: async () => '<html></html>',
    ariaSnapshot: async () => '- text',
    // Default: unscripted -- the throw's Promise<never> is assignable to the
    // generic evaluate<T> signature, so no `as` is needed. Tests that exercise
    // fetchBytes override this with a scripted base64-returning stub.
    evaluate: async () => {
      throw new Error('fakePage.evaluate: not scripted for this test');
    },
    ...overrides,
  };
}

function fakeContext(page: InjectedPage): InjectedContext {
  let closed = false;
  return {
    pages: () => [page],
    newPage: async () => page,
    close: async () => {
      closed = true;
      void closed;
    },
  };
}

describe('PlaywrightBrowserSession.open()', () => {
  it('tries the headed attempt (headless: false) first', async () => {
    const headlessValuesTried: Array<boolean | 'new'> = [];
    const launch: LaunchFn = async (_userDataDir, opts) => {
      headlessValuesTried.push(opts.headless);
      return fakeContext(fakePage());
    };
    const session = new PlaywrightBrowserSession({ launch });

    await session.open();

    expect(headlessValuesTried).toEqual([false]);
  });

  it('retries with headless: "new" when the headed launch throws, and succeeds', async () => {
    const headlessValuesTried: Array<boolean | 'new'> = [];
    const launch: LaunchFn = async (_userDataDir, opts) => {
      headlessValuesTried.push(opts.headless);
      if (opts.headless === false) {
        throw new Error('no display available');
      }
      return fakeContext(fakePage());
    };
    const session = new PlaywrightBrowserSession({ launch });

    await expect(session.open()).resolves.toBeUndefined();
    expect(headlessValuesTried).toEqual([false, 'new']);
  });

  it('rejects (throws) when BOTH the headed and headless launches fail -- no silent fallback', async () => {
    const launch: LaunchFn = async () => {
      throw new Error('Chrome not found');
    };
    const session = new PlaywrightBrowserSession({ launch });

    await expect(session.open()).rejects.toThrow(
      /PlaywrightBrowserSession: failed to launch Chrome/,
    );
  });

  it('propagates the underlying failure reason in the thrown error', async () => {
    const launch: LaunchFn = async () => {
      throw new Error('Chrome not found at expected path');
    };
    const session = new PlaywrightBrowserSession({ launch });

    await expect(session.open()).rejects.toThrow(/Chrome not found at expected path/);
  });
});

describe('PlaywrightBrowserSession.navigate()', () => {
  it('maps a fake page\'s status/content/aria-snapshot into a correct PageResult', async () => {
    const page = fakePage({
      goto: async () => ({ status: () => 404 }),
      content: async () => '<html><body>not found</body></html>',
      ariaSnapshot: async () => '- heading "Not Found"',
    });
    const launch: LaunchFn = async () => fakeContext(page);
    const session = new PlaywrightBrowserSession({ launch });
    await session.open();

    const result = await session.navigate('https://example.test/missing');

    expect(result).toEqual({
      status: 404,
      html: '<html><body>not found</body></html>',
      snapshotMarkdown: '- heading "Not Found"',
      errored: false,
    });
  });

  it('returns status: null when goto resolves null (e.g. same-document navigation)', async () => {
    const page = fakePage({ goto: async () => null });
    const launch: LaunchFn = async () => fakeContext(page);
    const session = new PlaywrightBrowserSession({ launch });
    await session.open();

    const result = await session.navigate('https://example.test/');

    expect(result.status).toBeNull();
    expect(result.errored).toBe(false);
  });

  it('returns an errored PageResult (not a throw) when goto throws (navigation drop/timeout)', async () => {
    const page = fakePage({
      goto: async () => {
        throw new Error('net::ERR_CONNECTION_RESET');
      },
    });
    const launch: LaunchFn = async () => fakeContext(page);
    const session = new PlaywrightBrowserSession({ launch });
    await session.open();

    const result = await session.navigate('https://example.test/dropped');

    expect(result).toEqual({
      status: null,
      html: '',
      snapshotMarkdown: '',
      errored: true,
    });
  });

  it('throws if navigate() is called before a successful open()', async () => {
    const session = new PlaywrightBrowserSession({
      launch: async () => fakeContext(fakePage()),
    });

    await expect(session.navigate('https://example.test/')).rejects.toThrow(
      /navigate\(\) called before a successful open\(\)/,
    );
  });
});

describe('PlaywrightBrowserSession.fetchBytes()', () => {
  it('decodes the base64 an in-page evaluate returns into the raw bytes', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2a]);
    const base64 = Buffer.from(gif).toString('base64');
    const page = fakePage({ evaluate: async () => base64 });
    const session = new PlaywrightBrowserSession({ launch: async () => fakeContext(page) });
    await session.open();

    const bytes = await session.fetchBytes('https://example.test/imageserver/x');

    expect(Array.from(bytes)).toEqual(Array.from(gif));
  });

  it('throws (fail-loud) when the in-page fetch errors, naming the url', async () => {
    const page = fakePage({
      evaluate: async () => {
        throw new Error('HTTP 403 for https://example.test/imageserver/x');
      },
    });
    const session = new PlaywrightBrowserSession({ launch: async () => fakeContext(page) });
    await session.open();

    await expect(session.fetchBytes('https://example.test/imageserver/x')).rejects.toThrow(
      /in-page fetchBytes\('https:\/\/example.test\/imageserver\/x'\) failed/,
    );
  });

  it('throws if fetchBytes() is called before a successful open()/navigate()', async () => {
    const session = new PlaywrightBrowserSession({
      launch: async () => fakeContext(fakePage()),
    });

    await expect(session.fetchBytes('https://example.test/x')).rejects.toThrow(
      /fetchBytes\('https:\/\/example.test\/x'\) called before a successful open\(\)\/navigate\(\)/,
    );
  });
});

describe('PlaywrightBrowserSession.close()', () => {
  it('closes the launched context', async () => {
    let closeCalls = 0;
    const context: InjectedContext = {
      pages: () => [fakePage()],
      newPage: async () => fakePage(),
      close: async () => {
        closeCalls += 1;
      },
    };
    const session = new PlaywrightBrowserSession({ launch: async () => context });
    await session.open();

    await session.close();

    expect(closeCalls).toBe(1);
  });

  it('is safe to call if open() was never called', async () => {
    const session = new PlaywrightBrowserSession({
      launch: async () => fakeContext(fakePage()),
    });

    await expect(session.close()).resolves.toBeUndefined();
  });
});

describe('PlaywrightBrowserSession: forced headless option', () => {
  it('honors an explicit headless override and does not auto-retry', async () => {
    const headlessValuesTried: Array<boolean | 'new'> = [];
    const launch: LaunchFn = async (_userDataDir, opts) => {
      headlessValuesTried.push(opts.headless);
      return fakeContext(fakePage());
    };
    const session = new PlaywrightBrowserSession({ launch, headless: 'new' });

    await session.open();

    expect(headlessValuesTried).toEqual(['new']);
  });
});

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
