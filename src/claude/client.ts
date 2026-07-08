import type { ClaudeCommandRunner } from '@/claude/exec';

/**
 * Runs ONE `claude --print` invocation to completion (T006, research R1/R8):
 * the instruction is the prompt argument, the page's source text goes on
 * stdin, and captured stdout is the result. No fallback -- a non-zero exit
 * or empty output throws a descriptive error rather than returning partial
 * or fabricated text.
 */
export interface ClaudeCli {
  /**
   * @param prompt Instruction text passed as the `claude --print` argument.
   * @param sourceText Page text written to the child process's stdin.
   * @param model Optional model alias/full name pinned via `--model`; when
   *   omitted, `claude` uses its own default. The caller records the
   *   resolved model for provenance -- this function does not.
   * @returns The trimmed-free captured stdout on success.
   */
  run(prompt: string, sourceText: string, model?: string): Promise<string>;
}

/**
 * Build a {@link ClaudeCli} backed by the given {@link ClaudeCommandRunner}.
 * A factory + closure over the injected runner (composition, not
 * inheritance) so tests can supply a fake runner and never shell out to a
 * real `claude` binary.
 *
 * Flag spelling (`--print`, `--model`) matches the documented CLI per
 * research R1; the exact spelling is re-confirmed against the installed
 * `claude` version in T032.
 */
export function createClaudeCli(runner: ClaudeCommandRunner): ClaudeCli {
  return {
    async run(
      prompt: string,
      sourceText: string,
      model?: string,
    ): Promise<string> {
      const args = ['--print', prompt];
      if (model !== undefined) {
        args.push('--model', model);
      }

      const result = await runner.run('claude', args, sourceText);

      if (result.exitCode !== 0) {
        throw new Error(
          `claude --print failed (exit ${result.exitCode}) for command ` +
            `"claude ${args.join(' ')}": ${result.stderr.trim() || '(no stderr captured)'}`,
        );
      }

      if (result.stdout.trim().length === 0) {
        throw new Error(
          `claude --print produced empty output for command ` +
            `"claude ${args.join(' ')}" -- the engine returned no usable text ` +
            `(no fallback is substituted).`,
        );
      }

      return result.stdout;
    },
  };
}
