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
    : ['PB-P001', 'PB-P002', 'PB-P003', 'PB-P007', 'PB-P008', 'PB-P009', 'PB-P010', 'PB-P011'];

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
    provider = { kind: 'b2-cdn', cdnBase };
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
