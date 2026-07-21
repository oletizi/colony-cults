/**
 * Loads a single page's translation text + provenance from an issue
 * directory's `translation/` subdirectory.
 *
 * Layout (see specs/005-corpus-browser/data-model.md "Translation pairing"
 * and specs/005-corpus-browser/contracts/corpus-loader.md G-2/G-3):
 *
 *   translation/pNNN.en.txt      -- English translation (required layer)
 *   translation/pNNN.fr.txt      -- corrected French (optional layer)
 *   translation/pNNN.fr.txt.yml  -- provenance sidecar (preferred)
 *   translation/pNNN.en.txt.yml  -- provenance sidecar (fallback when the
 *                                   fr sidecar is absent)
 *
 * Fail-loud: a missing `english` file or an incomplete provenance sidecar
 * throws naming the missing piece -- there is no fallback or placeholder
 * substitution (corpus-loader G-4).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { MachineAssistLabel, ProvenanceRecord } from '@/browser/model';
import { parseSourceIdentifier } from '@/browser/load/source-identifier';

/** One page's translation text + provenance, as loaded from `translation/`. */
export interface PageTranslation {
  /** Corrected French (`pNNN.fr.txt`), or `null` when that optional file is absent. */
  correctedFrench: string | null;
  /** English translation (`pNNN.en.txt`); always present -- a missing file throws. */
  english: string;
  /** The provenance-rail facts, assembled from the sidecar + `sourceDate`. */
  provenance: ProvenanceRecord;
}

/**
 * Loads `pageId`'s translation text and provenance from `issueDir`.
 *
 * @param issueDir - absolute path to the issue directory (containing `translation/`).
 * @param pageId - the page identifier, e.g. `p001`.
 * @param sourceDate - the issue's ISO date, used verbatim as `provenance.date`
 *   (the sidecar does not carry a per-page date; it is issue-level).
 *
 * @throws Error if `translation/<pageId>.en.txt` is missing (required layer).
 * @throws Error if neither `<pageId>.fr.txt.yml` nor `<pageId>.en.txt.yml`
 *   exists, or if the sidecar that does exist is missing a required
 *   provenance field or an unparseable ark (corpus-loader G-3).
 */
export function loadPageTranslation(
  issueDir: string,
  pageId: string,
  sourceDate: string
): PageTranslation {
  const translationDir = path.join(issueDir, 'translation');

  const english = readRequiredText(
    path.join(translationDir, `${pageId}.en.txt`),
    `loadPageTranslation: required English translation is missing for page "${pageId}" in ${issueDir}`
  );

  const frenchPath = path.join(translationDir, `${pageId}.fr.txt`);
  const correctedFrench = existsSync(frenchPath) ? readFileSync(frenchPath, 'utf-8') : null;

  const sidecarPath = resolveSidecarPath(translationDir, pageId);
  const provenance = loadProvenance(sidecarPath, pageId, sourceDate);

  // The machine-assist label describes the ENGLISH translation, so it is read
  // from the EN sidecar specifically (not the fr-preferred provenance sidecar).
  // Absent/label-less EN sidecar -> no label (honest absence, not fabricated).
  const machineAssist = loadMachineAssist(translationDir, pageId);
  const provenanceWithLabel: ProvenanceRecord =
    machineAssist === null ? provenance : { ...provenance, machineAssist };

  return { correctedFrench, english, provenance: provenanceWithLabel };
}

function readRequiredText(filePath: string, missingMessage: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`${missingMessage} (expected ${filePath})`);
  }
  return readFileSync(filePath, 'utf-8');
}

/**
 * Prefers the `.fr.txt.yml` sidecar; falls back to `.en.txt.yml` when the fr
 * sidecar is absent (a page may have no corrected French but still needs
 * provenance). Throws if neither exists.
 */
function resolveSidecarPath(translationDir: string, pageId: string): string {
  const frSidecarPath = path.join(translationDir, `${pageId}.fr.txt.yml`);
  if (existsSync(frSidecarPath)) {
    return frSidecarPath;
  }

  const enSidecarPath = path.join(translationDir, `${pageId}.en.txt.yml`);
  if (existsSync(enSidecarPath)) {
    return enSidecarPath;
  }

  throw new Error(
    `loadPageTranslation: no provenance sidecar found for page "${pageId}" -- ` +
      `expected ${frSidecarPath} or ${enSidecarPath}`
  );
}

function loadProvenance(sidecarPath: string, pageId: string, sourceDate: string): ProvenanceRecord {
  const raw = readFileSync(sidecarPath, 'utf-8');
  const parsed: unknown = parse(raw);

  if (!isRecord(parsed)) {
    throw new Error(
      `loadPageTranslation: sidecar ${sidecarPath} did not parse to a YAML mapping`
    );
  }

  const sourceId = requireStringField(parsed, 'id', sidecarPath);
  const catalogUrl = requireStringField(parsed, 'catalog_url', sidecarPath);
  const rights = requireStringField(parsed, 'rights_status', sidecarPath);
  const sha256 = requireStringField(parsed, 'sha256', sidecarPath);
  const ark = parseSourceIdentifier(catalogUrl);

  return {
    sourceId,
    ark,
    date: sourceDate,
    rights,
    page: pageId,
    sha256,
  };
}

/**
 * Reads the machine-assisted-translation label (`engine` / `model` /
 * `retrieved`) from the page's EN sidecar (`translation/<pageId>.en.txt.yml`).
 *
 * Additive + honest-absence: returns `null` (no label) when the EN sidecar is
 * absent, does not parse to a mapping, or lacks `engine`/`retrieved` -- it does
 * NOT throw and does NOT fabricate values. `model` is optional (string|null).
 */
function loadMachineAssist(translationDir: string, pageId: string): MachineAssistLabel | null {
  const enSidecarPath = path.join(translationDir, `${pageId}.en.txt.yml`);
  if (!existsSync(enSidecarPath)) {
    return null;
  }

  const parsed: unknown = parse(readFileSync(enSidecarPath, 'utf-8'));
  if (!isRecord(parsed)) {
    return null;
  }

  const engine = optionalStringField(parsed, 'engine');
  const retrieved = optionalStringField(parsed, 'retrieved');
  if (engine === null || retrieved === null) {
    // Without both engine and retrieved there is no honest label to carry.
    return null;
  }

  return { engine, model: optionalStringField(parsed, 'model'), retrieved };
}

/** A non-empty string field, or `null` when the field is absent/blank/non-string. */
function optionalStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringField(
  record: Record<string, unknown>,
  field: string,
  sidecarPath: string
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `loadPageTranslation: sidecar ${sidecarPath} is missing required field "${field}"`
    );
  }
  return value;
}
