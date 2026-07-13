/**
 * Per-issue read/parse/path helpers for the `pdf:publish` orchestrator (spec
 * 008-edition-publishing). These read the two facts confirm + reconcile both
 * need from a built issue's `<issueId>.input.json` (page count + machine-assist
 * label, data-model §3) and derive the filesystem paths the flow anchors on.
 * Extracted from `publish.ts` (Constitution VII, <=500 lines). Every parse
 * throws with a locating message; the mode runners catch per-issue and record
 * the throw as an attributable failure (G-7).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { MachineAssistLabel } from '@/pdf/model';

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

/** The two facts read from a built issue's `<issueId>.input.json` (data-model §3). */
export interface IssueBuildInfo {
  /** Page count from `input.json` `.pages.length`, NOT parsed from PDF bytes. */
  pages: number;
  /** Machine-assist label carried on every page's recto (colophon translation). */
  machineAssist: MachineAssistLabel;
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

/**
 * Read the built issue's page count + machine-assist label from its
 * `<issueId>.input.json` (a serialized `TypstInput`, written next to the PDF by
 * `pdf:build`). Throws (missing file, malformed shape) -- the caller catches
 * per-issue and records it as an attributable failure (G-7).
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
  const machineAssist = parseMachineAssist(
    first.recto.machineAssist,
    `${inputJsonPath}: pages[0].recto.machineAssist`,
  );
  return { pages: pages.length, machineAssist };
}

/** Derive a built issue's `input.json` path from its `<issueId>.pdf` path. */
export function inputJsonPathFor(pdfPath: string, issueId: string): string {
  return path.join(path.dirname(pdfPath), `${issueId}.input.json`);
}

/** The `<sourceId>.yml` path under the physical sources dir. */
export function sourceFilePath(sourcesDir: string, sourceId: string): string {
  return path.join(sourcesDir, `${sourceId}.yml`);
}
