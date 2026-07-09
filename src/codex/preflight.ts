import { execCommand } from '@/ocr/exec';
import type { CodexCommandRunner } from '@/codex/exec';
import { defaultCodexCommandRunner } from '@/codex/exec';

/** Printed verbatim in the failure message so the operator can act on it. */
const INSTALL_INSTRUCTIONS =
  'Install the Codex CLI (see https://developers.openai.com/codex/cli) ' +
  'and run `codex login` to authenticate.';

/** Resolve whether a command name is present on `PATH`. Mirrors `@/claude/preflight`'s `ClaudePathLookup`. */
export interface CodexPathLookup {
  (command: string): Promise<boolean>;
}

/** Injectable dependencies of {@link assertCodexAvailable}. Mirrors `@/claude/preflight`'s `ClaudePreflightDeps`. */
export interface CodexPreflightDeps {
  /** Resolve whether `codex` is present on `PATH`. */
  pathLookup: CodexPathLookup;
  /** Run `codex --version` (or any other diagnostic invocation). */
  run: CodexCommandRunner;
}

/** Real (PATH-lookup + shell-out) preflight dependencies. */
export function defaultCodexPreflightDeps(): CodexPreflightDeps {
  return {
    pathLookup: async (command) =>
      (await execCommand('which', [command])).exitCode === 0,
    run: defaultCodexCommandRunner(),
  };
}

/**
 * Validate that the `codex` CLI is present on `PATH` and runnable, throwing
 * a descriptive Error naming `codex` plus how to install/authenticate it
 * when it is not. Codex analog of `@/claude/preflight`'s
 * `assertClaudeAvailable`.
 *
 * `pathLookup` and `run` are injected so unit/integration tests can simulate
 * any present/absent/broken combination without a real `codex` binary.
 */
export async function assertCodexAvailable(
  deps: CodexPreflightDeps = defaultCodexPreflightDeps(),
): Promise<void> {
  if (!(await deps.pathLookup('codex'))) {
    throw new Error(
      `codex CLI preflight failed -- "codex" was not found on PATH. ${INSTALL_INSTRUCTIONS}`,
    );
  }

  const result = await deps.run.run('codex', ['--version']);
  if (result.exitCode !== 0) {
    throw new Error(
      `codex CLI preflight failed -- "codex --version" exited with code ${result.exitCode}. ` +
        `${INSTALL_INSTRUCTIONS}`,
    );
  }
}
