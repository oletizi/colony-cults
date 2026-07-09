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
  /** Total attempts before giving up (default 6). */
  maxAttempts?: number;
  /** First backoff delay in ms; doubles each retry (default 2000). */
  baseDelayMs?: number;
  /** Exponential-backoff cap in ms (default 60000). */
  maxDelayMs?: number;
  /** Ceiling honored for a server `Retry-After` header, in ms (default 120000). */
  maxRetryAfterMs?: number;
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
 * Parse an HTTP `Retry-After` header into a delay in ms, honoring both forms:
 * an integer delta-seconds, or an HTTP-date (delta computed against the
 * injected `nowMs`). Returns `null` when absent/unparseable, clamps a past
 * date to 0, and caps the result at `maxMs`.
 */
export function parseRetryAfter(
  value: string | null,
  nowMs: number,
  maxMs: number,
): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, maxMs);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  const delta = dateMs - nowMs;
  if (delta <= 0) {
    return 0;
  }
  return Math.min(delta, maxMs);
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
 * - rate limiting (configurable concurrency + spacing) via an in-house limiter;
 * - on 429/403/5xx: HONOR a `Retry-After` header when present, otherwise
 *   exponential backoff — then a descriptive throw when attempts are exhausted;
 * - immediate throw on non-retryable 4xx (e.g. 404), including status + URL.
 *
 * No inheritance: dependencies are injected via the constructor.
 */
export class HttpClient {
  private readonly fetchFn: FetchLike;
  private readonly sleep: Sleep;
  private readonly now: Clock;
  private readonly userAgent: string;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxRetryAfterMs: number;
  private readonly limiter: RateLimiter;

  constructor(options: HttpClientOptions = {}) {
    const globalFetch: FetchLike = (input, init) => fetch(input, init);
    const realSleep: Sleep = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const realNow: Clock = () => Date.now();

    this.fetchFn = options.fetch ?? globalFetch;
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? realNow;
    this.userAgent =
      options.userAgent ?? buildUserAgent(readPackageVersion());
    this.maxAttempts = options.maxAttempts ?? 6;
    this.baseDelayMs = options.baseDelayMs ?? 2000;
    this.maxDelayMs = options.maxDelayMs ?? 60000;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? 120000;

    this.limiter = new RateLimiter({
      maxConcurrent: options.maxConcurrent ?? 2,
      minIntervalMs: options.minRequestIntervalMs ?? 1000,
      sleep: this.sleep,
      now: this.now,
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
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method: 'GET',
          headers: { 'User-Agent': this.userAgent },
        });
      } catch (cause) {
        // Network-level failure: `fetch` rejected before any HTTP response
        // (e.g. undici's `TypeError: fetch failed` on a connection reset /
        // socket hang-up). There is no status to inspect, so treat it as
        // retryable and back off exponentially, giving up only once attempts
        // are exhausted -- a single connection blip must not abort a long run.
        if (attempt >= this.maxAttempts) {
          throw new Error(
            `HttpClient: gave up after ${this.maxAttempts} attempts; ` +
              `network error for ${url}: ` +
              `${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
        await this.sleep(this.backoffDelay(attempt));
        continue;
      }

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

      await this.sleep(this.retryDelay(response, attempt));
    }

    // Unreachable: the loop either returns or throws on every path.
    throw new Error(`HttpClient: exhausted retries for ${url}`);
  }

  /**
   * Delay before the next attempt: the server's `Retry-After` when present
   * (never waiting less than the server asks), else exponential backoff.
   */
  private retryDelay(response: Response, attempt: number): number {
    const backoff = this.backoffDelay(attempt);
    const retryAfter = parseRetryAfter(
      response.headers.get('retry-after'),
      this.now(),
      this.maxRetryAfterMs,
    );
    return retryAfter === null ? backoff : Math.max(backoff, retryAfter);
  }

  /** Exponential backoff for attempt N (capped), used with or without a response. */
  private backoffDelay(attempt: number): number {
    return Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
  }
}
