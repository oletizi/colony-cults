/**
 * Per-issue read/parse/path helpers for the `pdf:publish` orchestrator (spec
 * 008-edition-publishing, extended by spec 015-english-source-pdf). These read
 * the facts confirm + reconcile both need from a built issue's
 * `<issueId>.input.json` (page count + the edition's provenance disclosure,
 * data-model §3) and derive the filesystem paths the flow anchors on.
 * Extracted from `publish.ts` (Constitution VII, <=500 lines). Every parse
 * throws with a locating message; the mode runners catch per-issue and record
 * the throw as an attributable failure (G-7).
 *
 * A built issue carries EXACTLY ONE of two provenance disclosures (spec 015,
 * `ColophonMeta`): a French-source edition's `machineAssist` translation label
 * (`pages[0].recto.machineAssist`, unchanged since spec 008) or an
 * English-source edition's `ocrTranscription` disclosure (`colophon
 * .ocrTranscription` -- the edition-level source of truth; no per-page recto
 * field carries it, per `@/pdf/render/typst-input`'s `TypstRecto`).
 * `readIssueBuildInfo` ENFORCES this exactly-one invariant: it fails loud
 * when NEITHER is present -- a publication with no provenance disclosure at
 * all is a genuine gap (AUDIT-20260719-02) -- and when BOTH are present -- a
 * built edition is exactly one kind, never both (AUDIT-20260719-04/05).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';

/** True for a plain JSON object (used to narrow the parsed build input.json). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Non-empty-string guard with a locating throw. */
function requireNonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${where} must be a non-empty string`);
  }
  return value;
}

/**
 * The facts read from a built issue's `<issueId>.input.json` (data-model §3,
 * extended by spec 015). EXACTLY ONE of `machineAssist` / `ocrTranscription`
 * is non-null on any real edition -- `readIssueBuildInfo` throws if both are
 * absent AND if both are present (AUDIT-20260719-04/05); either being
 * individually absent (with the other present) is the normal, tolerated case.
 */
export interface IssueBuildInfo {
  /** Page count from `input.json` `.pages.length`, NOT parsed from PDF bytes. */
  pages: number;
  /**
   * The machine-assisted-translation label carried on every page's recto
   * (French-source edition), or `null` for an English-source edition (spec
   * 015 FR-013).
   */
  machineAssist: MachineAssistLabel | null;
  /**
   * The OCR-transcription disclosure carried on the edition's colophon
   * (English-source edition), or `null` for a French-source edition (spec 015
   * FR-008/FR-013).
   */
  ocrTranscription: OcrTranscription | null;
}

/** Parse a `MachineAssistLabel` out of the build input.json's `recto.machineAssist`. */
function parseMachineAssist(value: unknown, where: string): MachineAssistLabel {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`);
  }
  const engine = requireNonEmptyString(value.engine, `${where}.engine`);
  const retrieved = requireNonEmptyString(value.retrieved, `${where}.retrieved`);
  const rawModel = value.model;
  if (rawModel !== null && rawModel !== undefined && typeof rawModel !== 'string') {
    throw new Error(`${where}.model must be a string or null`);
  }
  const model = typeof rawModel === 'string' ? rawModel : null;
  return { engine, model, retrieved };
}

/** `parseMachineAssist`, tolerating an absent (`null`/`undefined`) value (English-source). */
function parseNullableMachineAssist(value: unknown, where: string): MachineAssistLabel | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parseMachineAssist(value, where);
}

/** Parse an `OcrTranscription` out of the build input.json's `colophon.ocrTranscription`. */
function parseOcrTranscription(value: unknown, where: string): OcrTranscription {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`);
  }
  const engineStatus = requireNonEmptyString(value.engineStatus, `${where}.engineStatus`);
  const rawCaveat = value.caveat;
  if (rawCaveat !== null && rawCaveat !== undefined && typeof rawCaveat !== 'string') {
    throw new Error(`${where}.caveat must be a string or null`);
  }
  const caveat = typeof rawCaveat === 'string' ? rawCaveat : null;
  return { engineStatus, caveat };
}

/** `parseOcrTranscription`, tolerating an absent (`null`/`undefined`) value (French-source). */
function parseNullableOcrTranscription(value: unknown, where: string): OcrTranscription | null {
  if (value === null || value === undefined) {
    return null;
  }
  return parseOcrTranscription(value, where);
}

/**
 * Read the built issue's page count + provenance disclosure from its
 * `<issueId>.input.json` (a serialized `TypstInput`, written next to the PDF by
 * `pdf:build`). Throws (missing file, malformed shape, NEITHER disclosure
 * present, or BOTH disclosures present) -- the caller catches per-issue and
 * records it as an attributable failure (G-7).
 */
export function readIssueBuildInfo(inputJsonPath: string): IssueBuildInfo {
  const parsed: unknown = JSON.parse(readFileSync(inputJsonPath, 'utf-8'));
  if (!isRecord(parsed)) {
    throw new Error(`${inputJsonPath}: build input.json is not a JSON object`);
  }
  const pages = parsed.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`${inputJsonPath}: "pages" must be a non-empty array (build input.json)`);
  }
  const first = pages[0];
  if (!isRecord(first) || !isRecord(first.recto)) {
    throw new Error(`${inputJsonPath}: pages[0].recto must be an object (build input.json)`);
  }
  const machineAssist = parseNullableMachineAssist(
    first.recto.machineAssist,
    `${inputJsonPath}: pages[0].recto.machineAssist`,
  );

  // The OCR-transcription disclosure lives only at the edition-level colophon
  // (spec 015) -- no per-page recto field carries it. `colophon` is optional
  // here (older/synthetic fixtures predate it); its absence is not itself a
  // failure as long as `machineAssist` is present.
  const colophon = parsed.colophon;
  const ocrTranscription = isRecord(colophon)
    ? parseNullableOcrTranscription(
        colophon.ocrTranscription,
        `${inputJsonPath}: colophon.ocrTranscription`,
      )
    : null;

  if (machineAssist !== null && ocrTranscription !== null) {
    throw new Error(
      `${inputJsonPath}: carries BOTH a machineAssist label ` +
        `(pages[0].recto.machineAssist) and an ocrTranscription disclosure ` +
        `(colophon.ocrTranscription) -- a built edition is EXACTLY ONE kind (a ` +
        `French machine-assisted translation XOR an English OCR transcription); ` +
        `refusing to read a build input.json with two conflicting provenance ` +
        `disclosures (AUDIT-20260719-04/05).`,
    );
  }

  if (machineAssist === null && ocrTranscription === null) {
    throw new Error(
      `${inputJsonPath}: carries neither a machineAssist label ` +
        `(pages[0].recto.machineAssist) nor an ocrTranscription disclosure ` +
        `(colophon.ocrTranscription) -- every published edition must disclose ` +
        `either a machine-assisted translation (French) or an OCR transcription ` +
        `(English); refusing to publish with no provenance disclosure.`,
    );
  }

  return { pages: pages.length, machineAssist, ocrTranscription };
}

/** Derive a built issue's `input.json` path from its `<issueId>.pdf` path. */
export function inputJsonPathFor(pdfPath: string, issueId: string): string {
  return path.join(path.dirname(pdfPath), `${issueId}.input.json`);
}

/** The `<sourceId>.yml` path under the physical sources dir. */
export function sourceFilePath(sourcesDir: string, sourceId: string): string {
  return path.join(sourcesDir, `${sourceId}.yml`);
}
