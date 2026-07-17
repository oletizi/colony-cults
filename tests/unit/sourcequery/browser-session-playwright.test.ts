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

/** A scripted fake page: goto/content/ariaSnapshot are all overridable. */
function fakePage(overrides: Partial<InjectedPage> = {}): InjectedPage {
  const response: InjectedGotoResponse = { status: () => 200 };
  return {
    goto: async () => response,
    content: async () => '<html></html>',
    ariaSnapshot: async () => '- text',
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
