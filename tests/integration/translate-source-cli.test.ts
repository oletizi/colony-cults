import { describe, it, expect, afterEach } from 'vitest';
import type { ParsedArgs } from '@/cli/parse';
import type { TranslateCliDeps } from '@/cli/translate';
import { runTranslateSource } from '@/cli/translate';
import type { TranslationEngine } from '@/engine/types';
import { CONSECUTIVE_FAILURE_ABORT } from '@/translate/source';
import {
  buildFetchedSource,
  buildSourceCtx,
  fakeClaude,
  type FetchedSource,
} from './support/translate-archive';

/**
 * CLI-level integration coverage for `runTranslateSource` (T024,
 * contracts/cli.md "Exit codes"): a whole-source run that completes -- even
 * carrying per-issue failures -- resolves normally (exit 0, per the printed
 * report), while a run that trips the FR-017 consecutive-failure threshold
 * REJECTS so the bin exits non-zero.
 *
 * Reuses the same tmp-archive + fake-engine harness as
 * `tests/integration/translate-source.test.ts` /
 * `translate-source-abort.test.ts`; only the driving entry point differs
 * (the CLI wrapper instead of `translateSource` directly), so this test
 * builds a `TranslateCliDeps`-shaped object from `buildSourceCtx`'s ctx
 * fields plus a directly-constructed `ParsedArgs`.
 */
describe('runTranslateSource (T024)', () => {
  let source: FetchedSource;

  afterEach(() => {
    source.cleanup();
  });

  function baseArgs(sourceId: string): ParsedArgs {
    return {
      command: 'translate-source',
      positional: [sourceId],
      flags: { dryRun: false, force: false, verify: false, ocr: false },
      options: {},
    };
  }

  it('resolves and logs a per-issue line for a mixed source (no abort)', async () => {
    source = await buildFetchedSource({ count: 3 });
    const { ctx } = buildSourceCtx(source);

    const logLines: string[] = [];
    const deps: TranslateCliDeps = {
      engine: ctx.engine,
      archiveRoot: ctx.archiveRoot,
      clock: ctx.clock,
      log: (message) => logLines.push(message),
      preflight: ctx.preflight,
      delay: ctx.delay,
    };

    await expect(
      runTranslateSource(baseArgs(source.sourceId), deps),
    ).resolves.toBeUndefined();

    // One per-issue outcome line for every discovered issue.
    for (const ark of source.issueArks) {
      expect(logLines.some((line) => line.includes(ark))).toBe(true);
    }
    expect(logLines.some((line) => line.includes('translated'))).toBe(true);
    // A summary line reporting the attempted count and non-abort.
    expect(
      logLines.some(
        (line) =>
          line.includes(`${source.issueArks.length} issue(s) attempted`) &&
          line.includes('aborted=false'),
      ),
    ).toBe(true);
  });

  it('rejects naming the consecutive-failure abort when every issue fails', async () => {
    source = await buildFetchedSource({ count: 4 });
    const engine: TranslationEngine = {
      name: 'claude-code-cli',
      run: async () => {
        throw new Error('claude boom');
      },
    };
    const { ctx } = buildSourceCtx(source, { engine });

    const logLines: string[] = [];
    const deps: TranslateCliDeps = {
      engine: ctx.engine,
      archiveRoot: ctx.archiveRoot,
      clock: ctx.clock,
      log: (message) => logLines.push(message),
      preflight: ctx.preflight,
      delay: ctx.delay,
    };

    await expect(
      runTranslateSource(baseArgs(source.sourceId), deps),
    ).rejects.toThrow(
      new RegExp(
        `aborted after ${CONSECUTIVE_FAILURE_ABORT} consecutive issue failures`,
      ),
    );

    // Only the first CONSECUTIVE_FAILURE_ABORT issues were attempted/logged.
    expect(logLines.filter((line) => line.includes(' -> failed ')).length).toBe(
      CONSECUTIVE_FAILURE_ABORT,
    );
  });

  it('throws a descriptive error when the sourceId positional is missing', async () => {
    source = await buildFetchedSource({ count: 1 });
    const { ctx } = buildSourceCtx(source);
    const deps: TranslateCliDeps = {
      engine: ctx.engine,
      archiveRoot: ctx.archiveRoot,
      clock: ctx.clock,
      log: () => {},
      preflight: ctx.preflight,
      delay: ctx.delay,
    };
    const args: ParsedArgs = {
      command: 'translate-source',
      positional: [],
      flags: { dryRun: false, force: false, verify: false, ocr: false },
      options: {},
    };

    await expect(runTranslateSource(args, deps)).rejects.toThrow(
      /missing required argument <sourceId>/,
    );
  });
});
