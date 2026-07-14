import { describe, it, expect, afterEach } from 'vitest';
import type { ParsedArgs } from '@/cli/parse';
import type { TranslateCliDeps } from '@/cli/translate';
import {
  buildTranslateCliDeps,
  runTranslate,
  runTranslateSource,
} from '@/cli/translate';
import type { TranslationEngine } from '@/engine/types';
import { CONSECUTIVE_FAILURE_ABORT } from '@/translate/source';
import {
  buildFetchedIssue,
  buildFetchedSource,
  buildSourceCtx,
  fakeClaude,
  FIXED_DATE,
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
      flags: { dryRun: false, force: false, verify: false, ocr: false, objectStore: false, reconcileRemote: false, checkpoint: false },
      options: {},
    };
  }

  it('resolves and logs a per-issue line for a mixed source (no abort)', async () => {
    source = await buildFetchedSource({ count: 3 });
    const { ctx } = buildSourceCtx(source);

    const logLines: string[] = [];
    const deps: TranslateCliDeps = {
      engine: ctx.engine,
      model: 'claude-opus-4-8',
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
      model: 'claude-opus-4-8',
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
      model: 'claude-opus-4-8',
      archiveRoot: ctx.archiveRoot,
      clock: ctx.clock,
      log: () => {},
      preflight: ctx.preflight,
      delay: ctx.delay,
    };
    const args: ParsedArgs = {
      command: 'translate-source',
      positional: [],
      flags: { dryRun: false, force: false, verify: false, ocr: false, objectStore: false, reconcileRemote: false, checkpoint: false },
      options: {},
    };

    await expect(runTranslateSource(args, deps)).rejects.toThrow(
      /missing required argument <sourceId>/,
    );
  });
});

describe('buildTranslateCliDeps (Task 7)', () => {
  it('resolves the codex engine from --engine without making a real codex call', async () => {
    const args: ParsedArgs = {
      command: 'translate',
      positional: ['ark'],
      flags: { dryRun: false, force: false, verify: false, ocr: false, objectStore: false, reconcileRemote: false, checkpoint: false },
      options: { engine: 'codex' },
    };

    // buildTranslateCliDeps resolves the archive root fail-loud (TASK-19): it
    // requires an explicit COLONY_ARCHIVE_ROOT (or --archive-root) and no longer
    // defaults to a shared sibling clone. Set + restore it around the call.
    const prevArchiveRoot = process.env.COLONY_ARCHIVE_ROOT;
    process.env.COLONY_ARCHIVE_ROOT = '/tmp/translate-cli-test-archive';
    try {
      const deps = await buildTranslateCliDeps(args);
      expect(deps.engine.name).toBe('codex-cli');
    } finally {
      if (prevArchiveRoot === undefined) {
        delete process.env.COLONY_ARCHIVE_ROOT;
      } else {
        process.env.COLONY_ARCHIVE_ROOT = prevArchiveRoot;
      }
    }
  });
});

describe('CLI review fixes', () => {
  const allFlags = {
    dryRun: false,
    force: false,
    verify: false,
    ocr: false,
    objectStore: false,
    reconcileRemote: false,
    checkpoint: false,
  };

  it('runTranslateSource refuses a Source Group with an actionable redirect', async () => {
    // PB-P004 is a registered Source Group in the bibliography SSOT; it has no
    // archival object to translate. The guard fires before any archive access.
    const deps: TranslateCliDeps = {
      engine: { name: 'fake', run: async () => '' },
      model: 'gpt-5.5',
      archiveRoot: '/tmp/unused-by-the-group-guard',
      clock: () => new Date(FIXED_DATE),
      log: () => undefined,
      preflight: async () => undefined,
      delay: async () => undefined,
    };
    const args: ParsedArgs = {
      command: 'translate-source',
      positional: ['PB-P004'],
      flags: allFlags,
      options: {},
    };

    await expect(runTranslateSource(args, deps)).rejects.toThrow(
      /Source Group/i,
    );
  });

  it('runTranslate exits non-zero (throws) on an incomplete single issue', async () => {
    const fetched = await buildFetchedIssue();
    try {
      // Echo the source (non-degenerate) for pages 1's two passes, then fail
      // page 2's cleanup -> translateIssue returns `incomplete` (1/3 pages).
      let n = 0;
      const engine: TranslationEngine = {
        name: 'fake',
        run: async (_prompt, sourceText) => {
          n += 1;
          if (n >= 3) {
            throw new Error('engine boom on page 2');
          }
          return sourceText;
        },
      };
      const deps: TranslateCliDeps = {
        engine,
        model: 'test-model',
        archiveRoot: fetched.archiveRoot,
        clock: () => new Date(FIXED_DATE),
        log: () => undefined,
        preflight: async () => undefined,
        delay: async () => undefined,
      };
      const args: ParsedArgs = {
        command: 'translate',
        positional: [fetched.issueArk],
        flags: allFlags,
        options: { sourceId: fetched.sourceId },
      };

      await expect(runTranslate(args, deps)).rejects.toThrow(/incomplete/i);
    } finally {
      fetched.cleanup();
    }
  });
});
