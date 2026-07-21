import { RateLimiter } from '@/gallica/rate-limiter';
import type { Clock, Sleep } from '@/sourcequery/clock';

export interface PolitenessPolicyOptions {
  /** Minimum spacing between the start of successive navigations, in ms. */
  minIntervalMs: number;
  /** Injected clock. */
  now: Clock;
  /** Injected sleep. */
  sleep: Sleep;
}

/**
 * Single-session politeness policy for browser navigations.
 *
 * Models exactly one browser session: navigations run one at a time
 * (`maxConcurrent: 1`) and successive navigation starts are spaced by at
 * least `minIntervalMs`. Reuses the existing `RateLimiter` rather than
 * reimplementing concurrency/interval bookkeeping.
 */
export class PolitenessPolicy {
  private readonly rateLimiter: RateLimiter;

  constructor(options: PolitenessPolicyOptions) {
    if (options.minIntervalMs < 0) {
      throw new Error(
        `PolitenessPolicy: minIntervalMs must be >= 0, got ${options.minIntervalMs}`,
      );
    }
    this.rateLimiter = new RateLimiter({
      maxConcurrent: 1,
      minIntervalMs: options.minIntervalMs,
      sleep: options.sleep,
      now: options.now,
    });
  }

  /** Run `task` as a single-session, min-interval-paced navigation. */
  run<T>(task: () => Promise<T>): Promise<T> {
    return this.rateLimiter.schedule(task);
  }
}
