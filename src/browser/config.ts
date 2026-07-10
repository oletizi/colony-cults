import { existsSync } from 'fs';
import { resolve } from 'path';
import type { ImageProviderConfig } from '@/browser/model';

/**
 * The configuration required to load and build the corpus.
 *
 * All values are sourced from environment variables; no defaults are baked
 * in. The operator is responsible for setting the environment.
 */
export interface LoadConfig {
  archivePath: string;
  sources: string[];
  provider: ImageProviderConfig;
}

/**
 * Resolves the LoadConfig from environment variables.
 *
 * Throws a descriptive error if required env vars are missing or invalid.
 * No fallbacks, no silent defaults except where explicitly documented.
 *
 * @param env - Environment variables (defaults to process.env)
 * @returns LoadConfig ready for corpus loading
 * @throws Error if CORPUS_ARCHIVE_PATH is missing, invalid, or path doesn't exist
 * @throws Error if CORPUS_IMAGE_PROVIDER is set to an unknown value
 * @throws Error if CORPUS_IMAGE_PROVIDER is 'b2-cdn' but CORPUS_CDN_BASE is missing
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): LoadConfig {
  const archivePath = env.CORPUS_ARCHIVE_PATH?.trim();
  if (!archivePath) {
    throw new Error(
      'CORPUS_ARCHIVE_PATH environment variable is required but not set. ' +
      'Set it to the local path of your archive clone (e.g. /Users/orion/work/colony-cults-archive).'
    );
  }

  const resolvedPath = resolve(archivePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(
      `CORPUS_ARCHIVE_PATH points to a path that does not exist: ${resolvedPath}. ` +
      'Verify the path is correct and the directory is accessible.'
    );
  }

  const sourcesRaw = env.CORPUS_SOURCES?.trim();
  const sources = sourcesRaw ? sourcesRaw.split(',').map((s) => s.trim()) : ['PB-P001'];

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
    archivePath: resolvedPath,
    sources,
    provider,
  };
}
