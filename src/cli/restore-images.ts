import type { ParsedArgs } from '@/cli/parse';
import { requireOption } from '@/cli/fetch';
import { resolveArchiveRoot, resolveFetchedDir } from '@/archive/location';
import {
  restoreIssueImages,
  type RestoreImagesResult,
} from '@/archive/public-cache';

/** Injectable side effects for the `restore-images` command (real disk + network by default). */
export interface RestoreImagesCliDeps {
  /** Absolute private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** Line-oriented output sink (stdout in production). */
  log: (message: string) => void;
  /** The restore itself (real public-cache pull by default; faked in tests). */
  restore: (
    issueDir: string,
    log: (message: string) => void,
    force: boolean,
  ) => Promise<RestoreImagesResult>;
}

/** Build the default (real disk + anonymous public GET) dependencies. */
export function defaultRestoreImagesCliDeps(): RestoreImagesCliDeps {
  const repoRoot = process.cwd();
  return {
    archiveRoot: resolveArchiveRoot(repoRoot),
    log: (message) => {
      console.log(message);
    },
    restore: (issueDir, log, force) =>
      restoreIssueImages(issueDir, { log, force }),
  };
}

/**
 * `restore-images <issueArk> --source-id <id> [--force]`.
 *
 * Restores an already-fetched issue's page-image masters (`f###.jpg`) from the
 * PUBLIC B2 cache, using each `f###.yml` companion's recorded `object_store`
 * location and verifying every download against the companion's `sha256`. This
 * is the explicit counterpart to the auto-restore the `ocr` command performs;
 * run it on its own to rehydrate an object-store-migrated issue's images
 * without re-fetching from Gallica.
 *
 * `--force` re-downloads and overwrites images already present locally.
 * `--dry-run` reports the resolved target directory and does nothing else.
 */
export async function runRestoreImages(
  args: ParsedArgs,
  deps: RestoreImagesCliDeps = defaultRestoreImagesCliDeps(),
): Promise<void> {
  const issueArk = args.positional[0];
  if (issueArk === undefined) {
    throw new Error('restore-images: missing required argument <issueArk>');
  }
  const sourceId = requireOption(
    args.options.sourceId,
    'source-id',
    'restore-images',
  );
  const dir = resolveFetchedDir(sourceId, issueArk, deps.archiveRoot);

  if (args.flags.dryRun) {
    deps.log(`restore-images (dry-run): ${issueArk} -> ${dir}`);
    return;
  }

  const result = await deps.restore(dir, deps.log, args.flags.force);
  deps.log(
    `restore-images: ${issueArk} -> ${result.restored.length} pulled, ` +
      `${result.skipped.length} already local`,
  );
}
