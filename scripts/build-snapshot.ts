/**
 * scripts/build-snapshot.ts
 *
 * Exports the committed public-domain corpus SNAPSHOT the Astro site builds
 * from when no private archive clone is available (e.g. on Netlify). Reads the
 * archive via `readRawCorpus` and writes one `site/data/<sourceId>.json` per
 * source -- the serializable {@link CorpusSnapshot} (text + metadata + image
 * handles), with deterministic (sorted) key order so re-runs are diff-friendly.
 *
 * The corpus is public-domain, so these files are committed to the repo. The
 * snapshot carries only what the build renders; the bloated redundant
 * `rights_raw` archive XML is not part of the corpus model, so it is absent by
 * construction (never read, never written).
 *
 * Usage:
 *   CORPUS_ARCHIVE_PATH=/path/to/colony-cults-archive npm run site:snapshot
 *
 * Regenerate + commit whenever the corpus changes (see site/README.md).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveConfig } from '@/browser/config';
import { loadSourceFile } from '@/bibliography/load';
import { readRawCorpus } from '@/browser/load/raw-corpus';
import { isPapersPastSource, papersPastOcrAsset } from '@/browser/load/papers-past';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { snapshotFilePath, writeSnapshotFile } from '@/browser/load/snapshot';

/** Default CDN base for the B2-resident OCR pre-fetch when CORPUS_CDN_BASE is unset. */
const DEFAULT_CDN_BASE = 'https://colony-cults-cdn.oletizi.workers.dev';

async function main(): Promise<void> {
  const config = resolveConfig();

  if (config.archivePath === undefined || !existsSync(config.archivePath)) {
    throw new Error(
      'site:snapshot requires a readable archive clone. Set CORPUS_ARCHIVE_PATH to the local ' +
        'archive clone (e.g. /Users/orion/work/colony-cults-archive). ' +
        `Current value: ${config.archivePath ?? 'unset'}.`
    );
  }
  const archivePath = config.archivePath;

  const repoRoot = resolveRepoRoot();
  const snapshotDir = path.isAbsolute(config.snapshotDir)
    ? config.snapshotDir
    : path.join(repoRoot, config.snapshotDir);

  mkdirSync(snapshotDir, { recursive: true });

  // Pre-fetch every requested Papers Past source's B2-resident OCR .txt from
  // the CDN into the archive worktree BEFORE readRawCorpus, so the (synchronous)
  // clipping loader can read it from a local file. Fail-loud on any non-200.
  const cdnBase = process.env.CORPUS_CDN_BASE?.trim() || DEFAULT_CDN_BASE;
  for (const sourceId of config.sources) {
    await prefetchPapersPastOcr(archivePath, repoRoot, sourceId, cdnBase);
  }

  process.stdout.write(
    `site:snapshot -- reading archive ${config.archivePath}\n` +
      `  sources: ${config.sources.join(', ')}\n` +
      `  out dir: ${snapshotDir}\n\n`
  );

  for (const sourceId of config.sources) {
    // One file per source: read the raw corpus for just this source.
    const snapshot = readRawCorpus(archivePath, [sourceId], repoRoot);
    const file = snapshotFilePath(snapshotDir, sourceId);
    const bytes = writeSnapshotFile(snapshotDir, sourceId, snapshot);

    const pageCount = snapshot.sources.reduce(
      (sum, source) => sum + source.issues.reduce((s, issue) => s + issue.pages.length, 0),
      0
    );
    const issueCount = snapshot.sources.reduce((sum, source) => sum + source.issues.length, 0);
    process.stdout.write(
      `  wrote ${file}\n` +
        `    ${issueCount} issue(s), ${pageCount} page(s), ${snapshot.skipped.length} skipped, ` +
        `${formatBytes(bytes)}\n`
    );
  }

  process.stdout.write('\nsite:snapshot done.\n');
}

/**
 * If `sourceId` is a Papers Past clipping, fetches its B2-resident OCR `.txt`
 * from the CDN and writes it into the archive worktree at
 * `<archiveRoot>/<ocrKey>`, so the synchronous clipping loader can read it as a
 * local file. A non-Papers-Past source is a no-op. Fail-loud (throws naming the
 * source + key) on a non-200 response or a write error.
 */
async function prefetchPapersPastOcr(
  archiveRoot: string,
  repoRoot: string,
  sourceId: string,
  cdnBase: string
): Promise<void> {
  const ssotPath = path.join(repoRoot, 'bibliography', 'sources', `${sourceId}.yml`);
  const loaded = loadSourceFile(ssotPath);
  if (!isPapersPastSource(loaded)) {
    return;
  }

  const { objectStoreKey } = papersPastOcrAsset(loaded);
  const url = `${cdnBase}/${objectStoreKey}`;
  const dest = path.join(archiveRoot, objectStoreKey);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`site:snapshot(${sourceId}): OCR pre-fetch failed for ${url} -- ${message}`);
  }
  if (!response.ok) {
    throw new Error(
      `site:snapshot(${sourceId}): OCR pre-fetch got HTTP ${response.status} for ${url}.`
    );
  }
  const text = await response.text();

  try {
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`site:snapshot(${sourceId}): could not write OCR text to ${dest} -- ${message}`);
  }
  process.stdout.write(`  pre-fetched OCR ${objectStoreKey} (${text.length} chars)\n`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }
  return `${(kib / 1024).toFixed(2)} MiB`;
}

await main();
