import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256OfBytes } from '@/archive/checksum';
import { companionYamlPath } from '@/archive/store';
import { readProvenance, type OcrQualityTier } from '@/archive/provenance';

/**
 * One input companion consumed to build a summary, and its content sha256 at
 * selection time (research.md Decision 6). This is BOTH the shape fed into
 * `SummaryResult` generation (via {@link SelectedSummaryInput.text}) AND the
 * source of a summary provenance sidecar's `input_layers` (FR-005) -- the
 * idempotency key (Decision 4). `path` is relative to the issue directory
 * (e.g. `issue.txt`, `issue.en.txt`), matching the convention already used by
 * `ProvenanceFields.input_layers` (see `src/archive/provenance.ts`).
 */
export interface SelectedInputLayer {
  readonly path: string;
  readonly sha256: string;
}

/**
 * Low-confidence input-quality note (FR-016), surfaced when the input OCR's
 * companion YAML records `ocr_quality.tier === 'low'`. Mirrors
 * `ProvenanceFields.input_quality` (`src/archive/provenance.ts`) so
 * `src/summarize/artifacts.ts` (T017) can pass this straight through into the
 * summary's provenance sidecar without re-shaping it.
 */
export interface SummaryInputQuality {
  readonly tier: OcrQualityTier;
  readonly note: string;
}

/**
 * The result of best-available-text selection for one issue (FR-002/FR-003):
 * the input companion(s) actually used (for provenance + idempotency), the
 * combined text to feed the summarizer, and an optional low-confidence note.
 */
export interface SelectedSummaryInput {
  /** Input companion(s) used, in the order concatenated into `text`. */
  readonly layers: readonly SelectedInputLayer[];
  /** The text to summarize -- either `issue.txt` alone, or both layers combined (see below). */
  readonly text: string;
  /** Present only when the input OCR's recorded quality tier is `low` (FR-016). */
  readonly inputQuality?: SummaryInputQuality;
}

const FRENCH_OCR_FILENAME = 'issue.txt';
const ENGLISH_TRANSLATION_FILENAME = 'issue.en.txt';

/**
 * Combined-text format when BOTH the French OCR and its English translation
 * are used as input (research.md Decision 6, AC-2): two clearly delimited
 * sections, French OCR first (the original-language source), then the
 * English translation, so a reader -- human or the summarization LLM -- can
 * unambiguously tell which section is which and never mistake one language
 * for the other. Mirrors the "BEGIN/END SOURCE DOCUMENT TEXT" delimiter
 * convention already used by `buildSummaryPrompt` (`src/summarize/prompt.ts`),
 * which wraps whatever text this function returns.
 */
function combineFrenchAndEnglish(frenchText: string, englishText: string): string {
  return (
    `=== FRENCH OCR TEXT (original-language source) ===\n${frenchText}\n\n` +
    `=== ENGLISH TRANSLATION (of the French OCR text above) ===\n${englishText}`
  );
}

/** Read a file's bytes and its sha256 in one pass (reuses the archive layer's sha helper). */
async function readWithSha(
  filePath: string,
): Promise<{ text: string; bytes: Uint8Array; sha256: string }> {
  const bytes = await readFile(filePath);
  return { text: bytes.toString('utf-8'), bytes, sha256: sha256OfBytes(bytes) };
}

/**
 * Best-effort read of the French-OCR companion's low-confidence quality note
 * (FR-016): returns `undefined` whenever there is nothing to surface --
 * `issue.txt` has no companion YAML yet, the companion is unreadable, it has
 * no `ocr_quality` block, or the tier is not `low`. This mirrors
 * `readProvenanceSafe` (`src/archive/store.ts`, not exported): a missing or
 * malformed sidecar here is NOT a fail-loud condition -- the low-confidence
 * note is a value-add annotation (FR-016), not a precondition for
 * summarization, which must proceed regardless of OCR quality.
 */
async function readInputQuality(frenchOcrPath: string): Promise<SummaryInputQuality | undefined> {
  const yamlPath = companionYamlPath(frenchOcrPath);
  if (!existsSync(yamlPath)) {
    return undefined;
  }
  try {
    const provenance = await readProvenance(yamlPath);
    if (provenance.ocr_quality?.tier !== 'low') {
      return undefined;
    }
    return {
      tier: provenance.ocr_quality.tier,
      note:
        `Input OCR quality is low (tier "${provenance.ocr_quality.tier}", ` +
        `real-word ratio ${provenance.ocr_quality.ratio}) -- this summary may inherit OCR errors.`,
    };
  } catch {
    return undefined;
  }
}

/**
 * Select the best-available acquired text for one issue and build the
 * combined summarizer input, per research.md Decision 6 / spec.md FR-002:
 *
 * 1. If `issue.en.txt` (English translation) exists, use BOTH `issue.txt`
 *    (the French OCR it was translated from) and `issue.en.txt` -- the
 *    combined text is the {@link combineFrenchAndEnglish} format.
 * 2. Else if `issue.txt` exists (an English-language source's own OCR), use
 *    it alone.
 * 3. Else FAIL LOUD (FR-003) -- no usable text layer, no fabricated summary.
 *
 * Pure-ish: reads only from `issueDir` on disk (page images, translation
 * output, and OCR text are all already-acquired inputs; this function makes
 * no network call and writes nothing).
 */
export async function selectSummaryInput(issueDir: string): Promise<SelectedSummaryInput> {
  const frenchOcrPath = path.join(issueDir, FRENCH_OCR_FILENAME);
  const translationPath = path.join(issueDir, ENGLISH_TRANSLATION_FILENAME);

  const hasTranslation = existsSync(translationPath);
  const hasFrenchOcr = existsSync(frenchOcrPath);

  if (hasTranslation) {
    if (!hasFrenchOcr) {
      throw new Error(
        `selectSummaryInput: ${ENGLISH_TRANSLATION_FILENAME} exists in ${issueDir} but its ` +
          `source ${FRENCH_OCR_FILENAME} is missing -- a translation cannot be summarized ` +
          `without the OCR it was derived from`,
      );
    }
    const [french, english] = await Promise.all([
      readWithSha(frenchOcrPath),
      readWithSha(translationPath),
    ]);
    const inputQuality = await readInputQuality(frenchOcrPath);
    return {
      layers: [
        { path: FRENCH_OCR_FILENAME, sha256: french.sha256 },
        { path: ENGLISH_TRANSLATION_FILENAME, sha256: english.sha256 },
      ],
      text: combineFrenchAndEnglish(french.text, english.text),
      ...(inputQuality !== undefined ? { inputQuality } : {}),
    };
  }

  if (hasFrenchOcr) {
    const ocr = await readWithSha(frenchOcrPath);
    const inputQuality = await readInputQuality(frenchOcrPath);
    return {
      layers: [{ path: FRENCH_OCR_FILENAME, sha256: ocr.sha256 }],
      text: ocr.text,
      ...(inputQuality !== undefined ? { inputQuality } : {}),
    };
  }

  throw new Error(
    `selectSummaryInput: no usable text layer found in ${issueDir} -- missing both ` +
      `${FRENCH_OCR_FILENAME} (OCR) and ${ENGLISH_TRANSLATION_FILENAME} (English translation); ` +
      `run OCR (and/or translation) for this issue before summarizing (FR-003, fail loud)`,
  );
}
