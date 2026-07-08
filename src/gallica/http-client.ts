import { readFileSync } from 'node:fs';
import { RateLimiter } from '@/gallica/rate-limiter';
import type { Clock, Sleep } from '@/gallica/rate-limiter';

/** A `fetch`-compatible function (subset used by this client). */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpClientOptions {
  /** Injected fetch (default: global `fetch`). */
  fetch?: FetchLike;
  /** Injected sleep (default: real timer). */
  sleep?: Sleep;
  /** Injected clock (default: `Date.now`). */
  now?: Clock;
  /** Full User-Agent string (default: derived from package.json version). */
  userAgent?: string;
  /** Total attempts before giving up (default 4). */
  maxAttempts?: number;
  /** First backoff delay in ms; doubles each retry (default 1000). */
  baseDelayMs?: number;
  /** Backoff cap in ms (default 8000). */
  maxDelayMs?: number;
  /** Minimum spacing between request starts in ms (default 1000, ~1 req/s). */
  minRequestIntervalMs?: number;
  /** Maximum concurrent requests (default 2). */
  maxConcurrent?: number;
}

/** Statuses that warrant a backoff-and-retry rather than an immediate throw. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 403 || status >= 500;
}

/**
 * Read this package's version from package.json (no hardcoded duplicate).
 * Fails loud if the file is missing or malformed.
 */
function readPackageVersion(): string {
  const url = new URL('../../package.json', import.meta.url);
  const raw = readFileSync(url, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof parsed.version === 'string' &&
    parsed.version.length > 0
  ) {
    return parsed.version;
  }
  throw new Error(
    `HttpClient: could not read a valid "version" from ${url.pathname}`,
  );
}

function buildUserAgent(version: string): string {
  return `colony-cults-research/${version} (digital humanities; contact oletizi@mac.com)`;
}

/**
 * Thin, polite wrapper over `fetch` that ALL Gallica calls go through.
 *
 * Responsibilities (see specs/001-gallica-fetcher/contracts/gallica-api.md):
 * - descriptive User-Agent on every request;
 * - rate limiting (~1 req/s, <=2 concurrent) via an in-house limiter;
 * - exponential backoff on 429/403/5xx, then a descriptive throw;
 * - immediate throw on non-retryable 4xx (e.g. 404), including status + URL.
 *
 * No inheritance: dependencies are injected via the constructor.
 */
export class HttpClient {
  private readonly fetchFn: FetchLike;
  private readonly sleep: Sleep;
  private readonly userAgent: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly limiter: RateLimiter;

  constructor(options: HttpClientOptions = {}) {
    const globalFetch: FetchLike = (input, init) => fetch(input, init);
    const realSleep: Sleep = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const realNow: Clock = () => Date.now();

    this.fetchFn = options.fetch ?? globalFetch;
    this.sleep = options.sleep ?? realSleep;
    this.userAgent =
      options.userAgent ?? buildUserAgent(readPackageVersion());
    this.maxAttempts = options.maxAttempts ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 8000;

    this.limiter = new RateLimiter({
      maxConcurrent: options.maxConcurrent ?? 2,
      minIntervalMs: options.minRequestIntervalMs ?? 1000,
      sleep: this.sleep,
      now: options.now ?? realNow,
    });
  }

  /** Fetch a resource and return its body as text (for XML endpoints). */
  async getText(url: string): Promise<string> {
    const response = await this.request(url);
    return response.text();
  }

  /** Fetch a resource and return its body as bytes (for image endpoints). */
  async getBytes(url: string): Promise<Uint8Array> {
    const response = await this.request(url);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Perform a GET with politeness + backoff, returning a 2xx Response.
   * Throws (never returns partial/empty) when retries are exhausted or the
   * status is non-retryable.
   */
  private request(url: string): Promise<Response> {
    return this.limiter.schedule(() => this.attemptWithBackoff(url));
  }

  private async attemptWithBackoff(url: string): Promise<Response> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { 'User-Agent': this.userAgent },
      });

      if (response.ok) {
        return response;
      }

      if (!isRetryable(response.status)) {
        throw new Error(
          `HttpClient: non-retryable HTTP ${response.status} for ${url}`,
        );
      }

      if (attempt >= this.maxAttempts) {
        throw new Error(
          `HttpClient: gave up after ${this.maxAttempts} attempts; ` +
            `last status HTTP ${response.status} for ${url}`,
        );
      }

      const delay = Math.min(
        this.baseDelayMs * 2 ** (attempt - 1),
        this.maxDelayMs,
      );
      await this.sleep(delay);
    }

    // Unreachable: the loop either returns or throws on every path.
    throw new Error(`HttpClient: exhausted retries for ${url}`);
  }
}
