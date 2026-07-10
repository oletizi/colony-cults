import { execCommand } from '@/ocr/exec';
import type { ClaudeCommandRunner } from '@/claude/exec';
import { defaultClaudeCommandRunner } from '@/claude/exec';

/** Printed verbatim in the failure message so the operator can act on it. */
const INSTALL_INSTRUCTIONS =
  'Install the Claude Code CLI (see https://docs.claude.com/en/docs/claude-code) ' +
  'and run `claude login` to authenticate.';

/** Resolve whether a command name is present on `PATH`. Mirrors `@/ocr/types`' `PathLookup`. */
export interface ClaudePathLookup {
  (command: string): Promise<boolean>;
}

/** Injectable dependencies of {@link assertClaudeAvailable} (T005). Mirrors `@/ocr/preflight`'s `OcrPreflightDeps`. */
export interface ClaudePreflightDeps {
  /** Resolve whether `claude` is present on `PATH`. */
  pathLookup: ClaudePathLookup;
  /** Run `claude --version` (or any other diagnostic invocation). */
  run: ClaudeCommandRunner;
}

/** Real (PATH-lookup + shell-out) preflight dependencies. */
export function defaultClaudePreflightDeps(): ClaudePreflightDeps {
  return {
    pathLookup: async (command) =>
      (await execCommand('which', [command])).exitCode === 0,
    run: defaultClaudeCommandRunner(),
  };
}

/**
 * Validate that the `claude` CLI is present on `PATH` and runnable, throwing
 * a descriptive Error naming `claude` plus how to install/authenticate it
 * when it is not (FR-009). This check MUST run only when a real translation
 * is about to happen -- never on `--dry-run` (that wiring lands in T017); this
 * function only implements the check itself.
 *
 * `pathLookup` and `run` are injected so unit/integration tests can simulate
 * any present/absent/broken combination without a real `claude` binary
 * (T013).
 */
export async function assertClaudeAvailable(
  deps: ClaudePreflightDeps = defaultClaudePreflightDeps(),
): Promise<void> {
  if (!(await deps.pathLookup('claude'))) {
    throw new Error(
      `claude CLI preflight failed -- "claude" was not found on PATH. ${INSTALL_INSTRUCTIONS}`,
    );
  }

  const result = await deps.run.run('claude', ['--version']);
  if (result.exitCode !== 0) {
    throw new Error(
      `claude CLI preflight failed -- "claude --version" exited with code ${result.exitCode}. ` +
        `${INSTALL_INSTRUCTIONS}`,
    );
  }
}
