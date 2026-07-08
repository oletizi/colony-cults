import type { ClaudeCli } from '@/claude/client';

/**
 * Instruction sent to the engine for the translation pass (T015, spec.md
 * FR-004: readable English produced from the CORRECTED French, not the raw
 * OCR). The corrected French itself travels as `sourceText`, never inlined
 * into the prompt, matching {@link ClaudeCli.run}'s contract.
 */
const TRANSLATION_PROMPT =
  'Translate the following corrected French text into readable, natural ' +
  'English. Be faithful to the source: preserve its meaning and structure, ' +
  'and do not summarize, add, or omit any content. ' +
  'Output ONLY the English translation -- no preamble, no commentary, and ' +
  'no notes before or after the translation.';

/**
 * Translates one page of CORRECTED French OCR text into readable English
 * (T015, spec.md FR-004/FR-016: the translation pass runs per page, on the
 * corrected French produced by the cleanup pass, never on raw OCR). A thin
 * wrapper over the injected {@link ClaudeCli} -- the prompt is the
 * instruction argument, the corrected French is the `sourceText` written to
 * the engine's stdin, and the engine's stdout is returned unchanged. No
 * fallback: a failed or empty engine call throws via `claude.run` itself.
 */
export async function translatePage(
  claude: ClaudeCli,
  correctedFrench: string,
  model?: string,
): Promise<string> {
  return await claude.run(TRANSLATION_PROMPT, correctedFrench, model);
}
