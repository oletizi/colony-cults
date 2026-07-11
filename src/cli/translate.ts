import path from 'node:path';
import type { ParsedArgs } from '@/cli/parse';
import { requireOption } from '@/cli/fetch';
import { resolveArchiveRoot, resolveFetchedDir } from '@/archive/location';
import { ensureMemberLayoutRegistered } from '@/archive/member-layout';
import {
  commitAndPushIssueCheckpoint,
  buildMonographPageCheckpointHook,
  type CommitCheckpointFn,
} from '@/cli/archive-checkpoint';
import { sourceKind } from '@/bibliography/load';
import { loadEngineConfig, resolveEngine, resolveModel } from '@/engine/config';
import { createEngine } from '@/engine/factory';
import type { TranslationEngine } from '@/engine/types';
import {
  translateIssue,
  type IssueOutcome,
  type TranslateIssueCtx,
} from '@/translate/issue';
import {
  translateSource,
  CONSECUTIVE_FAILURE_ABORT,
  type TranslateSourceCtx,
} from '@/translate/source';

/**
 * Polite pacing delay (milliseconds) between engine-invoking issues in a
 * whole-source run (contracts/cli.md behavior 5). Small enough not to
 * meaningfully slow a run, but present so `translate-source` does not hammer
 * the `claude` CLI back-to-back across many issues.
 */
export const PACE_MS = 250;

/** Injectable side effects for the `translate`/`translate-source` commands (real preflight + disk by default). */
export interface TranslateCliDeps {
  /** Absolute private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** Provenance-timestamp clock (injected for determinism/testability). */
  clock: () => Date;
  /** Line-oriented output sink (stdout in production). */
  log: (message: string) => void;
  /** `claude` CLI preflight (FR-009); fires only before a real translation. */
  preflight: () => Promise<void>;
  /** Injected translation engine adapter. */
  engine: TranslationEngine;
  /** Resolved model id/alias for this run (CLI flag > config > engine default; see `resolveModel`). */
  model: string;
  /**
   * Polite pacing thunk between engine-invoking issues in a whole-source run
   * (`runTranslate`, the single-issue command, does not use this).
   */
  delay: () => Promise<void>;
  /**
   * Git checkpoint adapter (`--checkpoint`), reusing the acquisition pipeline's
   * {@link commitAndPushIssueCheckpoint}. `undefined` (the default when
   * `--checkpoint` is absent) means NO checkpointing, so tests/dry-runs never
   * touch git. When present, a monograph run commits+pushes every
   * `--checkpoint-every N` pages (default 1) plus a final end-of-document flush.
   */
  checkpoint?: CommitCheckpointFn;
}

/**
 * Map a per-issue {@link IssueOutcome} to its `--dry-run` "would-X" report
 * label (contracts/cli.md help text, FR-010). `failed`/`incomplete` only
 * arise from a dry-run's own hard-precondition throw (see
 * `translateSource`'s DRY-RUN note) and are reported under their normal
 * name -- there is no "would-fail" concept.
 */
function dryRunLabel(outcome: IssueOutcome): string {
  switch (outcome) {
    case 'translated':
      return 'would-translate';
    case 'skipped':
      return 'would-skip';
    case 'refused':
      return 'would-refuse';
    default:
      return outcome;
  }
}

/**
 * Build the default (real preflight + disk) `TranslateCliDeps`, resolving
 * the engine + model to use from the `--engine`/`--model` flags and
 * `translate.config.json` (CLI flag beats config beats the built-in
 * default; see `resolveEngine`/`resolveModel`), then constructing that
 * engine's real adapter + preflight via the factory. `runTranslate`/
 * `runTranslateSource` call this when no `deps` is injected (tests inject
 * their own).
 */
export async function buildTranslateCliDeps(
  args: ParsedArgs,
): Promise<TranslateCliDeps> {
  const repoRoot = process.cwd();
  const config = await loadEngineConfig(repoRoot);
  const engineName = resolveEngine(args.options.engine, config);
  const model = resolveModel(args.options.model, engineName, config);
  const { engine, preflight } = createEngine(engineName);
  return {
    archiveRoot: resolveArchiveRoot(repoRoot),
    clock: () => new Date(),
    log: (message) => {
      console.log(message);
    },
    preflight,
    engine,
    model,
    delay: () => new Promise((resolve) => setTimeout(resolve, PACE_MS)),
    // `--checkpoint` (operator's design): commit AND push per cadence + a
    // final flush, reusing the acquisition pipeline's git adapter. Absent ->
    // undefined, so a normal run never touches git. This is the ONLY place the
    // translate bin constructs the git adapter.
    checkpoint: args.flags.checkpoint ? commitAndPushIssueCheckpoint : undefined,
  };
}

