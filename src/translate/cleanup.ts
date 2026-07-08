import type { ClaudeCli } from '@/claude/client';
import { TRANSFORMATION_SYSTEM_PROMPT } from '@/claude/client';
import { runFaithfulTransformation } from '@/translate/transform';

/**
 * Instruction prompt for the cleanup pass (T014, FR-003): turns one page of
 * raw French OCR text into a corrected French transcription. The page's raw
 * OCR text itself is NOT embedded here -- it is passed separately as the
 * `ClaudeCli.run` sourceText argument (written to stdin), mirroring the
 * `claude --print` invocation shape documented on `ClaudeCli`.
 *
 * Directives, per FR-003 and the design record:
 * - dehyphenate words split across line breaks;
 * - join lines broken mid-sentence into natural paragraphs;
 * - repair obvious OCR scan errors;
 * - drop OCR condition/artifact markers (e.g. "Contraste insuffisant");
 * - stay faithful to the source: do not translate, summarize, add, or
 *   remove content;
 * - output ONLY the corrected French text, with no preamble or commentary.
 */
const CLEANUP_INSTRUCTION = `You are correcting one page of raw French OCR text into a clean, faithful French transcription.

Apply these corrections:
- Dehyphenate words split across line breaks (e.g. "exem-\\nple" becomes "exemple").
- Join lines broken mid-sentence into natural paragraphs, preserving genuine paragraph breaks.
- Repair obvious OCR scan errors (misrecognized characters, garbled words) where the intended word is clear from context.
- Drop OCR condition markers and scan artifact annotations that are not part of the source text (e.g. "Contraste insuffisant").

Stay faithful to the source: do not translate, summarize, add, or remove content. Preserve the original French wording and meaning exactly. Correct the COMPLETE page from its first line to its last -- do not stop early or return only a fragment.

Your entire reply must be the corrected French text and nothing else: no preamble, no acknowledgement, no commentary, no explanation, no Markdown fences, and no separator lines. Begin with the first word of the corrected French.`;

/**
 * Corrects one page of raw French OCR text into a faithful French
 * transcription via the injected {@link ClaudeCli}. FR-003: dehyphenates,
 * joins broken lines, repairs obvious scan errors, and drops non-text
 * condition markers, while remaining faithful to the source's words.
 *
 * @param claude Injected Claude CLI adapter (composition, not inheritance).
 * @param pageText Raw OCR text for one page.
 * @param model Optional model alias/full name forwarded to `claude.run`.
 * @returns The corrected French text for the page.
 */
export async function cleanupPage(
  claude: ClaudeCli,
  pageText: string,
  model?: string,
): Promise<string> {
  return await runFaithfulTransformation(
    claude,
    CLEANUP_INSTRUCTION,
    pageText,
    model,
    TRANSFORMATION_SYSTEM_PROMPT,
  );
}
