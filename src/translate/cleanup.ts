import { TRANSFORMATION_SYSTEM_PROMPT } from '@/claude/client';
import type { TranslationEngine } from '@/engine/types';
import { runFaithfulTransformation } from '@/translate/transform';

/**
 * Build the cleanup-pass instruction for a given source `language` (T014,
 * FR-003). The directives are language-NEUTRAL OCR corrections; only the
 * language the transcription must stay in is templated in. The pass corrects
 * raw OCR into a faithful transcription in the SOURCE's own language -- it
 * never translates (translation is a separate pass, `@/translate/translate-page`).
 *
 * The page's raw OCR text is NOT embedded here -- it is passed separately as
 * the `TranslationEngine.run` sourceText argument (written to stdin), mirroring
 * the `claude --print` invocation shape documented on `TranslationEngine`.
 *
 * Directives, per FR-003 and the design record:
 * - dehyphenate words split across line breaks;
 * - join lines broken mid-sentence into natural paragraphs;
 * - repair obvious OCR scan errors;
 * - drop OCR condition/artifact markers;
 * - stay faithful to the source: do not translate, summarize, add, or
 *   remove content;
 * - output ONLY the corrected text in the source language, with no preamble.
 *
 * @throws If `language` is empty/whitespace -- no default is assumed (a silent
 *   fallback to one language would mis-instruct the engine for every other).
 */
export function buildCleanupInstruction(language: string): string {
  const lang = language.trim();
  if (lang.length === 0) {
    throw new Error(
      'buildCleanupInstruction: language is required (no default) -- ' +
        'pass the source Source\'s language so the cleanup stays in that language.',
    );
  }
  return `You are correcting one page of raw ${lang} OCR text into a clean, faithful ${lang} transcription.

Apply these corrections:
- Dehyphenate words split across line breaks (e.g. "exam-\\nple" becomes "example").
- Join lines broken mid-sentence into natural paragraphs, preserving genuine paragraph breaks.
- Repair obvious OCR scan errors (misrecognized characters, garbled words) where the intended word is clear from context.
- Drop OCR condition markers and scan-artifact annotations that are not part of the source text.

Stay faithful to the source: do not translate, summarize, add, or remove content. Preserve the original ${lang} wording and meaning exactly. Correct the COMPLETE page from its first line to its last -- do not stop early or return only a fragment.

Your entire reply must be the corrected ${lang} text and nothing else: no preamble, no acknowledgement, no commentary, no explanation, no Markdown fences, and no separator lines. Begin with the first word of the corrected ${lang} text.`;
}

/**
 * Corrects one page of raw OCR text into a faithful transcription in the
 * source's own `language`, via the injected {@link TranslationEngine}. FR-003:
 * dehyphenates, joins broken lines, repairs obvious scan errors, and drops
 * non-text condition markers, while remaining faithful to the source's words.
 *
 * @param engine Injected translation engine adapter (composition, not inheritance).
 * @param pageText Raw OCR text for one page.
 * @param language The source language the transcription must stay in (e.g.
 *   "French", "English", "Italian"). Required -- no default.
 * @param model Optional model alias/full name forwarded to `engine.run`.
 * @returns The corrected text for the page, in `language`.
 */
export async function cleanupPage(
  engine: TranslationEngine,
  pageText: string,
  language: string,
  model?: string,
): Promise<string> {
  return await runFaithfulTransformation(
    engine,
    buildCleanupInstruction(language),
    pageText,
    model,
    TRANSFORMATION_SYSTEM_PROMPT,
  );
}
