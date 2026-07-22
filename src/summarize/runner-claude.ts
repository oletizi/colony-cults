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
 * `summarize` mirrors the translation engine (`createClaudeCli`,
 * `src/claude/client.ts`) exactly: the FIXED instruction from
 * {@link buildSummaryPrompt} (the summary task plus the output-envelope
 * contract) is the `claude --print <instruction>` argument, and the VARIABLE
 * source document text (`inputText`) is streamed to the child on stdin via
 * `runner.run(command, args, inputText)`. This separation is load-bearing: a
 * real whole-issue finding-aid (French OCR plus its English translation) runs
 * to hundreds of KB or more, which folded into the positional argument would
 * exceed the OS `ARG_MAX` limit and fail the exec with `E2BIG` on exactly the
 * large real inputs the pipeline exists to handle. Keeping the argument fixed
 * and bounded while the payload rides stdin removes that competition entirely.
 *
 * It drives `claude --print` as an isolated text-transformation engine -- no
 * skills (`--disable-slash-commands`), no agentic tools (`--tools ""`), with
 * {@link SUMMARY_SYSTEM_PROMPT} appended via `--append-system-prompt` to pin
 * the fenced-JSON-only output. The model's reply is parsed by
 * {@link parseSummaryEnvelope} into a {@link SummaryResult}; a non-zero exit,
 * empty output, or any envelope violation throws a descriptive error
 * (Constitution V -- no fallback, no best-effort partial result).
 *
 * A MALFORMED envelope (unparseable JSON, a missing/duplicate ```json fence, or
 * a schema violation) is a STOCHASTIC LLM-output deviation (spec 017): the same
 * prompt, generated afresh, usually returns a well-formed envelope. So the
 * shell-out + parse is wrapped in a bounded retry loop of
 * {@link MAX_ENVELOPE_ATTEMPTS} attempts; if every attempt is malformed the
 * LAST descriptive error is thrown (fail loud -- no fabrication, no fallback).
 * Empty stdout is treated as a like transient (a truncated/aborted generation)
 * and retried. A NON-ZERO exit is NOT retried: it signals a persistent
 * claude/exec failure (bad auth, missing binary) that a re-run will not fix, so
 * it fails loud immediately.
 */
const MAX_ENVELOPE_ATTEMPTS = 3;

export function createClaudeSummarizer(runner: ClaudeCommandRunner): SummarizationRunner {
  return {
    name: 'claude-code-cli',
    async summarize(inputText: string, model?: string): Promise<SummaryResult> {
      const args = [
        '--print',
        buildSummaryPrompt(),
        '--disable-slash-commands',
        '--tools',
        '',
        '--append-system-prompt',
        SUMMARY_SYSTEM_PROMPT,
      ];
      if (model !== undefined) {
        args.push('--model', model);
      }

      let lastEnvelopeError: Error | undefined;
      for (let attempt = 1; attempt <= MAX_ENVELOPE_ATTEMPTS; attempt++) {
        // Source text on stdin (NOT the argument vector) so an arbitrarily large
        // whole-issue finding-aid never competes with the OS ARG_MAX exec limit.
        const result = await runner.run('claude', args, inputText);

        if (result.exitCode !== 0) {
          // Persistent claude/exec failure -- not a stochastic envelope quirk.
          // Fail loud immediately; a retry would not change the outcome.
          throw new Error(
            `claude --print failed (exit ${result.exitCode}) for the summarization ` +
              `pass: ${result.stderr.trim() || '(no stderr captured)'}`,
          );
        }

        if (result.stdout.trim().length === 0) {
          // Empty output: treat as a retryable transient (truncated generation).
          lastEnvelopeError = new Error(
            'claude --print produced empty output for the summarization pass -- ' +
              'the engine returned no usable text (no fallback is substituted).',
          );
          continue;
        }

        try {
          return parseSummaryEnvelope(result.stdout);
        } catch (cause) {
          // Malformed envelope (parse failure / missing fence / schema
          // violation): a stochastic deviation -- record and retry.
          lastEnvelopeError =
            cause instanceof Error ? cause : new Error(String(cause));
        }
      }

      // Every attempt produced a malformed (or empty) result -- fail loud with
      // the last descriptive error. No fabricated result is substituted.
      throw (
        lastEnvelopeError ??
        new Error(
          'claude --print produced no usable summary envelope after ' +
            `${MAX_ENVELOPE_ATTEMPTS} attempts.`,
        )
      );
    },
  };
}
