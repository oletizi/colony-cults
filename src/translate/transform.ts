import type { TranslationEngine } from '@/engine/types';

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
 * A source's "translatable" character mass: the total length of its maximal
 * runs of >=3 letters (Unicode `\p{L}`). This is the denominator the
 * degeneracy threshold is measured against, INSTEAD of the raw length.
 *
 * The document corpus includes illustration/plate pages (engravings,
 * autographs, portraits) whose OCR is mostly scattered single- and
 * double-character noise plus a short real caption. Their raw length is large
 * but their translatable content is tiny, so a faithful short caption
 * translation would otherwise be wrongly flagged as truncated. Counting only
 * >=3-letter runs excludes the noise: for a dense text page this tracks the
 * raw length closely (the truncation guard is unchanged there), while for a
 * plate page it collapses to the caption's size so a faithful transform passes.
 */
export function translatableLength(text: string): number {
  const runs = text.match(/\p{L}{3,}/gu);
  if (runs === null) {
    return 0;
  }
  let total = 0;
  for (const run of runs) {
    total += run.length;
  }
  return total;
}

/**
 * Run one faithful text transformation via the injected {@link TranslationEngine},
 * retrying when the engine returns a degenerate (implausibly short) result,
 * and failing loud if every attempt is degenerate.
 *
 * This wraps the model's real-world intermittency: the same page can translate
 * fully on one call and to a 20-char fragment on the next. Each retry re-invokes
 * the real engine (no fabricated or partial text is ever substituted -- a
 * persistent failure throws, honoring the no-fallback rule). The client's own
 * non-zero-exit / empty-output guards still apply on every attempt.
 *
 * @param engine Injected translation engine adapter.
 * @param instruction Instruction passed as the `claude --print` prompt.
 * @param sourceText Source text for the transformation (page text on stdin).
 * @param model Optional model alias/full name pinned via `--model`.
 * @param systemPrompt System prompt appended via `--append-system-prompt`.
 * @param opts Optional overrides for the ratio/attempt thresholds.
 * @returns The engine's output for the first non-degenerate attempt.
 */
export async function runFaithfulTransformation(
  engine: TranslationEngine,
  instruction: string,
  sourceText: string,
  model: string | undefined,
  systemPrompt: string,
  opts: { minRatio?: number; maxAttempts?: number } = {},
): Promise<string> {
  const minRatio = opts.minRatio ?? DEGENERATE_MIN_RATIO;
  const maxAttempts = opts.maxAttempts ?? MAX_TRANSFORM_ATTEMPTS;
  // Measure the threshold against the source's translatable content, not its
  // raw length, so OCR-noise-heavy illustration/plate pages do not inflate it.
  const sourceLength = translatableLength(sourceText);
  const threshold = Math.floor(sourceLength * minRatio);

  let lastLength = -1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const output = await engine.run(instruction, sourceText, model, systemPrompt);
    lastLength = translatableLength(output);
    if (lastLength >= threshold) {
      return output;
    }
  }

  throw new Error(
    `transformation engine returned a degenerate/truncated result after ` +
      `${maxAttempts} attempts: the last output had ${lastLength} translatable ` +
      `characters for a ${sourceLength}-translatable-character source ` +
      `(expected at least ${threshold}). ` +
      `No fallback or partial result is substituted.`,
  );
}
