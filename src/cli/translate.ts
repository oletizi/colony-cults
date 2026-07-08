import type { ParsedArgs } from '@/cli/parse';
import { requireOption } from '@/cli/fetch';
import { resolveArchiveRoot } from '@/archive/location';
import { assertClaudeAvailable } from '@/claude/preflight';
import { createClaudeCli, type ClaudeCli } from '@/claude/client';
import { defaultClaudeCommandRunner } from '@/claude/exec';
import { translateIssue, type TranslateIssueCtx } from '@/translate/issue';
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
  /** Injected Claude engine adapter. */
  claude: ClaudeCli;
  /**
   * Polite pacing thunk between engine-invoking issues in a whole-source run
   * (`runTranslate`, the single-issue command, does not use this).
   */
  delay: () => Promise<void>;
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
    claude: createClaudeCli(defaultClaudeCommandRunner()),
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

  // TODO(T027/T028): dry-run

  const ctx: TranslateIssueCtx = {
    claude: deps.claude,
    sourceId,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: args.flags.force,
    model: args.options.model,
    log: deps.log,
    preflight: deps.preflight,
  };

  const result = await translateIssue(issueArk, ctx);

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
 */
export async function runTranslateSource(
  args: ParsedArgs,
  deps: TranslateCliDeps = defaultTranslateCliDeps(),
): Promise<void> {
  const sourceId = args.positional[0];
  if (sourceId === undefined) {
    throw new Error('translate-source: missing required argument <sourceId>');
  }

  // TODO(T027/T028): dry-run

  const ctx: TranslateSourceCtx = {
    claude: deps.claude,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: args.flags.force,
    model: args.options.model,
    log: deps.log,
    preflight: deps.preflight,
    delay: deps.delay,
  };

  const report = await translateSource(sourceId, ctx);

  for (const issue of report.issues) {
    deps.log(
      `translate-source: ${issue.ark} -> ${issue.outcome} ` +
        `(${issue.pagesDone}/${issue.pagesTotal} pages)` +
        (issue.message !== undefined ? ` -- ${issue.message}` : ''),
    );
  }
  deps.log(
    `translate-source: ${sourceId} -- ${report.issues.length} issue(s) attempted, ` +
      `aborted=${report.abortedOnConsecutiveFailures}`,
  );

  if (report.abortedOnConsecutiveFailures) {
    throw new Error(
      `translate-source: ${sourceId} aborted after ${CONSECUTIVE_FAILURE_ABORT} ` +
        'consecutive issue failures -- see the per-issue report above',
    );
  }
}
