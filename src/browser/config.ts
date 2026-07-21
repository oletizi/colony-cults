import { resolve } from 'path';
import type { ImageProviderConfig } from '@/browser/model';

/** Default snapshot directory (relative to the repo root) when unset. */
const DEFAULT_SNAPSHOT_DIR = 'site/data';

/**
 * The configuration required to load and build the corpus.
 *
 * All values are sourced from environment variables; no defaults are baked
 * in except the snapshot directory. The operator is responsible for setting
 * the environment.
 */
export interface LoadConfig {
  /**
   * Absolute path to the private archive clone, when set. OPTIONAL: a build
   * without the archive (e.g. Netlify) reads the committed snapshot instead.
   * `loadCorpus` decides the archive-vs-snapshot precedence.
   */
  archivePath?: string;
  /**
   * Where the committed public-domain snapshot lives (one `<sourceId>.json`
   * per source). Absolute, or relative to the repo root. Defaults to
   * `site/data`.
   */
  snapshotDir: string;
  sources: string[];
  provider: ImageProviderConfig;
}

/**
 * Resolves the LoadConfig from environment variables.
 *
 * Does NOT throw merely because CORPUS_ARCHIVE_PATH is unset: a build may run
 * from the committed snapshot instead (the archive-vs-snapshot decision, and
 * the "neither available" throw, live in `loadCorpus`). Still fail-loud on a
 * genuinely invalid provider config.
 *
 * @param env - Environment variables (defaults to process.env)
 * @returns LoadConfig ready for corpus loading
 * @throws Error if CORPUS_IMAGE_PROVIDER is set to an unknown value
 * @throws Error if CORPUS_IMAGE_PROVIDER is 'b2-cdn' but CORPUS_CDN_BASE is missing
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): LoadConfig {
  const archivePathRaw = env.CORPUS_ARCHIVE_PATH?.trim();
  const archivePath = archivePathRaw ? resolve(archivePathRaw) : undefined;

  const snapshotDirRaw = env.CORPUS_SNAPSHOT_DIR?.trim();
  const snapshotDir = snapshotDirRaw ? snapshotDirRaw : DEFAULT_SNAPSHOT_DIR;

  const sourcesRaw = env.CORPUS_SOURCES?.trim();
  const sources = sourcesRaw
    ? sourcesRaw.split(',').map((s) => s.trim())
    : [
        'PB-P001',
        'PB-P002',
        'PB-P003',
        'PB-P007',
        'PB-P008',
        'PB-P009',
        'PB-P010',
        'PB-P011',
        'PB-P055',
        'PB-P057',
        'PB-P058',
        'PB-P059',
      ];

  const providerKind = env.CORPUS_IMAGE_PROVIDER?.trim() ?? 'source-iiif';

  let provider: ImageProviderConfig;

  if (providerKind === 'source-iiif') {
    provider = { kind: 'source-iiif' };
  } else if (providerKind === 'b2-cdn') {
    const cdnBase = env.CORPUS_CDN_BASE?.trim();
    if (!cdnBase) {
      throw new Error(
        'CORPUS_IMAGE_PROVIDER is set to "b2-cdn" but CORPUS_CDN_BASE is not set. ' +
        'When using the b2-cdn provider, CORPUS_CDN_BASE must be provided (e.g. https://my-cdn.example.com).'
      );
    }
    provider = { kind: 'b2-cdn', cdnBase, imageWidth: resolveCdnImageWidth(env) };
  } else {
    throw new Error(
      `Unknown CORPUS_IMAGE_PROVIDER value: "${providerKind}". ` +
      'Expected one of: "source-iiif" (default), "b2-cdn".'
    );
  }

  return {
    archivePath,
    snapshotDir,
    sources,
    provider,
  };
}

/**
 * Default b2-cdn reading width (px) when CORPUS_CDN_IMAGE_WIDTH is unset.
 *
 * 2000 chosen from measured CDN behavior: the heavy ~2 MB newspaper masters
 * (~3000-3900px) roughly halve (to ~0.9-1.2 MB) while staying legible, and
 * every smaller page in the corpus (down to ~14 KB monographs) is served at or
 * below its master size -- at this width cf.image scale-down never re-encodes a
 * page LARGER than its master (a smaller width like 1200 can inflate the tiny
 * scans; 2400 inflated a mid-size page). Tune via CORPUS_CDN_IMAGE_WIDTH.
 */
const DEFAULT_CDN_IMAGE_WIDTH = 2000;

/**
 * Resolves the b2-cdn reading width from `CORPUS_CDN_IMAGE_WIDTH`:
 * a positive integer sets `?w=<n>` (CDN resize); `0` / `"full"` disables it
 * (serve the full master); unset defaults to {@link DEFAULT_CDN_IMAGE_WIDTH}.
 *
 * @throws Error if the value is present but not a non-negative integer / "full".
 */
function resolveCdnImageWidth(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.CORPUS_CDN_IMAGE_WIDTH?.trim();
  if (raw === undefined) {
    return DEFAULT_CDN_IMAGE_WIDTH;
  }
  if (raw === '' || raw === '0' || raw.toLowerCase() === 'full') {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== raw) {
    throw new Error(
      `CORPUS_CDN_IMAGE_WIDTH must be a positive integer, 0, or "full"; got ${JSON.stringify(raw)}.`
    );
  }
  return n;
}
