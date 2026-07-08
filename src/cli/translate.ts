import type { ParsedArgs } from '@/cli/parse';
import { requireOption } from '@/cli/fetch';
import { resolveArchiveRoot } from '@/archive/location';
import { assertClaudeAvailable } from '@/claude/preflight';
import { createClaudeCli, type ClaudeCli } from '@/claude/client';
import { defaultClaudeCommandRunner } from '@/claude/exec';
import { translateIssue, type TranslateIssueCtx } from '@/translate/issue';

/** Injectable side effects for the `translate` command (real preflight + disk by default). */
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
