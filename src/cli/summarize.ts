import path from 'node:path';
import type { ParsedArgs } from '@/cli/parse';
import { resolveArchiveRoot, resolveFetchedDir } from '@/archive/location';
import { ensureMemberLayoutRegistered } from '@/archive/member-layout';
import { discoverIssueArks, CONSECUTIVE_FAILURE_ABORT } from '@/translate/source';
import { resolveSummarizerName, resolveSummaryModel } from '@/summarize/config';
import { createSummarizer } from '@/summarize/factory';
import type { SummarizationRunner } from '@/summarize/types';
import { summarizeIssue, type SummarizeIssueCtx } from '@/summarize/issue';

/**
 * Polite pacing delay (milliseconds) between engine-invoking issues in a
 * whole-source run, mirroring `translate`'s `PACE_MS`
 * (`src/cli/translate.ts`) -- small enough not to meaningfully slow a run,
 * but present so a whole-source `bib summarize <sourceId>` does not hammer
 * the `claude` CLI back-to-back across many issues.
 */
export const PACE_MS = 250;

/** Injectable side effects for the `summarize` command (real preflight + disk by default). */
export interface SummarizeCliDeps {
  /** Absolute private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** Provenance-timestamp clock (injected for determinism/testability). */
  clock: () => Date;
  /** Line-oriented output sink (stdout in production). */
  log: (message: string) => void;
  /** Summarizer engine preflight (e.g. `assertClaudeAvailable`); fires once before any real run. */
  preflight: () => Promise<void>;
  /** Injected summarization engine adapter. */
  runner: SummarizationRunner;
  /** Resolved model id/alias for this run (CLI flag > config > default; see `resolveSummaryModel`). */
  model: string;
  /** Polite pacing thunk between engine-invoking issues in a whole-source run. */
  delay: () => Promise<void>;
}

/**
 * Build the default (real preflight + disk) `SummarizeCliDeps`, resolving the
 * engine + model from the `--engine`/`--model` flags (CLI flag beats the
 * built-in default; see `resolveSummarizerName`/`resolveSummaryModel` --
 * there is no `summarize.config.json` loader yet, so no config layer is
 * consulted here), then constructing that engine's real adapter + preflight
 * via `createSummarizer`. `runSummarize` calls this when no `deps` is
 * injected (tests inject their own).
 */
export function buildSummarizeCliDeps(args: ParsedArgs): SummarizeCliDeps {
  const repoRoot = process.cwd();
  const engineName = resolveSummarizerName(args.options.engine);
  const model = resolveSummaryModel(args.options.model);
  const { runner, preflight } = createSummarizer(engineName);
  return {
    archiveRoot: resolveArchiveRoot(repoRoot),
    clock: () => new Date(),
    log: (message) => {
      console.log(message);
    },
    preflight,
    runner,
    model,
    delay: () => new Promise((resolve) => setTimeout(resolve, PACE_MS)),
  };
}

/**
 * `summarize <sourceId> [issueArk]` (T019, contracts/cli-summarize.md).
 *
 * Generates the per-issue two-depth summary via {@link summarizeIssue}, for
 * one issue (when `issueArk` is given) or every already-fetched issue of the
 * source (when it is omitted, discovered offline via `discoverIssueArks`,
 * mirroring `translate-source`'s whole-source iteration).
 *
 * EXIT BEHAVIOR:
 *  - A single explicit `issueArk` run FAILS LOUD: a thrown error (no usable
 *    text -- FR-003; a malformed model output; etc.) propagates so the bin
 *    exits non-zero, per the contract's "no usable text (single issue) ->
 *    non-zero exit" rule.
 *  - A whole-source run (no `issueArk`) does NOT fail loud per issue -- it
 *    records the failure and continues, mirroring `translate-source`'s
 *    FR-017 consecutive-failure rule: after {@link CONSECUTIVE_FAILURE_ABORT}
 *    consecutive issue failures, the run stops and throws so the bin exits
 *    non-zero (the run stopped early and did not process every issue).
 *
 * `--dry-run` resolves inputs and reports the intended work (forwarded into
 * `SummarizeIssueCtx.dryRun`); zero artifacts are written and neither the
 * preflight nor the engine ever runs.
 */
export async function runSummarize(
  args: ParsedArgs,
  deps?: SummarizeCliDeps,
): Promise<void> {
  const d = deps ?? buildSummarizeCliDeps(args);

  const sourceId = args.positional[0];
  if (sourceId === undefined) {
    throw new Error('summarize: missing required argument <sourceId>');
  }
  const issueArk = args.positional[1];
  const dryRun = args.flags.dryRun;

  ensureMemberLayoutRegistered(
    sourceId,
    path.join(process.cwd(), 'bibliography', 'sources'),
  );

  const arks = issueArk !== undefined ? [issueArk] : discoverIssueArks(sourceId, d.archiveRoot);

  // Preflight fires once, before any real generation -- never on a dry-run
  // (which never calls the engine).
  if (!dryRun) {
    await d.preflight();
  }

  const ctx: SummarizeIssueCtx = {
    runner: d.runner,
    model: d.model,
    archiveRoot: d.archiveRoot,
    clock: d.clock,
    log: d.log,
    force: args.flags.force,
    dryRun,
  };

  let consecutiveFailures = 0;

  for (let i = 0; i < arks.length; i += 1) {
    const ark = arks[i];
    const dir = resolveFetchedDir(sourceId, ark, d.archiveRoot);

    try {
      const result = await summarizeIssue(dir, ctx);
      d.log(`summarize: ${ark} -> ${result.status}`);
      consecutiveFailures = 0;

      if (!dryRun && result.status === 'generated' && i < arks.length - 1) {
        await d.delay();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      d.log(`summarize: ${ark} -> failed -- ${message}`);

      // A single explicit-issueArk run fails loud immediately: there is no
      // per-issue report to fall back on, so exit non-zero on this issue.
      if (issueArk !== undefined) {
        throw error;
      }

      consecutiveFailures += 1;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_ABORT) {
        throw new Error(
          `summarize: ${sourceId} aborted after ${CONSECUTIVE_FAILURE_ABORT} ` +
            `consecutive issue failures (last: ${ark}) -- ${message}`,
        );
      }
    }
  }

  if (dryRun) {
    d.log('summarize: (dry-run) wrote nothing');
  }
}