/**
 * `translate <issueArk> --source-id <id> [--model <name>]` (T018, contracts/cli.md).
 *
 * Translates one already-fetched, OCR'd issue (cleanup -> translate per page,
 * assemble, store) via {@link translateIssue}. FAILS LOUD (throws) on a
 * `refused` (rights gate) or `failed` outcome so the bin exits non-zero --
 * a rights refusal must never look like success on a single-issue run.
 *
 * `--dry-run` (FR-010/contracts/cli.md behavior 1/2) instead REPORTS the
 * intended work (would-translate/would-skip/would-refuse) plus the issue's
 * rights status, then returns normally (exit 0) -- it never throws on
 * `refused`/`failed`, since dry-run only reports. The `!dryRun` fail-loud
 * behavior below is unchanged from before dry-run existed.
 */
export async function runTranslate(
  args: ParsedArgs,
  deps?: TranslateCliDeps,
): Promise<void> {
  const d = deps ?? (await buildTranslateCliDeps(args));

  const issueArk = args.positional[0];
  if (issueArk === undefined) {
    throw new Error('translate: missing required argument <issueArk>');
  }
  const sourceId = requireOption(args.options.sourceId, 'source-id', 'translate');
  // Register a source-group member's derived archive layout so translateIssue's
  // internal resolveFetchedDir can locate it (no-op for static sources).
  ensureMemberLayoutRegistered(
    sourceId,
    path.join(process.cwd(), 'bibliography', 'sources'),
  );
  const dryRun = args.flags.dryRun;

  // Per-page checkpoint cadence (`--checkpoint` [+ `--checkpoint-every N`]),
  // reusing the acquisition pipeline's monograph page-cadence hook. Never wired
  // on a dry-run (which writes nothing). A fresh hook per invocation (its
  // counters are run-scoped).
  const onPageStored =
    d.checkpoint !== undefined && !dryRun
      ? buildMonographPageCheckpointHook(
          d.archiveRoot,
          args.options.checkpointEvery ?? 1,
          d.checkpoint,
        )
      : undefined;

  const ctx: TranslateIssueCtx = {
    engine: d.engine,
    sourceId,
    archiveRoot: d.archiveRoot,
    clock: d.clock,
    force: args.flags.force,
    model: d.model,
    log: d.log,
    preflight: d.preflight,
    dryRun,
    onPageStored,
  };

  const result = await translateIssue(issueArk, ctx);

  // Final flush (mirrors the fetch pipeline's per-issue `onIssueComplete`):
  // commit+push whatever the last page-cadence checkpoint did not yet cover --
  // the trailing pages AND the assembled whole-document artifacts
  // (issue.fr.txt/issue.en.txt). Idempotent: a clean no-op if nothing new is
  // staged. Skipped when nothing was written (refused rights gate).
  if (
    d.checkpoint !== undefined &&
    !dryRun &&
    result.outcome !== 'refused' &&
    result.pagesDone > 0
  ) {
    const dir = resolveFetchedDir(sourceId, issueArk, d.archiveRoot);
    await d.checkpoint(
      d.archiveRoot,
      {
        sourceId,
        ark: issueArk,
        dir,
        pageCount: result.pagesTotal,
        written: result.pagesDone,
        skipped: 0,
      },
      { push: true },
    );
  }

  if (dryRun) {
    d.log(
      `translate: ${result.ark} -> ${dryRunLabel(result.outcome)} ` +
        `(${result.pagesDone}/${result.pagesTotal} pages)` +
        (result.message !== undefined ? ` -- ${result.message}` : ''),
    );
    d.log('translate: (dry-run) wrote nothing');
    return;
  }

  d.log(
    `translate: ${result.ark} -> ${result.outcome} ` +
      `(${result.pagesDone}/${result.pagesTotal} pages)`,
  );

  if (result.outcome === 'refused') {
    throw new Error(
      `translate: ${result.ark} refused -- ${result.message ?? 'rights gate failed'}`,
    );
  }
  // A single-issue command must NOT report success on a partial result: a
  // `failed` or `incomplete` outcome exits non-zero (the resumable per-page
  // artifacts stay on disk, but the requested translation did not complete).
  if (result.outcome === 'failed' || result.outcome === 'incomplete') {
    throw new Error(
      `translate: ${result.ark} ${result.outcome} -- ${result.message ?? '(no detail)'}`,
    );
  }
}

