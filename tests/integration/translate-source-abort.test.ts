import { describe, it, expect, afterEach } from 'vitest';
import type { TranslationEngine } from '@/engine/types';
import { translateSource, CONSECUTIVE_FAILURE_ABORT } from '@/translate/source';
import {
  buildFetchedSource,
  buildSourceCtx,
  fakeClaude,
  type EngineCall,
  type FetchedSource,
} from './support/translate-archive';

/**
 * Integration coverage for the consecutive-failure abort (T023/T026, FR-017):
 * a whole-source run stops after N=3 issues fail in a row, and a success
 * between failures resets the streak. Drives `translateSource` against a temp
 * archive with fake engines forced to fail per issue.
 */
describe('translateSource -- consecutive-failure abort (T026)', () => {
  let source: FetchedSource;

  afterEach(() => {
    source.cleanup();
  });

  it('aborts after exactly 3 consecutive failures and never attempts the 4th issue', async () => {
    source = await buildFetchedSource({ count: 5 });

    // Every engine call throws. fakeClaude's failWith path does NOT record, so
    // we count invocations directly here to prove the engine was hit exactly
    // once per attempted issue and never for the 4th/5th.
    let engineCalls = 0;
    const engine: TranslationEngine = {
      name: 'claude-code-cli',
      run: async () => {
        engineCalls += 1;
        throw new Error('claude boom');
      },
    };
    const { ctx, delayCalls } = buildSourceCtx(source, { engine });

    const report = await translateSource(source.sourceId, ctx);

    expect(report.abortedOnConsecutiveFailures).toBe(true);
    // EXACTLY three issues attempted -- the run stopped at the threshold.
    expect(report.issues.length).toBe(CONSECUTIVE_FAILURE_ABORT);
    expect(report.issues.length).toBe(3);
    expect(report.issues.every((r) => r.outcome === 'failed')).toBe(true);
    // The attempted issues are the first three arks, in discovery order.
    expect(report.issues.map((r) => r.ark)).toEqual(
      source.issueArks.slice(0, 3),
    );

    // One engine hit per attempted issue (page-1 cleanup throws first) -> 3.
    // The 4th and 5th issues were never processed, so the engine saw NO more.
    expect(engineCalls).toBe(3);

    // Only the first two (engine-running) issues paced; the third aborts before
    // its delay would fire.
    expect(delayCalls.n).toBe(2);
  });

  it('a success between failures resets the streak, so 2 fail + 1 success + 2 fail does NOT abort', async () => {
    source = await buildFetchedSource({ count: 5 });

    // Fail every issue EXCEPT the middle one, keyed on the per-issue ARK marker
    // baked into each issue's text. Order: fail, fail, SUCCESS, fail, fail.
    const successArk = source.issueArks[2];
    const failArks = source.issueArks.filter((a) => a !== successArk);
    const calls: EngineCall[] = [];
    const engine = fakeClaude(calls, {
      failWith: new Error('boom'),
      failWhen: (sourceText) => failArks.some((a) => sourceText.includes(a)),
    });
    const { ctx, delayCalls } = buildSourceCtx(source, { engine });

    const report = await translateSource(source.sourceId, ctx);

    // The mid-run success resets the counter, so neither pair of failures
    // reaches the threshold -> the run completes over all five issues.
    expect(report.abortedOnConsecutiveFailures).toBe(false);
    expect(report.issues.length).toBe(5);
    expect(report.issues.map((r) => r.outcome)).toEqual([
      'failed',
      'failed',
      'translated',
      'failed',
      'failed',
    ]);

    // Only the success issue reached the engine: 3 pages x 2 passes = 6 calls.
    expect(calls.length).toBe(6);
    // Delay after every engine-running issue except the final one -> 4.
    expect(delayCalls.n).toBe(4);
  });
});
