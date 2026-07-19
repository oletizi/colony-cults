/**
 * Validator for a `Publication`'s `ocrTranscription` disclosure (spec
 * 015-english-source-pdf, FR-008/FR-013) -- the English-source honest sibling
 * of `machineAssist` (`@/bibliography/load`'s `validateMachineAssist`),
 * recorded INSTEAD OF it on a publication (never both). Also carries
 * {@link assertExactlyOneProvenanceDisclosure}, `load.ts`'s OWN enforcement
 * of the exactly-one invariant (AUDIT-20260719-03/04). Extracted to its own
 * module to keep `load.ts` under the Constitution VII 500-line cap, mirroring
 * `load-fields.ts` / `load-coverage-fields.ts`'s companion-module pattern.
 */

import { assertKnownKeys, fail, requireObject, requireString } from '@/bibliography/load-primitives';
import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';

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

/**
 * Enforce the load-boundary provenance-disclosure invariant (spec 015
 * FR-008/FR-013; AUDIT-20260719-03/04): a `publications[]` entry carries
 * EXACTLY ONE of `machineAssist` (French machine-assisted translation) XOR
 * `ocrTranscription` (English OCR transcription) -- never both (two
 * conflicting provenance stories) and never neither (Constitution III/IV: no
 * publication with zero provenance disclosure).
 *
 * This is `load.ts`'s OWN enforcement of the invariant -- `load.ts` is a
 * DISTINCT deserialization path for hand-authored SSOT files and its records
 * do not necessarily transit `buildPublication` (`@/pdf/publish/record`), so
 * it must not defer to that boundary's check (AUDIT-20260719-03).
 */
export function assertExactlyOneProvenanceDisclosure(
  machineAssist: MachineAssistLabel | undefined,
  ocrTranscription: OcrTranscription | undefined,
  filePath: string,
  where: string,
): void {
  const hasMachineAssist = machineAssist !== undefined;
  const hasOcrTranscription = ocrTranscription !== undefined;
  if (hasMachineAssist && hasOcrTranscription) {
    fail(
      filePath,
      `${where} carries BOTH machineAssist and ocrTranscription -- these are ` +
        `mutually exclusive provenance disclosures (a French machine-assisted ` +
        `translation XOR an English OCR transcription); refusing to load a ` +
        `publication with two conflicting provenance stories.`,
    );
  }
  if (!hasMachineAssist && !hasOcrTranscription) {
    fail(
      filePath,
      `${where} carries NEITHER machineAssist nor ocrTranscription -- every ` +
        `publication must disclose exactly one provenance story (Constitution ` +
        `III/IV); refusing to load a publication with zero provenance disclosure.`,
    );
  }
}
