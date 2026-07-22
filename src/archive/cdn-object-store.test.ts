import { describe, it, expect, afterEach, vi } from 'vitest';

import { createCdnObjectStore } from '@/archive/cdn-object-store';

/**
 * Unit coverage for `createCdnObjectStore` (spec 017: read Papers Past OCR
 * assets via the public CDN, never the B2 bucket directly). `fetch` is
 * stubbed on `globalThis` for every test and restored in `afterEach` so no
 * test leaks a stub into another file's suite.
 */

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

/** Installs a fake `fetch` returning `response` for every call, recording the requested URLs. */
function stubFetch(response: Response): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    return response;
  }) as unknown as typeof fetch;
  return { calls };
}

/** Installs a fake `fetch` that rejects (simulating a network error). */
function stubFetchRejecting(error: Error): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    throw error;
  }) as unknown as typeof fetch;
  return { calls };
}

describe('createCdnObjectStore', () => {
  it('get() requests ${base}/${key} and returns the exact response bytes', async () => {
    // Deliberately non-UTF-8 bytes (a lone continuation byte, 0xff, and a
    // null) -- proves get() returns raw bytes, never a decode/re-encode
    // round trip that would corrupt a caller's sha256 check.
    const rawBytes = new Uint8Array([0x80, 0xff, 0x00, 0x41, 0x42, 0xfe]);
    const response = new Response(rawBytes, { status: 200 });
    const { calls } = stubFetch(response);

    const store = createCdnObjectStore('https://colony-cults-cdn.oletizi.workers.dev');
    const result = await store.get('archive/cases/port-breton/some/ocr-text.txt');

    expect(calls).toEqual([
      'https://colony-cults-cdn.oletizi.workers.dev/archive/cases/port-breton/some/ocr-text.txt',
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual(Array.from(rawBytes));
  });

  it('get() strips a trailing slash on the base before joining the key', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    const { calls } = stubFetch(response);

    const store = createCdnObjectStore('https://colony-cults-cdn.oletizi.workers.dev/');
    await store.get('some/key.txt');

    expect(calls).toEqual(['https://colony-cults-cdn.oletizi.workers.dev/some/key.txt']);
  });

  it('get() throws a descriptive error naming the URL and status on a non-200 response', async () => {
    const response = new Response('not found', { status: 404 });
    stubFetch(response);

    const store = createCdnObjectStore('https://colony-cults-cdn.oletizi.workers.dev');

    await expect(store.get('missing/key.txt')).rejects.toThrow(
      /https:\/\/colony-cults-cdn\.oletizi\.workers\.dev\/missing\/key\.txt.*404/,
    );
  });

  it('get() throws a descriptive error naming the URL on a network failure', async () => {
    stubFetchRejecting(new Error('ECONNRESET'));

    const store = createCdnObjectStore('https://colony-cults-cdn.oletizi.workers.dev');

    await expect(store.get('some/key.txt')).rejects.toThrow(
      /https:\/\/colony-cults-cdn\.oletizi\.workers\.dev\/some\/key\.txt/,
    );
    await expect(store.get('some/key.txt')).rejects.toThrow(/ECONNRESET/);
  });

  it('head() throws "not supported" -- the CDN store is read-only', async () => {
    const store = createCdnObjectStore('https://colony-cults-cdn.oletizi.workers.dev');
    await expect(store.head('some/key.txt')).rejects.toThrow(
      /createCdnObjectStore: head not supported.*READ-ONLY/,
    );
  });

  it('put() throws "not supported" -- the CDN store is read-only', async () => {
    const store = createCdnObjectStore('https://colony-cults-cdn.oletizi.workers.dev');
    await expect(
      store.put('some/key.txt', new Uint8Array([1]), { sha256: 'deadbeef' }),
    ).rejects.toThrow(/createCdnObjectStore: put not supported.*READ-ONLY/);
  });

  it('attachSha256Metadata() throws "not supported" -- the CDN store is read-only', async () => {
    const store = createCdnObjectStore('https://colony-cults-cdn.oletizi.workers.dev');
    await expect(store.attachSha256Metadata('some/key.txt', 'deadbeef')).rejects.toThrow(
      /createCdnObjectStore: attachSha256Metadata not supported.*READ-ONLY/,
    );
  });
});
