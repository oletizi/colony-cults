import { describe, it, expect } from 'vitest';
import { HttpClient } from '@/gallica/http-client';
import type { FetchLike } from '@/gallica/http-client';

/**
 * Build a fake fetch that returns the queued responses in order.
 * Records every (url, init) it is called with.
 */
function queuedFetch(responses: Response[]): {
  fetch: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fetch: FetchLike = (input, init) => {
    calls.push({ url: String(input), init });
    if (i >= responses.length) {
      throw new Error(`fake fetch: no queued response for call ${i + 1}`);
    }
    const response = responses[i];
    i += 1;
    return Promise.resolve(response);
  };
  return { fetch, calls };
}

/**
 * Fake sleep: resolves immediately, records the requested delay.
 */
function recordingSleep(): {
  sleep: (ms: number) => Promise<void>;
  delays: number[];
} {
  const delays: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { sleep, delays };
}

const URL_UNDER_TEST = 'https://gallica.bnf.fr/services/Issues?ark=cb328261098/date';

describe('HttpClient', () => {
  it('returns the body on a 200', async () => {
    const { fetch } = queuedFetch([new Response('hello', { status: 200 })]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    const body = await client.getText(URL_UNDER_TEST);

    expect(body).toBe('hello');
    expect(delays).toEqual([]);
  });

  it('retries 403,403,200 and returns the body with increasing backoff delays', async () => {
    const { fetch, calls } = queuedFetch([
      new Response('', { status: 403 }),
      new Response('', { status: 403 }),
      new Response('recovered', { status: 200 }),
    ]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    const body = await client.getText(URL_UNDER_TEST);

    expect(body).toBe('recovered');
    expect(calls.length).toBe(3);
    // two failures → two backoff sleeps, strictly increasing
    expect(delays).toEqual([1000, 2000]);
  });

  it('throws after the max attempts on persistent 403', async () => {
    const { fetch, calls } = queuedFetch([
      new Response('', { status: 403 }),
      new Response('', { status: 403 }),
      new Response('', { status: 403 }),
      new Response('', { status: 403 }),
    ]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/403/);
    expect(calls.length).toBe(4);
    // three sleeps between four attempts, increasing then capped
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('throws immediately on a non-retryable 404 (no retries)', async () => {
    const { fetch, calls } = queuedFetch([new Response('', { status: 404 })]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/404/);
    expect(calls.length).toBe(1);
    expect(delays).toEqual([]);
  });

  it('sets a descriptive User-Agent header', async () => {
    const { fetch, calls } = queuedFetch([new Response('ok', { status: 200 })]);
    const { sleep } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    await client.getText(URL_UNDER_TEST);

    const headers = new Headers(calls[0].init?.headers);
    const userAgent = headers.get('User-Agent');
    expect(userAgent).toMatch(/^colony-cults-research\//);
    expect(userAgent).toContain('contact oletizi@mac.com');
  });

  it('returns bytes for image fetches', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { fetch } = queuedFetch([new Response(bytes, { status: 200 })]);
    const { sleep } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    const out = await client.getBytes('https://gallica.bnf.fr/iiif/x/f1/full/full/0/native.jpg');

    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });
});
