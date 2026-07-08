/** A monotonic clock returning milliseconds. */
export type Clock = () => number;

/** A sleep that resolves after `ms` milliseconds. */
export type Sleep = (ms: number) => Promise<void>;

export interface RateLimiterOptions {
  /** Maximum requests in flight at once. */
  maxConcurrent: number;
  /** Minimum spacing between the START of successive requests, in ms. */
  minIntervalMs: number;
  /** Injected sleep (default: real timer). */
  sleep: Sleep;
  /** Injected clock (default: `Date.now`). */
  now: Clock;
}

/**
 * In-house politeness limiter: bounds concurrency AND spaces successive
 * request starts by a minimum interval. No external dependency.
 *
 * A scheduled task holds one concurrency slot for its entire lifetime
 * (including any internal retries), so backoff spacing and interval spacing
 * remain independent and testable.
 */
export class RateLimiter {
  private readonly maxConcurrent: number;
  private readonly minIntervalMs: number;
  private readonly sleep: Sleep;
  private readonly now: Clock;

  private active = 0;
  private lastStart = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: RateLimiterOptions) {
    if (options.maxConcurrent < 1) {
      throw new Error(
        `RateLimiter: maxConcurrent must be >= 1, got ${options.maxConcurrent}`,
      );
    }
    if (options.minIntervalMs < 0) {
      throw new Error(
        `RateLimiter: minIntervalMs must be >= 0, got ${options.minIntervalMs}`,
      );
    }
    this.maxConcurrent = options.maxConcurrent;
    this.minIntervalMs = options.minIntervalMs;
    this.sleep = options.sleep;
    this.now = options.now;
  }

  /**
   * Run `task` under the concurrency + interval constraints. The returned
   * promise settles with the task's result (or rejection) and the slot is
   * always released.
   */
  async schedule<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.active += 1;

    const wait = this.lastStart + this.minIntervalMs - this.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    this.lastStart = this.now();
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}
