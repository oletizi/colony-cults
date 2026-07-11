/**
 * scripts/build-pdf.ts
 *
 * The `pdf:build` CLI (T022, spec 007, contracts/cli.md): render corpus items
 * to facing-page facsimile PDFs. Sibling to `site:snapshot` /
 * `site:export-public` in `package.json`.
 *
 *   npm run pdf:build -- <sourceId>/<issueId> [--provider b2|iiif] [--out <dir>]
 *
 * SCOPE (this task, US1): builds exactly ONE item selected as
 * `<sourceId>/<issueId>` (or `<sourceId>/<sourceId>` for a monograph). A bare
 * `<sourceId>` (all issues) and `--all` (whole corpus) are the batch build owned
 * by US2 (task T025) and are NOT yet implemented -- they fail loud naming T025
 * rather than silently no-op'ing.
 *
 * Guarantees (contracts/cli.md):
 *  - G-2 selector precision: an unknown source/issue fails loud naming the id.
 *  - G-3 internal-first: writes only under `--out`; no publish/upload step.
 *  - G-6 Typst prerequisite: a missing `typst` binary fails loud (before any
 *    image work) naming the missing dependency.
 */

import path from 'node:path';

import { execCommand } from '@/ocr/exec';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { buildItem } from '@/pdf/render/build';
import type { PdfImageProviderKind } from '@/pdf/config';

/** Parsed CLI invocation. */
interface CliArgs {
  /** The positional selector, e.g. `PB-P001` or `PB-P001/1879-07-15_...`, or `undefined`. */
  selector: string | undefined;
  /** `--all` flag. */
  all: boolean;
  /** `--provider` value, or `undefined` (fall back to config). */
  provider: PdfImageProviderKind | undefined;
  /** `--out` dir, or `undefined` (fall back to config default `build/pdf`). */
  out: string | undefined;
}

/** Parse `process.argv.slice(2)`. Fails loud on an unknown flag or bad value. */
function parseArgs(argv: string[]): CliArgs {
  let selector: string | undefined;
  let all = false;
  let provider: PdfImageProviderKind | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--provider') {
      const value = argv[i + 1];
      i += 1;
      if (value !== 'b2' && value !== 'iiif') {
        throw new Error(
          `pdf:build: --provider expects "b2" or "iiif", got ${JSON.stringify(value ?? '(missing)')}.`,
        );
      }
      provider = value;
    } else if (arg === '--out') {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined || value.trim().length === 0) {
        throw new Error('pdf:build: --out expects a directory path.');
      }
      out = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`pdf:build: unknown flag ${JSON.stringify(arg)}.`);
    } else if (selector === undefined) {
      selector = arg;
    } else {
      throw new Error(
        `pdf:build: unexpected extra argument ${JSON.stringify(arg)} (already have selector ` +
          `${JSON.stringify(selector)}).`,
      );
    }
  }

  return { selector, all, provider, out };
}

/**
 * Preflight the Typst binary (G-6): fail loud, naming the missing dependency,
 * BEFORE any image fetch or build work. `execCommand` never rejects -- a
 * missing binary surfaces as a non-zero exit.
 */
async function assertTypstAvailable(): Promise<void> {
  const result = await execCommand('typst', ['--version']);
  if (result.exitCode !== 0) {
    throw new Error(
      'pdf:build: the "typst" binary is required but was not found on PATH (or failed to run). ' +
        'Install Typst (https://github.com/typst/typst) and ensure "typst --version" works ' +
        `(exit ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim() || 'no output'}).`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.all) {
    throw new Error(
      'pdf:build: --all (whole-corpus batch build) is not yet implemented -- it is US2, task ' +
        'T025. Build a single item as "<sourceId>/<issueId>" for now.',
    );
  }

  if (args.selector === undefined) {
    throw new Error(
      'pdf:build: no selector given. Pass "<sourceId>/<issueId>" to build one item ' +
        '(e.g. PB-P001/1879-07-15_bpt6k5603637g). Bare "<sourceId>" (all issues) and --all are ' +
        'the batch build (US2, task T025) and are not yet implemented.',
    );
  }

  const slashIndex = args.selector.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(
      `pdf:build: selector ${JSON.stringify(args.selector)} names a whole source (all issues), ` +
        'which is the batch build owned by US2 (task T025) and is not yet implemented. Select a ' +
        'single item as "<sourceId>/<issueId>".',
    );
  }

  const sourceId = args.selector.slice(0, slashIndex);
  const itemId = args.selector.slice(slashIndex + 1);
  if (sourceId.length === 0 || itemId.length === 0) {
    throw new Error(
      `pdf:build: malformed selector ${JSON.stringify(args.selector)} -- expected ` +
        '"<sourceId>/<issueId>".',
    );
  }

  // G-6: fail loud on a missing Typst binary before any image work.
  await assertTypstAvailable();

  const repoRoot = resolveRepoRoot();
  const outLabel = args.out ?? 'build/pdf (config default)';
  process.stdout.write(
    `pdf:build -- item ${sourceId}/${itemId}\n` +
      `  provider: ${args.provider ?? '(config default)'}\n` +
      `  out root: ${outLabel}\n\n`,
  );

  const { outPath } = await buildItem(sourceId, itemId, {
    provider: args.provider,
    outDir: args.out,
  });

  const rel = path.relative(repoRoot, outPath);
  process.stdout.write(`\nOK -- wrote ${rel.startsWith('..') ? outPath : rel}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
