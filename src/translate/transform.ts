import type { ClaudeCli } from '@/claude/client';

/**
 * Minimum plausible output-to-source length ratio for one faithful
 * transformation (cleanup or translation). The live `claude` CLI
 * intermittently returns a tiny fragment (e.g. a single heading) instead of
 * the full transformed text -- a non-empty but degenerate result the client's
 * empty-output guard cannot catch. A faithful French cleanup or a
 * French->English translation stays close to the source length, so an output
 * far below this ratio is treated as a truncation and retried.
 *
 * 0.25 is deliberately conservative: observed degenerate outputs run below 5%
 * of the source, while genuine transforms run ~85-105%, so this catches the
 * gross truncation with a wide margin and does not flag legitimately terse
 * pages (whose short output tracks their short input, keeping the ratio ~1).
 */
export const DEGENERATE_MIN_RATIO = 0.25;

/** Attempts before failing loud on persistent degenerate output. */
export const MAX_TRANSFORM_ATTEMPTS = 3;

/**
 * Run one faithful text transformation via the injected {@link ClaudeCli},
 * retrying when the engine returns a degenerate (implausibly short) result,
 * and failing loud if every attempt is degenerate.
 *
 * This wraps the model's real-world intermittency: the same page can translate
 * fully on one call and to a 20-char fragment on the next. Each retry re-invokes
 * the real engine (no fabricated or partial text is ever substituted -- a
 * persistent failure throws, honoring the no-fallback rule). The client's own
 * non-zero-exit / empty-output guards still apply on every attempt.
 *
 * @param claude Injected Claude CLI adapter.
 * @param instruction Instruction passed as the `claude --print` prompt.
 * @param sourceText Source text for the transformation (page text on stdin).
 * @param model Optional model alias/full name pinned via `--model`.
 * @param systemPrompt System prompt appended via `--append-system-prompt`.
 * @param opts Optional overrides for the ratio/attempt thresholds.
 * @returns The engine's output for the first non-degenerate attempt.
 */
export async function runFaithfulTransformation(
  claude: ClaudeCli,
  instruction: string,
  sourceText: string,
  model: string | undefined,
  systemPrompt: string,
  opts: { minRatio?: number; maxAttempts?: number } = {},
): Promise<string> {
  const minRatio = opts.minRatio ?? DEGENERATE_MIN_RATIO;
  const maxAttempts = opts.maxAttempts ?? MAX_TRANSFORM_ATTEMPTS;
  const sourceLength = sourceText.trim().length;
  const threshold = Math.floor(sourceLength * minRatio);

  let lastLength = -1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const output = await claude.run(instruction, sourceText, model, systemPrompt);
    lastLength = output.trim().length;
    if (lastLength >= threshold) {
      return output;
    }
  }

  throw new Error(
    `transformation engine returned a degenerate/truncated result after ` +
      `${maxAttempts} attempts: the last output was ${lastLength} characters ` +
      `for a ${sourceLength}-character source (expected at least ${threshold}). ` +
      `No fallback or partial result is substituted.`,
  );
}
