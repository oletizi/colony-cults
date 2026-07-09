import type { ParsedArgs } from '@/cli/parse';
import { requireOption } from '@/cli/fetch';
import { resolveArchiveRoot } from '@/archive/location';
import { assertClaudeAvailable } from '@/claude/preflight';
import { createClaudeCli } from '@/claude/client';
import { defaultClaudeCommandRunner } from '@/claude/exec';
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
  /**
   * Polite pacing thunk between engine-invoking issues in a whole-source run
   * (`runTranslate`, the single-issue command, does not use this).
   */
  delay: () => Promise<void>;
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

/** Build the default (real preflight + disk) dependencies. */
export function defaultTranslateCliDeps(): TranslateCliDeps {
  const repoRoot = process.cwd();
  return {
    archiveRoot: resolveArchiveRoot(repoRoot),
    clock: () => new Date(),
    log: (message) => {
      console.log(message);
    },
    preflight: () => assertClaudeAvailable(),
    engine: createClaudeCli(defaultClaudeCommandRunner()),
    delay: () => new Promise((resolve) => setTimeout(resolve, PACE_MS)),
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
  deps: TranslateCliDeps = defaultTranslateCliDeps(),
): Promise<void> {
  const issueArk = args.positional[0];
  if (issueArk === undefined) {
    throw new Error('translate: missing required argument <issueArk>');
  }
  const sourceId = requireOption(args.options.sourceId, 'source-id', 'translate');
  const dryRun = args.flags.dryRun;

  const ctx: TranslateIssueCtx = {
    engine: deps.engine,
    sourceId,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: args.flags.force,
    model: args.options.model,
    log: deps.log,
    preflight: deps.preflight,
    dryRun,
  };

  const result = await translateIssue(issueArk, ctx);

  if (dryRun) {
    deps.log(
      `translate: ${result.ark} -> ${dryRunLabel(result.outcome)} ` +
        `(${result.pagesDone}/${result.pagesTotal} pages)` +
        (result.message !== undefined ? ` -- ${result.message}` : ''),
    );
    deps.log('translate: (dry-run) wrote nothing');
    return;
  }

  deps.log(
    `translate: ${result.ark} -> ${result.outcome} ` +
      `(${result.pagesDone}/${result.pagesTotal} pages)`,
  );

  if (result.outcome === 'refused') {
    throw new Error(
      `translate: ${result.ark} refused -- ${result.message ?? 'rights gate failed'}`,
    );
  }
  if (result.outcome === 'failed') {
    throw new Error(
      `translate: ${result.ark} failed -- ${result.message ?? '(no detail)'}`,
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
  deps: TranslateCliDeps = defaultTranslateCliDeps(),
): Promise<void> {
  const sourceId = args.positional[0];
  if (sourceId === undefined) {
    throw new Error('translate-source: missing required argument <sourceId>');
  }
  const dryRun = args.flags.dryRun;

  const ctx: TranslateSourceCtx = {
    engine: deps.engine,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: args.flags.force,
    model: args.options.model,
    log: deps.log,
    preflight: deps.preflight,
    delay: deps.delay,
    dryRun,
  };

  const report = await translateSource(sourceId, ctx);

  for (const issue of report.issues) {
    const label = dryRun ? dryRunLabel(issue.outcome) : issue.outcome;
    deps.log(
      `translate-source: ${issue.ark} -> ${label} ` +
        `(${issue.pagesDone}/${issue.pagesTotal} pages)` +
        (issue.message !== undefined ? ` -- ${issue.message}` : ''),
    );
  }
  deps.log(
    `translate-source: ${sourceId} -- ${report.issues.length} issue(s) attempted, ` +
      `aborted=${report.abortedOnConsecutiveFailures}`,
  );

  if (dryRun) {
    deps.log('translate-source: (dry-run) wrote nothing');
    return;
  }

  if (report.abortedOnConsecutiveFailures) {
    throw new Error(
      `translate-source: ${sourceId} aborted after ${CONSECUTIVE_FAILURE_ABORT} ` +
        'consecutive issue failures -- see the per-issue report above',
    );
  }
}
