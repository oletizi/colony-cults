import path from 'node:path';
import type { ParsedArgs } from '@/cli/parse';
import { requireOption } from '@/cli/fetch';
import { resolveArchiveRoot, resolveFetchedDir } from '@/archive/location';
import { ensureMemberLayoutRegistered } from '@/archive/member-layout';
import { assertOcrToolchain } from '@/ocr/preflight';
import { ocrIssue, defaultOcrCommandRunner } from '@/ocr/run';
import type { OcrCommandRunner } from '@/ocr/types';
import {
  restoreIssueImages,
  type RestoreImagesResult,
} from '@/archive/public-cache';

/** Injectable side effects for the `ocr` command (real preflight + disk by default). */
export interface OcrCliDeps {
  /** Absolute private-archive root (`../colony-cults-archive`). */
  archiveRoot: string;
  /** Retrieval-timestamp clock (injected for determinism/testability). */
  clock: () => Date;
  /** Line-oriented output sink (stdout in production). */
  log: (message: string) => void;
  /** OCR toolchain preflight (T029/FR-013); always runs for this command. */
  ocrPreflight: () => Promise<void>;
  /** Injected OCR command runner (T030). */
  ocrRunner: OcrCommandRunner;
  /**
   * Restore absent page images from the public B2 cache before OCR. Runs so an
   * object-store-migrated issue (companions kept, `f###.jpg` removed) is
   * OCR-able WITHOUT re-fetching from Gallica; a no-op when images are already
   * local. See `@/archive/public-cache`.
   */
  restoreImages: (
    issueDir: string,
    log: (message: string) => void,
    force: boolean,
  ) => Promise<RestoreImagesResult>;
}

/** Build the default (real preflight + disk) dependencies. */
export function defaultOcrCliDeps(): OcrCliDeps {
  const repoRoot = process.cwd();
  return {
    archiveRoot: resolveArchiveRoot(repoRoot),
    clock: () => new Date(),
    log: (message) => {
      console.log(message);
    },
    ocrPreflight: () => assertOcrToolchain(),
    ocrRunner: defaultOcrCommandRunner(),
    restoreImages: (issueDir, log, force) =>
      restoreIssueImages(issueDir, { log, force }),
  };
}

/**
 * `ocr <issueArk> --source-id <id> [--slug <slug>]` (T031, contracts/cli.md).
 *
 * OCRs an already-fetched issue's page images. The issue directory is located
 * purely from what is already on disk (no census, no re-verification of rights
 * -- that already gated the original fetch). If the page-image masters are
 * absent locally but recorded in the object store (the B2 migration keeps the
 * `f###.yml` companions and removes the `f###.jpg`), they are first restored
 * from the PUBLIC B2 cache (`deps.restoreImages`) -- never re-fetched from
 * Gallica. The preflight (T029) runs before any OCR work; `--dry-run` reports
 * the resolved target directory and does nothing else.
 */
export async function runOcr(
  args: ParsedArgs,
  deps: OcrCliDeps = defaultOcrCliDeps(),
): Promise<void> {
  const issueArk = args.positional[0];
  if (issueArk === undefined) {
    throw new Error('ocr: missing required argument <issueArk>');
  }
  const sourceId = requireOption(args.options.sourceId, 'source-id', 'ocr');
  // Source-group members are not in the static layout registry -- derive+register
  // their layout (same slug `bib acquire` fetched into) before locating the dir.
  ensureMemberLayoutRegistered(
    sourceId,
    path.join(process.cwd(), 'bibliography', 'sources'),
  );
  const dir = resolveFetchedDir(sourceId, issueArk, deps.archiveRoot);

  if (args.flags.dryRun) {
    deps.log(`ocr (dry-run): ${issueArk} -> ${dir}`);
    return;
  }

  await deps.ocrPreflight();

  // Restore page-image masters from the public B2 cache when they are absent
  // locally (object-store-migrated issue). A no-op when the images are present.
  const restore = await deps.restoreImages(dir, deps.log, args.flags.force);
  if (restore.restored.length > 0) {
    deps.log(
      `ocr: restored ${restore.restored.length} page image(s) from the public cache`,
    );
  }

  const result = await ocrIssue(dir, {
    runner: deps.ocrRunner,
    archiveRoot: deps.archiveRoot,
    clock: deps.clock,
    force: args.flags.force,
    log: deps.log,
  });

  deps.log(
    `ocr: ${issueArk} -> ${result.text.path} ` +
      `(${result.text.skipped ? 'skipped' : 'written'})`,
  );
}
