import type { OcrCommandRunner } from '@/ocr/types';
import type { OcrQuality, OcrQualityTier } from '@/archive/provenance';

/**
 * OCR fidelity ({@link OcrQuality}) is computed from the produced text and
 * recorded on EVERY OCR-text artifact's provenance (Constitution III --
 * "known quality issues"). Making it a computed, mandatory part of producing an
 * OCR artifact is what makes a lapse in recording it mechanically impossible:
 * {@link assessOcrQuality} runs inside `ocrIssue` before the text is stored, the
 * store path requires the result, and `bib validate` rejects any ocr-text
 * artifact missing it.
 */

/** Method tag stored in provenance; bump the suffix if the algorithm changes. */
export const OCR_QUALITY_METHOD = 'aspell-realword-ratio-v1';

/** Tier thresholds on the real-word ratio (empirically: good OCR ~0.9, degraded ~0.5-0.7). */
export const OCR_QUALITY_LOW_MAX = 0.7;
export const OCR_QUALITY_HIGH_MIN = 0.85;

/**
 * Map a Tesseract language code (as passed to `ocrmypdf --language`) to its
 * aspell dictionary code. Fails loud on an unmapped language rather than
 * silently scoring against the wrong dictionary -- extend the map when a new
 * source language is onboarded.
 */
const TESSERACT_TO_ASPELL: Readonly<Record<string, string>> = {
  fra: 'fr',
  eng: 'en',
  ita: 'it',
  deu: 'de',
  spa: 'es',
  lat: 'la',
};

/**
 * Resolve the aspell dictionary code for a `--language` spec. For a `+`-joined
 * multi-language set the PRIMARY (first) language is used for scoring.
 */
export function aspellLanguageFor(tesseractLang: string): string {
  const primary = tesseractLang.split('+')[0];
  const code = TESSERACT_TO_ASPELL[primary];
  if (code === undefined) {
    throw new Error(
      `assessOcrQuality: no aspell dictionary mapping for OCR language ` +
        `"${primary}" -- add it to TESSERACT_TO_ASPELL`,
    );
  }
  return code;
}

/** Coarse tier from the real-word ratio. */
export function tierFor(ratio: number): OcrQualityTier {
  if (ratio < OCR_QUALITY_LOW_MAX) {
    return 'low';
  }
  if (ratio >= OCR_QUALITY_HIGH_MIN) {
    return 'high';
  }
  return 'medium';
}

/** Alphabetic tokens (Latin incl. accents), length >= 3 -- the scored units. */
function tokenize(text: string): string[] {
  return text.match(/[A-Za-zÀ-ÿ]{3,}/g) ?? [];
}

/**
 * Score OCR text fidelity as the fraction of >=3-letter tokens the aspell
 * dictionary for `tesseractLang` accepts. Shells `aspell -l <code> list` (which
 * echoes only the MISSPELLED tokens on stdin) through the injected runner, so
 * tests drive it with a fake and no real aspell is required.
 *
 * A text with no scorable tokens (blank/near-blank page) scores `ratio: 1`,
 * tier `high` -- there is nothing degraded to flag; the blank-ness is already
 * captured by the page being recorded empty.
 */
export async function assessOcrQuality(
  text: string,
  tesseractLang: string,
  runner: OcrCommandRunner,
): Promise<OcrQuality> {
  const language = aspellLanguageFor(tesseractLang);
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return { method: OCR_QUALITY_METHOD, language, ratio: 1, tier: 'high' };
  }

  const result = await runner.run(
    'aspell',
    ['-l', language, 'list'],
    tokens.join('\n'),
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `assessOcrQuality: "aspell -l ${language} list" failed ` +
        `(exit ${result.exitCode}): ${result.stderr.trim() || '(no output)'}`,
    );
  }

  const misspelled = new Set(
    result.stdout.split(/\s+/).filter((w) => w.length > 0),
  );
  const good = tokens.filter((t) => !misspelled.has(t)).length;
  const ratio = Math.round((good / tokens.length) * 100) / 100;
  return { method: OCR_QUALITY_METHOD, language, ratio, tier: tierFor(ratio) };
}
