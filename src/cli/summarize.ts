import path from 'node:path';
import type { ParsedArgs } from '@/cli/parse';
import { resolveArchiveRoot, resolveFetchedDir, sourceLayout } from '@/archive/location';
import { ensureMemberLayoutRegistered } from '@/archive/member-layout';
import { discoverIssueArks, CONSECUTIVE_FAILURE_ABORT } from '@/translate/source';
import { loadSummaryConfig, resolveSummarizerName, resolveSummaryModel } from '@/summarize/config';
import { createSummarizer } from '@/summarize/factory';
import type { SummarizationRunner } from '@/summarize/types';
import { summarizeIssue, type SummarizeIssueCtx } from '@/summarize/issue';
import { summarizeSource, type SummarizeSourceCtx } from '@/summarize/source-rollup';
import { loadSourceFile } from '@/bibliography/load';
import { writeSourceFile } from '@/bibliography/source-writer';
import { validateSummaryRef, writeSummaryRef } from '@/bibliography/summary-reference';

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
 * engine + model from the `--engine`/`--model` flags AND `summarize.config.json`
 * (CLI flag beats config beats the built-in default; see
 * `resolveSummarizerName`/`resolveSummaryModel`, AUDIT-20260722-03), then
 * constructing that engine's real adapter + preflight via `createSummarizer`.
 * `runSummarize` calls this when no `deps` is injected (tests inject their
 * own).
 */
