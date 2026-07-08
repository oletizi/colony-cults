import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { translateIssue } from '@/translate/issue';
import { translateSource } from '@/translate/source';
import {
  buildFetchedSource,
  buildCtx,
  buildSourceCtx,
  type FetchedSource,
} from './support/translate-archive';

/**
 * Integration coverage for the WHOLE-SOURCE iterator (T023/T025): a mixed
 * source where one issue is already translated on disk. Drives `translateSource`
 * against a temp archive for the registered source `PB-P001` with a fake
 * `ClaudeCli`, asserting per-issue outcomes, that the already-translated issue
 * is skipped with zero engine work, and that polite pacing (`delay`) fires
 * after engine-running issues but not after the skip or the final issue.
 */
describe('translateSource -- mixed source (T025)', () => {
  let source: FetchedSource;

  beforeEach(async () => {
    source = await buildFetchedSource({ count: 3 });
  });

  afterEach(() => {
    source.cleanup();
  });

  it('translates untranslated issues, skips the already-translated one, paces, reports per issue', async () => {
    // Pre-populate the MIDDLE issue as already fully translated on disk, using
    // its own ctx/engine (its calls do NOT count toward the source run below).
    const skippedArk = source.issueArks[1];
    const { ctx: preCtx, calls: preCalls } = buildCtx(source);
    const pre = await translateIssue(skippedArk, preCtx);
    expect(pre.outcome).toBe('translated');
    expect(preCalls.length).toBe(6); // 3 pages x 2 passes

    // Run the whole source with fresh spies.
    const { ctx, calls, preflightCalls, delayCalls } = buildSourceCtx(source);
    const report = await translateSource(source.sourceId, ctx);

    // One entry per issue, in discovery (date) order, aligned with issueArks.
    expect(report.issues.map((r) => r.ark)).toEqual(source.issueArks);
    expect(report.issues.map((r) => r.outcome)).toEqual([
      'translated',
      'skipped',
      'translated',
    ]);
    expect(report.abortedOnConsecutiveFailures).toBe(false);

    // The skipped issue drove NO engine work: only the two translated issues
    // ran (each 3 pages x 2 passes = 6), never the middle one -> 12, not 18.
    expect(calls.length).toBe(12);
    // Preflight fired once per engine-running issue (never for the skip).
    expect(preflightCalls.n).toBe(2);

    // Pacing: delay after the first (engine) issue only. The middle skip fires
    // no delay (proving pacing keys on engine work, not on iteration), and the
    // final issue never paces -> exactly one delay.
    expect(delayCalls.n).toBe(1);

    // Every entry -- including the skip -- reports the full page tally.
    for (const r of report.issues) {
      expect(r.pagesTotal).toBe(3);
      expect(r.pagesDone).toBe(3);
    }
  });
});
