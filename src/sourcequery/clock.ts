/** A monotonic clock returning milliseconds. */
export type Clock = () => number;

/** A sleep that resolves after `ms` milliseconds. */
export type Sleep = (ms: number) => Promise<void>;

/** Real-world clock implementation using Date.now(). */
export const realClock: Clock = () => Date.now();

/** Real-world sleep implementation using setTimeout. */
export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a deterministic fake clock for testing.
 * Sleep calls advance the fake time immediately (no real delays).
 * Useful for testing code that depends on timing without real delays.
 */
export function createFakeClock(
  startMs: number = 0,
): {
  clock: Clock;
  sleep: Sleep;
  advance(ms: number): void;
  now(): number;
} {
  let currentTime = startMs;
  let totalSlept = 0;

  const clock: Clock = () => currentTime;

  const sleep: Sleep = async (ms: number) => {
    totalSlept += ms;
    currentTime += ms;
  };

  const advance = (ms: number): void => {
    currentTime += ms;
  };

  const now = (): number => currentTime;

  return {
    clock,
    sleep,
    advance,
    now,
  };
}