/**
 * `translate-source <sourceId> [--force] [--model <name>]` (T024, contracts/cli.md
 * behavior 5). Translates every already-fetched issue of a source via
 * {@link translateSource}, printing a per-issue outcome report (FR-015).
 *
 * EXIT BEHAVIOR (contracts/cli.md "Exit codes"):
 *  - A whole-source run that completes -- even one carrying per-issue
 *    `refused`/`failed`/`incomplete` entries -- returns normally (exit 0);
 *    the printed report conveys those outcomes, so per-issue failure alone
 *    is not fail-loud at the source level.
 *  - A run that trips the FR-017 consecutive-failure threshold THROWS, so the
 *    bin exits non-zero -- that condition means the run stopped early and did
 *    not process every issue.
 *
 * `--dry-run` (FR-010/contracts/cli.md behavior 1/2/5) forwards into every
 * per-issue classification (see `translateSource`'s DRY-RUN note: no engine
 * calls, no pacing, and the consecutive-failure abort is suppressed, so
 * `report.abortedOnConsecutiveFailures` is always `false`). The report is
 * printed with would-translate/would-skip/would-refuse labels plus a closing
 * "(dry-run) wrote nothing" note, and the function returns normally (exit 0)
 * without reaching the abort throw below.
 */
export async function runTranslateSource(
  args: ParsedArgs,
  deps?: TranslateCliDeps,
): Promise<void> {
  const d = deps ?? (await buildTranslateCliDeps(args));

  const sourceId = args.positional[0];
  if (sourceId === undefined) {
    throw new Error('translate-source: missing required argument <sourceId>');
  }

  // Guardrail: a Source Group is not an archival object -- it has no fetched
  // issues to translate. Key on the SSOT canonical `kind` BEFORE `translateSource`
  // consults `sourceLayout` (which would otherwise surface an opaque layout
  // error), mirroring `fetch-source`'s guard.
  const sourcesDir = path.join(process.cwd(), 'bibliography', 'sources');
  if (sourceKind(sourceId, sourcesDir) === 'source-group') {
    throw new Error(
      `translate-source: "${sourceId}" is a Source Group — it has no archival object to translate. ` +
        `Translate its concrete member Sources instead.`,
    );
  }

  // Register a member's derived archive layout so discovery/resolution resolve it.
  ensureMemberLayoutRegistered(sourceId, sourcesDir);

  const dryRun = args.flags.dryRun;

  const ctx: TranslateSourceCtx = {
    engine: d.engine,
    archiveRoot: d.archiveRoot,
    clock: d.clock,
    force: args.flags.force,
    model: d.model,
    log: d.log,
    preflight: d.preflight,
    delay: d.delay,
    dryRun,
  };

  const report = await translateSource(sourceId, ctx);

  for (const issue of report.issues) {
    const label = dryRun ? dryRunLabel(issue.outcome) : issue.outcome;
    d.log(
      `translate-source: ${issue.ark} -> ${label} ` +
        `(${issue.pagesDone}/${issue.pagesTotal} pages)` +
        (issue.message !== undefined ? ` -- ${issue.message}` : ''),
    );
  }
  d.log(
    `translate-source: ${sourceId} -- ${report.issues.length} issue(s) attempted, ` +
      `aborted=${report.abortedOnConsecutiveFailures}`,
  );

  if (dryRun) {
    d.log('translate-source: (dry-run) wrote nothing');
    return;
  }

  if (report.abortedOnConsecutiveFailures) {
    throw new Error(
      `translate-source: ${sourceId} aborted after ${CONSECUTIVE_FAILURE_ABORT} ` +
        'consecutive issue failures -- see the per-issue report above',
    );
  }
}
