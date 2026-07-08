import type { ClaudeCommandRunner } from '@/claude/exec';

/**
 * System prompt that pins `claude --print` to behave as a pure
 * text-transformation engine for the translation pipeline. Appended to the
 * default system prompt so the model does not narrate or wrap its output.
 *
 * This exists because the live `claude` CLI, driven with only a user-prompt
 * instruction, intermittently prefixes a conversational preamble (e.g.
 * "I'll translate the corrected French text into natural English...\n---\n")
 * despite an "output only" instruction. Enforcing the constraint at the
 * system-prompt level suppresses that narration far more reliably (verified
 * against the installed CLI on real OCR pages).
 */
export const TRANSFORMATION_SYSTEM_PROMPT = `You are an automated text-transformation engine inside a document pipeline. You receive source text on stdin and a single transformation instruction.

Respond with ONLY the transformed text -- the raw result, ready to be written directly to a file, and nothing else.

Absolute rules:
- Never write any preamble, acknowledgement, or narration (no "Here is", no "I'll translate", no "Sure").
- Never add commentary, explanations, notes, headings, or closing remarks.
- Never wrap the output in Markdown code fences or surrounding quotation marks.
- Never insert a separator line (such as "---") before or after the result.
- Transform the ENTIRE input, from its first word to its last. Never stop early, and never return only a fragment, a single line, a heading, or a summary -- produce the complete transformed text for ALL of the source, however long it is.
- Begin your reply with the first character of the transformed text and end it with the last character of the transformed text.`;

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
   * @param systemPrompt Optional system prompt appended via
   *   `--append-system-prompt` (e.g. {@link TRANSFORMATION_SYSTEM_PROMPT}) to
   *   pin output-only behavior; when omitted, no system prompt is appended.
   * @returns The captured stdout on success.
   */
  run(
    prompt: string,
    sourceText: string,
    model?: string,
    systemPrompt?: string,
  ): Promise<string>;
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
      systemPrompt?: string,
    ): Promise<string> {
      const args = ['--print', prompt];
      if (systemPrompt !== undefined) {
        args.push('--append-system-prompt', systemPrompt);
      }
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
