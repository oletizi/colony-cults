import type { ParsedArgs } from '@/cli/parse';
import { requireOption } from '@/cli/fetch';
import { resolveArchiveRoot, findIssueDir } from '@/archive/location';
import { assertOcrToolchain } from '@/ocr/preflight';
import { ocrIssue, defaultOcrCommandRunner } from '@/ocr/run';
import type { OcrCommandRunner } from '@/ocr/types';

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
  };
}

/**
 * `ocr <issueArk> --source-id <id> [--slug <slug>]` (T031, contracts/cli.md).
 *
 * OCRs an already-fetched issue's page images WITHOUT re-downloading: the
 * issue directory is located purely from what is already on disk (no
 * network, no re-verification of rights -- that already gated the original
 * fetch). The preflight (T029) runs before any OCR work; `--dry-run` reports
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
  const dir = findIssueDir(sourceId, issueArk, deps.archiveRoot);

  if (args.flags.dryRun) {
    deps.log(`ocr (dry-run): ${issueArk} -> ${dir}`);
    return;
  }

  await deps.ocrPreflight();

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
