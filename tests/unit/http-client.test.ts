import { describe, it, expect } from 'vitest';
import { HttpClient, parseRetryAfter } from '@/gallica/http-client';
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
 * Build a fake fetch over a sequence where an `Error` entry REJECTS (a
 * network-level failure, e.g. undici's `TypeError: fetch failed`) and a
 * `Response` entry resolves. Records every call.
 */
function queuedSeqFetch(seq: Array<Response | Error>): {
  fetch: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fetch: FetchLike = (input, init) => {
    calls.push({ url: String(input), init });
    if (i >= seq.length) {
      throw new Error(`fake fetch: no queued entry for call ${i + 1}`);
    }
    const entry = seq[i];
    i += 1;
    if (entry instanceof Error) {
      return Promise.reject(entry);
    }
    return Promise.resolve(entry);
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
/** A fixed, whole-second injected clock so HTTP-date math round-trips exactly. */
const FIXED_NOW = 1_000_000_000_000;

describe('HttpClient', () => {
  it('returns the body on a 200', async () => {
    const { fetch } = queuedFetch([new Response('hello', { status: 200 })]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    const body = await client.getText(URL_UNDER_TEST);

    expect(body).toBe('hello');
    expect(delays).toEqual([]);
  });

  it('retries 403,403,200 with the deepened exponential backoff', async () => {
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
    // base 2000, doubling: two failures → [2000, 4000]
    expect(delays).toEqual([2000, 4000]);
  });

  it('throws after the deepened max attempts (6) on persistent 403', async () => {
    const { fetch, calls } = queuedFetch(
      Array.from({ length: 6 }, () => new Response('', { status: 403 })),
    );
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/403/);
    expect(calls.length).toBe(6);
    // five sleeps between six attempts, doubling then capped at 60000
    expect(delays).toEqual([2000, 4000, 8000, 16000, 32000]);
  });

  it('honors a numeric Retry-After (never waits less than the server asks)', async () => {
    const { fetch, calls } = queuedFetch([
      new Response('', { status: 429, headers: { 'Retry-After': '30' } }),
      new Response('ok', { status: 200 }),
    ]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    const body = await client.getText(URL_UNDER_TEST);

    expect(body).toBe('ok');
    expect(calls.length).toBe(2);
    // max(exponential 2000, retry-after 30000) = 30000
    expect(delays).toEqual([30000]);
  });

  it('honors an HTTP-date Retry-After using the injected clock', async () => {
    const dateHeader = new Date(FIXED_NOW + 45000).toUTCString();
    const { fetch } = queuedFetch([
      new Response('', { status: 503, headers: { 'Retry-After': dateHeader } }),
      new Response('ok', { status: 200 }),
    ]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep, now: () => FIXED_NOW });

    await client.getText(URL_UNDER_TEST);

    expect(delays).toEqual([45000]);
  });

  it('clamps a Retry-After larger than the ceiling', async () => {
    const { fetch } = queuedFetch([
      new Response('', { status: 429, headers: { 'Retry-After': '300' } }),
      new Response('ok', { status: 200 }),
    ]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    await client.getText(URL_UNDER_TEST);

    // 300s requested, capped at the 120000ms ceiling
    expect(delays).toEqual([120000]);
  });

  it('falls back to exponential backoff when no Retry-After is present', async () => {
    const { fetch } = queuedFetch([
      new Response('', { status: 429 }),
      new Response('ok', { status: 200 }),
    ]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    await client.getText(URL_UNDER_TEST);

    expect(delays).toEqual([2000]);
  });

  it('throws immediately on a non-retryable 404 (no retries)', async () => {
    const { fetch, calls } = queuedFetch([new Response('', { status: 404 })]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(/404/);
    expect(calls.length).toBe(1);
    expect(delays).toEqual([]);
  });

  it('retries a network-level fetch rejection with exponential backoff, then succeeds', async () => {
    // undici throws `TypeError: fetch failed` on a connection reset — no HTTP
    // response, so this must be retried like a retryable status, not aborted.
    const { fetch, calls } = queuedSeqFetch([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new Response('recovered', { status: 200 }),
    ]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    const body = await client.getText(URL_UNDER_TEST);

    expect(body).toBe('recovered');
    expect(calls.length).toBe(3);
    expect(delays).toEqual([2000, 4000]);
  });

  it('gives up after max attempts on a persistent network failure (descriptive throw)', async () => {
    const { fetch, calls } = queuedSeqFetch(
      Array.from({ length: 6 }, () => new TypeError('fetch failed')),
    );
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    await expect(client.getText(URL_UNDER_TEST)).rejects.toThrow(
      /network error.*fetch failed/,
    );
    expect(calls.length).toBe(6);
    expect(delays).toEqual([2000, 4000, 8000, 16000, 32000]);
  });

  it('retries a mix of a network rejection then a retryable status', async () => {
    const { fetch, calls } = queuedSeqFetch([
      new TypeError('fetch failed'),
      new Response('', { status: 503 }),
      new Response('ok', { status: 200 }),
    ]);
    const { sleep, delays } = recordingSleep();
    const client = new HttpClient({ fetch, sleep });

    const body = await client.getText(URL_UNDER_TEST);

    expect(body).toBe('ok');
    expect(calls.length).toBe(3);
    expect(delays).toEqual([2000, 4000]);
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

describe('parseRetryAfter', () => {
  it('returns null for absent/blank/unparseable values', () => {
    expect(parseRetryAfter(null, FIXED_NOW, 120000)).toBeNull();
    expect(parseRetryAfter('', FIXED_NOW, 120000)).toBeNull();
    expect(parseRetryAfter('soon', FIXED_NOW, 120000)).toBeNull();
  });

  it('parses delta-seconds and caps at the ceiling', () => {
    expect(parseRetryAfter('30', FIXED_NOW, 120000)).toBe(30000);
    expect(parseRetryAfter('300', FIXED_NOW, 120000)).toBe(120000);
  });

  it('parses an HTTP-date against now and clamps a past date to 0', () => {
    const future = new Date(FIXED_NOW + 45000).toUTCString();
    const past = new Date(FIXED_NOW - 10000).toUTCString();
    expect(parseRetryAfter(future, FIXED_NOW, 120000)).toBe(45000);
    expect(parseRetryAfter(past, FIXED_NOW, 120000)).toBe(0);
  });
});
