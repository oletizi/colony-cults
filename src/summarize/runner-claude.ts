import type { ClaudeCommandRunner } from '@/claude/exec';
import type { SummarizationRunner, SummaryResult } from '@/summarize/types';
import { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from '@/summarize/prompt';
import { parseSummaryEnvelope } from '@/summarize/parse-envelope';

/**
 * Build a {@link SummarizationRunner} backed by the given
 * {@link ClaudeCommandRunner} (T009). A factory + closure over the injected
 * runner (composition, not inheritance) so tests can supply a fake runner and
 * never shell out to a real `claude` binary. `name` records this adapter's
 * provenance label for artifact `.yml` metadata, matching `createClaudeCli`'s
 * label convention (`src/claude/client.ts`).
 *
 * `summarize` folds the instruction AND the input text into a single prompt
 * via {@link buildSummaryPrompt} (unlike the translation engine, which puts
 * the source text on stdin), then drives `claude --print` as an isolated
 * text-transformation engine -- no skills (`--disable-slash-commands`), no
 * agentic tools (`--tools ""`), with {@link SUMMARY_SYSTEM_PROMPT} appended
 * via `--append-system-prompt` to pin the fenced-JSON-only output. This
 * mirrors `createClaudeCli`'s arg construction exactly (research R1). The
 * model's reply is parsed by {@link parseSummaryEnvelope} into a
 * {@link SummaryResult}; a non-zero exit, empty output, or any envelope
 * violation throws a descriptive error (Constitution V -- no fallback, no
 * best-effort partial result).
 */
export function createClaudeSummarizer(runner: ClaudeCommandRunner): SummarizationRunner {
  return {
    name: 'claude-code-cli',
    async summarize(inputText: string, model?: string): Promise<SummaryResult> {
      const args = [
        '--print',
        buildSummaryPrompt(inputText),
        '--disable-slash-commands',
        '--tools',
        '',
        '--append-system-prompt',
        SUMMARY_SYSTEM_PROMPT,
      ];
      if (model !== undefined) {
        args.push('--model', model);
      }

      const result = await runner.run('claude', args);

      if (result.exitCode !== 0) {
        throw new Error(
          `claude --print failed (exit ${result.exitCode}) for the summarization ` +
            `pass: ${result.stderr.trim() || '(no stderr captured)'}`,
        );
      }

      if (result.stdout.trim().length === 0) {
        throw new Error(
          'claude --print produced empty output for the summarization pass -- ' +
            'the engine returned no usable text (no fallback is substituted).',
        );
      }

      return parseSummaryEnvelope(result.stdout);
    },
  };
}
