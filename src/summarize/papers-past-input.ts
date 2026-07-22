/**
 * The Papers Past summarizer INPUT adapter (FR-019/FR-020/FR-021).
 *
 * A Papers Past source's reading text is its `ocr-text` asset -- a B2-resident
 * `text/plain` `<sha>.txt` the SSOT repository record points at, NOT an
 * `issue.txt` on disk. This module resolves that asset via the SHIPPED browser
 * resolver (`papersPastOcrAsset`, `src/browser/load/papers-past.ts`) rather than
 * re-encoding the `archive/papers-past/<id>/<sha>.txt` layout, ensures the
 * `.txt` is present locally (pre-fetching it from the CDN/B2 the same way
 * `scripts/build-snapshot.ts` does when it is absent from a fresh clone), and
 * returns it as a SINGLE English-only input layer honestly attributed to Papers
 * Past (`origin: 'papers-past-ocr'`, `sourceRepresentation: 'papers-past-text-tab'`).
 *
 * Fail-loud throughout: a missing OCR asset, an unfetchable `.txt` (no CDN base,
 * network failure, or non-200), or an empty/whitespace-only text all throw
 * naming the source + the missing asset -- never a fabricated or placeholder
 * layer (FR-020, Constitution V).
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256OfBytes } from '@/archive/checksum';
import type { LoadedSource } from '@/bibliography/load';
import { papersPastOcrAsset, type PapersPastOcrAsset } from '@/browser/load/papers-past';
import type { SelectedSummaryInput } from '@/summarize/select-input';

/**
 * Default CDN base fronting the B2 bucket for the OCR `.txt` pre-fetch, matching
 * `scripts/build-snapshot.ts`'s `DEFAULT_CDN_BASE` so the summarizer and the
 * snapshot builder reach the same shipped mechanism. Overridable via
 * `CORPUS_CDN_BASE` (or fully injected in tests).
 */
const DEFAULT_CDN_BASE = 'https://colony-cults-cdn.oletizi.workers.dev';

/** The minimal `fetch` response surface this adapter consumes (injectable in tests). */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/**
 * The CDN/B2 pre-fetch seam. `cdnBase` fronts the B2 bucket (the object-store
 * key IS the request path, mirroring `makeB2CdnProvider`); `undefined` means no
 * CDN is configured, so an absent `.txt` fails loud rather than being fetched.
 */
export interface PapersPastPrefetch {
  readonly cdnBase: string | undefined;
  readonly fetch: (url: string) => Promise<FetchResponseLike>;
}

/**
 * The default (real) pre-fetch: CDN base from `CORPUS_CDN_BASE` (falling back to
 * {@link DEFAULT_CDN_BASE}, as `build-snapshot` does) and the global `fetch`.
 * Fetching our OWN B2/CDN is not an external-source query (Constitution XII):
 * it is a single, bounded GET of a public-domain asset we already own.
 */
export function defaultPapersPastPrefetch(): PapersPastPrefetch {
  return {
    cdnBase: process.env.CORPUS_CDN_BASE?.trim() || DEFAULT_CDN_BASE,
    fetch: (url: string) => fetch(url),
  };
}

/**
 * Resolve the Papers Past `ocr-text` asset for `loaded`, ensure its `.txt` is
 * local (pre-fetching from the CDN/B2 when absent), read it, and return the
 * single English-only input layer attributed to Papers Past (FR-019/FR-021).
 */
export async function resolvePapersPastInput(
  loaded: LoadedSource,
  archiveRoot: string,
  prefetch: PapersPastPrefetch = defaultPapersPastPrefetch(),
): Promise<SelectedSummaryInput> {
  const sourceId = loaded.source.sourceId;
  const ocr = papersPastOcrAsset(loaded);
  const localPath = await ensureLocalOcr(archiveRoot, ocr, sourceId, prefetch);

  const bytes = await readFile(localPath);
  const text = bytes.toString('utf-8');
  if (text.trim().length === 0) {
    throw new Error(
      `selectSummaryInput(${sourceId}): Papers Past OCR text at ${localPath} ` +
        `(asset ${ocr.objectStoreKey}) is empty/whitespace-only -- a blank OCR layer ` +
        're-acquire the ocr-text asset before summarizing (FR-020, fail loud).',
    );
  }

  return {
    layers: [
      {
        // Archive-relative key (relative to archiveRoot, not the issue dir):
        // the same B2 object-store key the SSOT record points at.
        path: ocr.objectStoreKey,
        sha256: sha256OfBytes(bytes),
        origin: 'papers-past-ocr',
        sourceRepresentation: 'papers-past-text-tab',
      },
    ],
    text,
  };
}

/**
 * Return the absolute local path of the OCR `.txt`, pre-fetching it into the
 * archive worktree at `<archiveRoot>/<objectStoreKey>` when it is not already
 * present. Fail-loud (FR-020): no CDN base, a network failure, or a non-200
 * response all throw naming the source + the missing asset + how to fetch it.
 */
async function ensureLocalOcr(
  archiveRoot: string,
  ocr: PapersPastOcrAsset,
  sourceId: string,
  prefetch: PapersPastPrefetch,
): Promise<string> {
  const dest = path.join(archiveRoot, ocr.objectStoreKey);
  if (existsSync(dest)) {
    return dest;
  }

  const cdnBase = prefetch.cdnBase?.replace(/\/+$/, '');
  if (cdnBase === undefined || cdnBase.length === 0) {
    throw new Error(
      `selectSummaryInput(${sourceId}): Papers Past OCR text ${ocr.objectStoreKey} is not ` +
        `present at ${dest} and no CDN base is configured to pre-fetch it. Set CORPUS_CDN_BASE ` +
        '(or run "npm run site:snapshot") to fetch the B2-resident asset before summarizing ' +
        '(FR-020, fail loud).',
    );
  }

  const url = `${cdnBase}/${ocr.objectStoreKey}`;
  let response: FetchResponseLike;
  try {
    response = await prefetch.fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `selectSummaryInput(${sourceId}): Papers Past OCR pre-fetch failed for ${url} -- ` +
        `${message}. The asset ${ocr.objectStoreKey} could not be retrieved (FR-020, fail loud).`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `selectSummaryInput(${sourceId}): Papers Past OCR pre-fetch got HTTP ${response.status} ` +
        `for ${url} (asset ${ocr.objectStoreKey}).`,
    );
  }

  const body = await response.text();
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, body, 'utf-8');
  return dest;
}
