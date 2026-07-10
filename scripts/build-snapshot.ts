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

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { resolveConfig } from '@/browser/config';
import { readRawCorpus } from '@/browser/load/raw-corpus';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { snapshotFilePath, writeSnapshotFile } from '@/browser/load/snapshot';

function main(): void {
  const config = resolveConfig();

  if (config.archivePath === undefined || !existsSync(config.archivePath)) {
    throw new Error(
      'site:snapshot requires a readable archive clone. Set CORPUS_ARCHIVE_PATH to the local ' +
        'archive clone (e.g. /Users/orion/work/colony-cults-archive). ' +
        `Current value: ${config.archivePath ?? 'unset'}.`
    );
  }

  const repoRoot = resolveRepoRoot();
  const snapshotDir = path.isAbsolute(config.snapshotDir)
    ? config.snapshotDir
    : path.join(repoRoot, config.snapshotDir);

  mkdirSync(snapshotDir, { recursive: true });

  process.stdout.write(
    `site:snapshot -- reading archive ${config.archivePath}\n` +
      `  sources: ${config.sources.join(', ')}\n` +
      `  out dir: ${snapshotDir}\n\n`
  );

  for (const sourceId of config.sources) {
    // One file per source: read the raw corpus for just this source.
    const snapshot = readRawCorpus(config.archivePath, [sourceId], repoRoot);
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

main();
