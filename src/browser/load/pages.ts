/**
 * Builds the ordered {@link RawPage}s of one issue and enforces the
 * page-count coherence guarantee (corpus-loader G-1): the image count, the
 * OCR form-feed segment count, and the translation-pair count MUST all agree,
 * else the build throws naming the source + issue. Per-page loading itself
 * fails loud (missing English / provenance -> throw naming the page: G-2/G-3),
 * and no placeholder is ever substituted (G-4).
 *
 * This module carries each page's image HANDLES (`folioId`, `ark`,
 * `objectStoreKey`, `imageSha256`) but does NOT resolve the {@link ImageDescriptor} -- that is
 * a separate step (`resolveImages`, `src/browser/load/resolve-images.ts`) so
 * the archive read and the snapshot read converge on one image-resolution path.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { RawPage } from '@/browser/model';
import { splitIssueOcr } from '@/browser/load/ocr-pages';
import { loadPageTranslation } from '@/browser/load/translation';
import type { IssueDir } from '@/browser/load/issues';

/**
 * `fNNN.yml` page-image SIDECAR (one per folio, carrying the object_store key).
 * Folios are enumerated from the sidecars, NOT the `fNNN.jpg` binaries: the
 * build never reads image bytes (images are resolved to Gallica/CDN URLs and
 * fetched client-side), and the archive drops the JPEGs (they live in B2). The
 * `.yml` sidecar survives that removal and holds everything enumeration needs.
 */
const IMAGE_PATTERN = /^f(\d+)\.yml$/;

/** `pNNN.en.txt` required-translation file. */
const EN_TRANSLATION_PATTERN = /^p(\d+)\.en\.txt$/;

/**
 * Detects whether `issueDir` is NOT-COLLECTED / incomplete: a WHOLE required
 * layer is ENTIRELY ABSENT (never acquired/processed), which the loader skips
 * and reports rather than throwing. The conditions (any one triggers a skip):
 *
 *  - no `issue.txt` (the OCR layer was never collected),
 *  - no `translation/` directory or one with zero `pNNN.en.txt` files (the
 *    English translation layer was never collected), or
 *  - zero `fNNN.yml` image sidecars (the image layer was never catalogued).
 *
 * A PRESENT-but-PARTIAL layer (e.g. 7 of 8 translation pairs, a single page's
 * English missing, an image/OCR skew) is NOT detected here -- that is a
 * collected-but-corrupt defect that {@link buildIssuePages} throws on.
 *
 * @returns a reason string naming the absent layer(s), or `null` when every
 *   required layer is present (the issue is complete enough to load).
 */
export function detectNotCollected(issueDir: string): string | null {
  const missing: string[] = [];

  if (!existsSync(path.join(issueDir, 'issue.txt'))) {
    missing.push('issue.txt (OCR layer)');
  }
  if (listFolios(issueDir).length === 0) {
    missing.push('image sidecars (fNNN.yml)');
  }
  if (countEnglishTranslations(issueDir) === 0) {
    missing.push('translation/ English layer (pNNN.en.txt)');
  }

  if (missing.length === 0) {
    return null;
  }
  return `not collected -- absent layer(s): ${missing.join(', ')}`;
}

/**
 * Builds every {@link RawPage} of `issue`, in page-number order. Carries each
 * page's image handles (`folioId`, `ark`, `objectStoreKey`) but does not
 * resolve the image -- that is `resolveImages`' job.
 *
 * @throws Error naming source + issue when the image / OCR / translation
 *   counts disagree (G-1).
 * @throws Error naming source / issue / page when a page's English text or
 *   provenance is missing (G-2/G-3, via {@link loadPageTranslation}).
 */
export function buildRawIssuePages(
  sourceId: string,
  issue: IssueDir
): RawPage[] {
  const folios = listFolios(issue.dir);
  const sidecarCount = folios.length;

  const issueTextPath = path.join(issue.dir, 'issue.txt');
  if (!existsSync(issueTextPath)) {
    throw new Error(
      `loadCorpus(${sourceId} / ${issue.issueId}): missing issue OCR file ${issueTextPath}.`
    );
  }
  const ocrSegments = splitIssueOcr(readFileSync(issueTextPath, 'utf-8'));
  const ocrCount = ocrSegments.length;

  if (sidecarCount !== ocrCount) {
    throw new Error(
      `loadCorpus(${sourceId} / ${issue.issueId}): page-count mismatch (corpus-loader G-1) -- ` +
        `${sidecarCount} image sidecar(s) vs ${ocrCount} OCR segment(s). ` +
        'The image-sidecar count and OCR form-feed segment count must be equal.'
    );
  }

  const translationCount = countEnglishTranslations(issue.dir);
  const pageCount = sidecarCount;

  const pages: RawPage[] = folios.map((folio, index) =>
    buildRawPage(sourceId, issue, folio, ocrSegments[index])
  );

  if (translationCount !== pageCount) {
    throw new Error(
      `loadCorpus(${sourceId} / ${issue.issueId}): page-count mismatch (corpus-loader G-1) -- ` +
        `${pageCount} page(s) vs ${translationCount} English translation file(s). ` +
        'Every page must have exactly one translation pair.'
    );
  }

  return pages;
}