export async function buildSummarizeCliDeps(args: ParsedArgs): Promise<SummarizeCliDeps> {
  const repoRoot = process.cwd();
  const config = await loadSummaryConfig(repoRoot);
  const engineName = resolveSummarizerName(args.options.engine, config);
  const model = resolveSummaryModel(args.options.model, config);
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
  const d = deps ?? (await buildSummarizeCliDeps(args));

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

  // AUDIT-live-01: a MONOGRAPH source (`sourceLayout(sourceId).kind ===
  // 'monograph'`) is a single flat document directory, not a set of dated
  // issue subdirectories -- `discoverIssueArks` enumerates SUBDIRECTORIES
  // (the periodical convention) and always finds none for a monograph, which
  // silently no-ops the whole-source (no-`issueArk`) run (zero artifacts,
  // exit 0). Monographs are in spec 017 v1 scope (FR-016) and a silent no-op
  // violates fail-loud (Constitution V), so treat a monograph as a SINGLE
  // synthetic "issue": `resolveFetchedDir` below ignores the ark entirely for
  // a monograph (it always resolves to the one `monographDir`), so any
  // non-empty placeholder works -- `sourceId` is used for a legible log line.
  // The periodical path (`discoverIssueArks`) is untouched.
  const arks =
    issueArk !== undefined
      ? [issueArk]
      : sourceLayout(sourceId).kind === 'monograph'
        ? [sourceId]
        : discoverIssueArks(sourceId, d.archiveRoot);

  // AUDIT-20260722-04: preflight is NOT fired eagerly here -- it is passed
  // through into `SummarizeIssueCtx.preflight` below and fires lazily, at the
  // generation boundary inside `summarizeIssue`, ONLY when a real (non-dry-run,
  // non-skip) generation is about to happen. This lets an idempotent rerun
  // (or a dry-run) that will skip every issue do so without requiring the
  // underlying engine (e.g. the `claude` CLI) to be installed at all.
  const ctx: SummarizeIssueCtx = {
    runner: d.runner,
    model: d.model,
    archiveRoot: d.archiveRoot,
    clock: d.clock,
    log: d.log,
    force: args.flags.force,
    dryRun,
    preflight: d.preflight,
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

/** Injectable side effects for the `summarize-source` command (real preflight + disk by default). */
export interface SummarizeSourceCliDeps {
  /** Absolute private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** `bibliography/sources` directory holding the source's SSOT record. */
  sourcesDir: string;
  /** Provenance-timestamp clock (injected for determinism/testability). */
  clock: () => Date;
  /** Line-oriented output sink (stdout in production). */
  log: (message: string) => void;
  /** Summarizer engine preflight (e.g. `assertClaudeAvailable`); fires once before any real run. */
  preflight: () => Promise<void>;
  /** Injected summarization engine adapter. */
  runner: SummarizationRunner;
  /** Resolved model id/alias for this run (CLI flag > config > default). */
  model: string;
}

/**
 * Build the default (real preflight + disk) `SummarizeSourceCliDeps`, mirroring
 * `buildSummarizeCliDeps` -- same engine/model resolution (including
 * `summarize.config.json`, AUDIT-20260722-03), plus `sourcesDir` (needed here
 * to load/write the bibliography SSOT record for the Constitution XV
 * `summaryRef` weld).
 */
export async function buildSummarizeSourceCliDeps(
  args: ParsedArgs,
): Promise<SummarizeSourceCliDeps> {
  const repoRoot = process.cwd();
  const config = await loadSummaryConfig(repoRoot);
  const engineName = resolveSummarizerName(args.options.engine, config);
  const model = resolveSummaryModel(args.options.model, config);
  const { runner, preflight } = createSummarizer(engineName);
  return {
    archiveRoot: resolveArchiveRoot(repoRoot),
    sourcesDir: path.join(repoRoot, 'bibliography', 'sources'),
    clock: () => new Date(),
    log: (message) => {
      console.log(message);
    },
    preflight,
    runner,
    model,
  };
}

/**
 * `summarize-source <sourceId>` (T030, contracts/cli-summarize.md, US4 FR-009).
 *
 * Generates the per-source ROLLUP via {@link summarizeSource} (cover-what-exists
 * over the source's existing per-issue thorough summaries), THEN writes the
 * bibliography `summaryRef` pointer (`@/bibliography/summary-reference`) in the
 * SAME operation -- Constitution XV: no dangling reference. Both halves are
 * unconditional and un-caught on the real (non-dry-run) path, so an error in
 * EITHER the rollup generation or the SSOT write propagates and the command
 * exits non-zero rather than leaving one half silently unfinished.
 *
 * `--dry-run` resolves coverage and reports the intended work (forwarded into
 * `SummarizeSourceCtx.dryRun`); zero artifacts and zero SSOT writes happen --
 * neither the rollup nor the `summaryRef` is touched.
 *
 * The `summaryRef` write runs even on an idempotent `'skipped'` rollup (the
 * covered/missing set was unchanged): a prior run could have written the
 * rollup artifact but been interrupted before the SSOT write, so re-asserting
 * the ref here is what keeps the weld actually welded across a resumed run.
 */
export async function runSummarizeSource(
  args: ParsedArgs,
  deps?: SummarizeSourceCliDeps,
): Promise<void> {
  const d = deps ?? (await buildSummarizeSourceCliDeps(args));

  const sourceId = args.positional[0];
  if (sourceId === undefined) {
    throw new Error('summarize-source: missing required argument <sourceId>');
  }
  const dryRun = args.flags.dryRun;

  ensureMemberLayoutRegistered(sourceId, d.sourcesDir);

  // AUDIT-20260722-04: preflight is NOT fired eagerly here -- it is passed
  // through into `SummarizeSourceCtx.preflight` below and fires lazily,
  // inside `summarizeSource`, only right before the one real (non-dry-run,
  // non-skip) engine call, so an idempotent rerun that will skip never
  // requires the engine to be installed.
  const ctx: SummarizeSourceCtx = {
    runner: d.runner,
    model: d.model,
    archiveRoot: d.archiveRoot,
    clock: d.clock,
    log: d.log,
    force: args.flags.force,
    dryRun,
    preflight: d.preflight,
  };

  const result = await summarizeSource(sourceId, ctx);

  if (dryRun) {
    d.log('summarize-source: (dry-run) wrote nothing');
    return;
  }

  d.log(
    `summarize-source: ${sourceId} -> ${result.status} ` +
      `(covered ${result.coveredIssues.length}, missing ${result.missingIssues.length})`,
  );

  // AUDIT-20260722-02: guard `result.thoroughPath` explicitly before using it
  // below, so a regression in `summarizeSource` that leaves it unset on a
  // `'skipped'` (or any non-dry-run) result surfaces as a legible error
  // instead of a raw `TypeError` out of `path.relative`. `summarizeSource`
  // guarantees `thoroughPath` on every non-dry-run status -- this is a
  // defense-in-depth check on that cross-file invariant, not an expected path.
  if (!result.thoroughPath) {
    throw new Error(
      `summarize-source: rollup returned no thoroughPath for ${sourceId}`,
    );
  }

  // Constitution XV weld: the summaryRef is written in the SAME operation as
  // the rollup artifacts above -- never a follow-up/reconcile step.
  const sourceFilePath = path.join(d.sourcesDir, `${sourceId}.yml`);
  const loaded = loadSourceFile(sourceFilePath);
  const ref = path.relative(d.archiveRoot, result.thoroughPath).split(path.sep).join('/');
  const updated = writeSummaryRef(loaded.source, ref);
  writeSourceFile(d.sourcesDir, { source: updated, records: loaded.records });
  // Fail loud immediately if the just-written ref somehow does not resolve
  // (e.g. a path-construction bug) rather than leaving a silently-dangling
  // reference for a later `bib validate` run to discover.
  validateSummaryRef(updated, d.archiveRoot);

  d.log(`summarize-source: ${sourceId} -> summaryRef -> ${ref}`);
}
