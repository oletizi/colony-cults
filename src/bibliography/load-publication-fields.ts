/**
 * Validator for a `Publication`'s `ocrTranscription` disclosure (spec
 * 015-english-source-pdf, FR-008/FR-013) -- the English-source honest sibling
 * of `machineAssist` (`@/bibliography/load`'s `validateMachineAssist`),
 * recorded INSTEAD OF it on a publication (never both). Extracted to its own
 * module to keep `load.ts` under the Constitution VII 500-line cap, mirroring
 * `load-fields.ts` / `load-coverage-fields.ts`'s companion-module pattern.
 */

import { assertKnownKeys, requireObject, requireString } from '@/bibliography/load-primitives';
import type { OcrTranscription } from '@/pdf/model';

const OCR_TRANSCRIPTION_KEYS = new Set(['engineStatus', 'caveat']);

/**
 * Parse one publication's `ocrTranscription` disclosure. `engineStatus` is a
 * required non-empty string (mandatory disclosure); `caveat` is a recorded
 * low-fidelity note or `null` (absent -> `null`, not an invented fallback).
 */
export function validateOcrTranscription(
  value: unknown,
  filePath: string,
  where: string,
): OcrTranscription {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, OCR_TRANSCRIPTION_KEYS, filePath, where);
  const engineStatus = requireString(obj.engineStatus, filePath, `${where}.engineStatus`);
  const caveat =
    obj.caveat === undefined || obj.caveat === null
      ? null
      : requireString(obj.caveat, filePath, `${where}.caveat`);
  return { engineStatus, caveat };
}
