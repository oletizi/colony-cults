import { describe, expect, it } from 'vitest';
import { createFakeClock } from '@/sourcequery/clock';
import { PolitenessPolicy } from '@/sourcequery/politeness-policy';

describe('PolitenessPolicy', () => {
  it('throws when minIntervalMs is negative', () => {
    const { clock, sleep } = createFakeClock(0);
    expect(
      () =>
        new PolitenessPolicy({ minIntervalMs: -1, now: clock, sleep }),
    ).toThrow();
  });

  it('spaces two successive navigations by at least minIntervalMs', async () => {
    const { clock, sleep } = createFakeClock(1000);
    const policy = new PolitenessPolicy({
      minIntervalMs: 500,
      now: clock,
      sleep,
    });

    const startTimes: number[] = [];

    await policy.run(async () => {
      startTimes.push(clock());
    });
    await policy.run(async () => {
      startTimes.push(clock());
    });

    expect(startTimes).toHaveLength(2);
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(500);
  });

  it('enforces single-session concurrency: second run does not start until first completes', async () => {
    const { clock, sleep } = createFakeClock(0);
    const policy = new PolitenessPolicy({
      minIntervalMs: 0,
      now: clock,
      sleep,
    });

    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstTask = policy.run(async () => {
      events.push('first-start');
      await firstGate;
      events.push('first-end');
    });

    // Give the first task a chance to start before scheduling the second.
    await Promise.resolve();
    await Promise.resolve();

    const secondTask = policy.run(async () => {
      events.push('second-start');
    });

    // At this point, the second task must not have started yet because the
    // first task is still holding the single session slot.
    expect(events).toEqual(['first-start']);

    if (!releaseFirst) {
      throw new Error('releaseFirst was not assigned by the firstGate executor');
    }
    releaseFirst();
    await firstTask;
    await secondTask;

    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });
});
