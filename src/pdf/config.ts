/**
 * Env-only configuration for the PDF facsimile-edition build (mirrors
 * `src/browser/config.ts`). All values are sourced from environment
 * variables; the only baked-in defaults are the output directory (a build
 * destination, not a data source) and the snapshot directory (shared with
 * the browser build -- see `src/browser/config.ts`). Every other value is
 * either required or fails loud.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '@/browser/load/repo-root';

/** Default output directory (relative to the repo root) when PDF_OUT_DIR is unset. */
const DEFAULT_OUT_DIR = 'build/pdf';

/**
 * Default snapshot directory (relative to the repo root) when
 * PDF_SNAPSHOT_DIR is unset. Matches `src/browser/config.ts`'s default --
 * the PDF build and the browser build read the same committed snapshot.
 */
const DEFAULT_SNAPSHOT_DIR = 'site/data';

/** Filename of the pinned-archive-commit sidecar inside the snapshot dir. */
const PIN_FILE_NAME = 'archive-source.json';

/**
 * Selects which image provider resolves page image bytes for the PDF build
 * (FR/G-1 in specs/007-corpus-print-pdf; dependency injection, no
 * inheritance). `b2` is the default (Backblaze B2 object store, the
 * corpus's canonical image store); `iiif` fetches from the source IIIF
 * endpoint instead.
 */
export type PdfImageProviderKind = 'b2' | 'iiif';

/**
 * The configuration required to build the PDF facsimile edition.
 */
export interface PdfConfig {
  /**
   * Where rendered PDFs (and intermediate Typst sources) are written.
   * Absolute, or relative to the repo root. Defaults to `build/pdf`.
   */
  outDir: string;
  /** Which image provider resolves page image bytes. */
  imageProvider: PdfImageProviderKind;
  /**
   * Where the committed public-domain snapshot lives (one
   * `<sourceId>.json.gz` per source, plus the pin sidecar). Absolute, or
   * relative to the repo root. Defaults to `site/data`.
   */
  snapshotDir: string;
  /** Absolute path to the pin sidecar (`<snapshotDir>/archive-source.json`). */
  pinFile: string;
  /**
   * Whether the recto renders the French OCR beside the English translation.
   * `true` (default) is the two-column parallel *study* edition; `false` is
   * the single-column English-only *reading* edition (DESIGN.md § "Variant:
   * English-only recto"). A RENDER toggle only -- the edition builder still
   * requires per-page english + ocrFrench in either mode. Sourced from
   * `PDF_SHOW_FRENCH` (`"false"`/`"0"` -> false; unset/`"true"`/`"1"` -> true).
   */
  showFrench: boolean;
}

/**
 * Resolves the PdfConfig from environment variables.
 *
 * @param env - Environment variables (defaults to process.env)
 * @returns PdfConfig ready for the PDF build
 * @throws Error if PDF_IMAGE_PROVIDER is set to a value other than "b2" or "iiif"
 */
export function resolvePdfConfig(env: NodeJS.ProcessEnv = process.env): PdfConfig {
  const outDirRaw = env.PDF_OUT_DIR?.trim();
  const outDir = outDirRaw ? outDirRaw : DEFAULT_OUT_DIR;

  const imageProviderRaw = env.PDF_IMAGE_PROVIDER?.trim() ?? 'b2';
  if (imageProviderRaw !== 'b2' && imageProviderRaw !== 'iiif') {
    throw new Error(
      `Unknown PDF_IMAGE_PROVIDER value: "${imageProviderRaw}". ` +
        'Expected one of: "b2" (default), "iiif".'
    );
  }
  const imageProvider: PdfImageProviderKind = imageProviderRaw;

  const snapshotDirRaw = env.PDF_SNAPSHOT_DIR?.trim();
  const snapshotDir = snapshotDirRaw ? snapshotDirRaw : DEFAULT_SNAPSHOT_DIR;

  const snapshotDirAbs = path.isAbsolute(snapshotDir)
    ? snapshotDir
    : path.join(resolveRepoRoot(), snapshotDir);
  const pinFile = path.join(snapshotDirAbs, PIN_FILE_NAME);

  const showFrench = resolveShowFrench(env.PDF_SHOW_FRENCH?.trim());

  return { outDir, imageProvider, snapshotDir, pinFile, showFrench };
}

/**
 * Resolves the `showFrench` recto toggle from the raw `PDF_SHOW_FRENCH` value.
 * Default (unset/empty) is `true` (the two-column parallel edition). `"false"`
 * / `"0"` select the English-only recto; `"true"` / `"1"` are the explicit
 * default. Any other value fails loud (no silent coercion -- Principle III).
 */
function resolveShowFrench(raw: string | undefined): boolean {
  if (raw === undefined || raw.length === 0) {
    return true;
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  throw new Error(
    `Unknown PDF_SHOW_FRENCH value: "${raw}". ` +
      'Expected one of: "true"/"1" (default) or "false"/"0".'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads + parses the pin sidecar (`<snapshotDir>/archive-source.json`) and
 * returns its `ref` -- the pinned archive commit the committed snapshot(s)
 * were generated from (see `site/README.md`). Fail-loud: throws a
 * descriptive error if the file is missing, is not valid JSON, is not an
 * object, or lacks a non-empty `ref` field -- no fallback to an
 * unpinned/"latest" build.
 *
 * @param config - A PdfConfig (or the `pinFile` field of one)
 * @throws Error if the pin file is missing, unparseable, or lacks a non-empty `ref`
 */
export function resolveArchiveRef(config: Pick<PdfConfig, 'pinFile'>): string {
  const { pinFile } = config;

  if (!existsSync(pinFile)) {
    throw new Error(
      `resolveArchiveRef: pin file not found at ${pinFile}. Expected the committed ` +
        'archive-source.json sidecar (see site/README.md) -- run "npm run snapshot" to generate it.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pinFile, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`resolveArchiveRef: ${pinFile} is not valid JSON -- ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `resolveArchiveRef: expected an object at ${pinFile}, got ${
        parsed === null ? 'null' : typeof parsed
      }.`
    );
  }

  const ref = parsed.ref;
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    throw new Error(
      `resolveArchiveRef: ${pinFile} is missing a non-empty "ref" field (the pinned archive commit).`
    );
  }

  return ref;
}