interface Folio {
  /** The folio id / filename stem, e.g. `f003`. */
  folioId: string;
  /** The numeric part, e.g. `3`. */
  num: number;
}

/** Lists folios (from `fNNN.yml` sidecars) in the issue directory, ordered by page number. */
function listFolios(issueDir: string): Folio[] {
  const folios: Folio[] = [];
  for (const name of readdirSync(issueDir)) {
    const match = IMAGE_PATTERN.exec(name);
    if (match === null) {
      continue;
    }
    folios.push({ folioId: path.basename(name, '.yml'), num: Number.parseInt(match[1], 10) });
  }
  folios.sort((a, b) => a.num - b.num);
  return folios;
}

/** Counts `pNNN.en.txt` files in the issue's `translation/` directory. */
function countEnglishTranslations(issueDir: string): number {
  const translationDir = path.join(issueDir, 'translation');
  if (!existsSync(translationDir)) {
    return 0;
  }
  return readdirSync(translationDir).filter((name) => EN_TRANSLATION_PATTERN.test(name)).length;
}

/**
 * Builds a single {@link RawPage} for `folio`, pairing its OCR segment with
 * the translation + provenance sidecar and reading its image handles (the
 * image itself is resolved later by `resolveImages`).
 */
function buildRawPage(
  sourceId: string,
  issue: IssueDir,
  folio: Folio,
  ocr: { ocrFrench: string; ocrCondition: string | null }
): RawPage {
  const pageId = `p${String(folio.num).padStart(3, '0')}`;

  const translation = loadPageTranslation(issue.dir, pageId, issue.date);

  const { objectStoreKey, imageSha256 } = readFolioImageMeta(issue.dir, folio.folioId);

  // The page's provenance ark is the ISSUE ark; assert the sidecar agrees so
  // a cross-wired sidecar cannot slip a mismatched handle into the rail.
  if (translation.provenance.ark !== issue.ark) {
    throw new Error(
      `loadCorpus(${sourceId} / ${issue.issueId} / ${pageId}): provenance ark ` +
        `${JSON.stringify(translation.provenance.ark)} does not match the issue ark ` +
        `${JSON.stringify(issue.ark)}.`
    );
  }

  return {
    pageId,
    folioId: folio.folioId,
    ark: issue.ark,
    objectStoreKey,
    imageSha256,
    ocrFrench: ocr.ocrFrench,
    correctedFrench: translation.correctedFrench,
    english: translation.english,
    ocrCondition: ocr.ocrCondition,
    provenance: translation.provenance,
  };
}

/** The image handles read from a page's `fNNN.yml` folio sidecar. */
interface FolioImageMeta {
  /** The `object_store.key` (B2 master key), or `null` when the sidecar/field is absent. */
  objectStoreKey: string | null;
  /**
   * The top-level `sha256` -- the IMAGE-MASTER checksum (matches the B2 object),
   * NOT the translation-text hash carried in the provenance rail. `null` when
   * the sidecar/field is absent.
   */
  imageSha256: string | null;
}

/**
 * Reads a page's `fNNN.yml` sidecar and returns both image handles: the
 * `object_store.key` and the top-level `sha256` (the image-master checksum).
 * Absent sidecar / fields yield `null` handles -- the `source-iiif` provider
 * ignores them, and their absence is not a load-time defect for the active
 * provider, so this does not throw. The PDF `b2-cdn` fetch consumes
 * {@link FolioImageMeta.imageSha256} to verify the fetched master bytes.
 */
function readFolioImageMeta(issueDir: string, folioId: string): FolioImageMeta {
  const sidecarPath = path.join(issueDir, `${folioId}.yml`);
  if (!existsSync(sidecarPath)) {
    return { objectStoreKey: null, imageSha256: null };
  }

  const parsed: unknown = parseYaml(readFileSync(sidecarPath, 'utf-8'));
  if (!isRecord(parsed)) {
    return { objectStoreKey: null, imageSha256: null };
  }

  const objectStore = parsed.object_store;
  const key = isRecord(objectStore) ? objectStore.key : undefined;
  const objectStoreKey =
    typeof key === 'string' && key.trim().length > 0 ? key : null;

  const sha = parsed.sha256;
  const imageSha256 = typeof sha === 'string' && sha.trim().length > 0 ? sha : null;

  return { objectStoreKey, imageSha256 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
