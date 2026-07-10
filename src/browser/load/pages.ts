/**
 * Builds the ordered {@link PageView}s of one issue and enforces the
 * page-count coherence guarantee (corpus-loader G-1): the image count, the
 * OCR form-feed segment count, and the translation-pair count MUST all agree,
 * else the build throws naming the source + issue. Per-page loading itself
 * fails loud (missing English / provenance -> throw naming the page: G-2/G-3),
 * and no placeholder is ever substituted (G-4).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { ImageDescriptor, PageView } from '@/browser/model';
import type { ImageSourceProvider } from '@/browser/providers/provider';
import { splitIssueOcr } from '@/browser/load/ocr-pages';
import { loadPageTranslation } from '@/browser/load/translation';
import type { IssueDir } from '@/browser/load/issues';

/** `fNNN.jpg` page-image file. */
const IMAGE_PATTERN = /^f(\d+)\.jpg$/;

/** `pNNN.en.txt` required-translation file. */
const EN_TRANSLATION_PATTERN = /^p(\d+)\.en\.txt$/;

/**
 * Builds every {@link PageView} of `issue`, in page-number order, resolving
 * each image through `provider`.
 *
 * @throws Error naming source + issue when the image / OCR / translation
 *   counts disagree (G-1).
 * @throws Error naming source / issue / page when a page's English text or
 *   provenance is missing (G-2/G-3, via {@link loadPageTranslation}).
 */
export function buildIssuePages(
  sourceId: string,
  issue: IssueDir,
  provider: ImageSourceProvider
): PageView[] {
  const folios = listFolios(issue.dir);
  const imageCount = folios.length;

  const issueTextPath = path.join(issue.dir, 'issue.txt');
  if (!existsSync(issueTextPath)) {
    throw new Error(
      `loadCorpus(${sourceId} / ${issue.issueId}): missing issue OCR file ${issueTextPath}.`
    );
  }
  const ocrSegments = splitIssueOcr(readFileSync(issueTextPath, 'utf-8'));
  const ocrCount = ocrSegments.length;

  if (imageCount !== ocrCount) {
    throw new Error(
      `loadCorpus(${sourceId} / ${issue.issueId}): page-count mismatch (corpus-loader G-1) -- ` +
        `${imageCount} page image(s) vs ${ocrCount} OCR segment(s). ` +
        'The image count and OCR form-feed segment count must be equal.'
    );
  }

  const translationCount = countEnglishTranslations(issue.dir);
  const pageCount = imageCount;

  const pages: PageView[] = folios.map((folio, index) =>
    buildPage(sourceId, issue, provider, folio, ocrSegments[index])
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

/** Lists `fNNN.jpg` folios in the issue directory, ordered by page number. */
function listFolios(issueDir: string): Folio[] {
  const folios: Folio[] = [];
  for (const name of readdirSync(issueDir)) {
    const match = IMAGE_PATTERN.exec(name);
    if (match === null) {
      continue;
    }
    folios.push({ folioId: path.basename(name, '.jpg'), num: Number.parseInt(match[1], 10) });
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
 * Builds a single {@link PageView} for `folio`, pairing its OCR segment with
 * the translation + provenance sidecar and resolving its image.
 */
function buildPage(
  sourceId: string,
  issue: IssueDir,
  provider: ImageSourceProvider,
  folio: Folio,
  ocr: { ocrFrench: string; ocrCondition: string | null }
): PageView {
  const pageId = `p${String(folio.num).padStart(3, '0')}`;

  const translation = loadPageTranslation(issue.dir, pageId, issue.date);

  const objectStoreKey = readObjectStoreKey(issue.dir, folio.folioId);
  const image: ImageDescriptor = provider.resolve({
    ark: issue.ark,
    folioId: folio.folioId,
    objectStoreKey,
  });

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
    image,
    ocrFrench: ocr.ocrFrench,
    correctedFrench: translation.correctedFrench,
    english: translation.english,
    provenance: translation.provenance,
    ocrCondition: ocr.ocrCondition,
  };
}

/**
 * Reads the `object_store.key` from a page's `fNNN.yml` sidecar, or `null`
 * when the sidecar or field is absent. The `source-iiif` provider ignores it;
 * `b2-cdn` (T027) requires it -- but its absence is not a load-time defect for
 * the active provider, so this does not throw.
 */
function readObjectStoreKey(issueDir: string, folioId: string): string | null {
  const sidecarPath = path.join(issueDir, `${folioId}.yml`);
  if (!existsSync(sidecarPath)) {
    return null;
  }

  const parsed: unknown = parseYaml(readFileSync(sidecarPath, 'utf-8'));
  if (!isRecord(parsed)) {
    return null;
  }
  const objectStore = parsed.object_store;
  if (!isRecord(objectStore)) {
    return null;
  }
  const key = objectStore.key;
  return typeof key === 'string' && key.trim().length > 0 ? key : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
