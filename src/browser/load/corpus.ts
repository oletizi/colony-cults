/**
 * The corpus loader (corpus-loader contract). Produces the normalized
 * {@link CorpusView} the Astro site renders, from EITHER a fresh read of the
 * local archive clone OR the committed public-domain snapshot under
 * `site/data/` -- whichever is available, decided by an explicit precedence
 * (below) with NO silent fallback.
 *
 * The read splits into two stages that both converge on `resolveImages`:
 *
 *   1. RAW read -> {@link CorpusSnapshot} (text + metadata + image handles):
 *      `readRawCorpus` (archive) or `readSnapshotCorpus` (committed snapshot).
 *   2. `resolveImages(raw, provider)` -> {@link LoadResult}: resolves every
 *      page's image URL through the active provider.
 *
 * Fail-loud: any missing or inconsistent corpus datum throws (naming source /
 * issue / page) rather than substituting a placeholder (G-1..G-4); it reads
 * only the local clone / committed snapshot + public handles (G-5); and it is
 * deterministic given the same input + config (G-6).
 *
 * See specs/005-corpus-browser/contracts/corpus-loader.md and
 * specs/005-corpus-browser/data-model.md.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import type { LoadConfig } from '@/browser/config';
import type { CorpusSnapshot, LoadResult } from '@/browser/model';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { readRawCorpus } from '@/browser/load/raw-corpus';
import { readSnapshotCorpus, snapshotAvailable } from '@/browser/load/snapshot';
import { resolveImages } from '@/browser/load/resolve-images';

/**
 * Loads and normalizes the corpus described by `config`, then resolves every
 * page image through the active provider.
 *
 * Archive-vs-snapshot precedence (explicit; NO silent fallback):
 *
 *  1. if `config.archivePath` is set AND exists -> read the archive (fresh);
 *  2. else if a committed snapshot exists for every source under the snapshot
 *     dir -> read the snapshot;
 *  3. else THROW, naming BOTH the missing archive (CORPUS_ARCHIVE_PATH) and the
 *     missing snapshot path.
 *
 * @throws Error on any collected-but-corrupt issue or unresolvable source, or
 *   when neither an archive nor a snapshot is available.
 */
export function loadCorpus(config: LoadConfig): LoadResult {
  if (config.sources.length === 0) {
    throw new Error('loadCorpus: config.sources is empty -- at least one source id is required.');
  }

  const raw = readRaw(config);
  return resolveImages(raw, config.provider);
}

/** Applies the archive-vs-snapshot precedence and returns the raw corpus. */
function readRaw(config: LoadConfig): CorpusSnapshot {
  const repoRoot = resolveRepoRoot();
  const snapshotDir = path.isAbsolute(config.snapshotDir)
    ? config.snapshotDir
    : path.join(repoRoot, config.snapshotDir);

  const archivePath = config.archivePath;
  if (archivePath !== undefined && archivePath.length > 0 && existsSync(archivePath)) {
    return readRawCorpus(archivePath, config.sources, repoRoot);
  }

  if (snapshotAvailable(snapshotDir, config.sources)) {
    return readSnapshotCorpus(snapshotDir, config.sources);
  }

  throw new Error(
    'loadCorpus: no corpus source available -- neither an archive clone nor a committed ' +
      'snapshot could be read.\n' +
      `  - CORPUS_ARCHIVE_PATH: ${describeArchivePath(archivePath)}\n` +
      `  - snapshot dir: ${snapshotDir} (expected one <sourceId>.json per source: ` +
      `${config.sources.join(', ')})\n` +
      'Set CORPUS_ARCHIVE_PATH to a readable archive clone, or generate + commit the snapshot ' +
      'with "npm run site:snapshot" (see site/README.md).'
  );
}

function describeArchivePath(archivePath: string | undefined): string {
  if (archivePath === undefined || archivePath.length === 0) {
    return 'unset';
  }
  return `${archivePath} (does not exist)`;
}
