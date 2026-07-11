/**
 * scripts/build-pdf.ts
 *
 * The `pdf:build` CLI (T022/T025, spec 007, contracts/cli.md): render corpus
 * items to facing-page facsimile PDFs. Sibling to `site:snapshot` /
 * `site:export-public` in `package.json`.
 *
 *   npm run pdf:build -- <sourceId>/<issueId>   # one item (US1)
 *   npm run pdf:build -- <sourceId>             # every issue of a source (US2)
 *   npm run pdf:build -- --all                  # the whole committed snapshot (US2)
 *
 * Guarantees (contracts/cli.md):
 *  - G-1 one PDF per item: `buildItem` writes exactly one; `buildSource`/
 *    `buildAll` (src/pdf/render/batch.ts) do so once per enumerated item.
 *  - G-2 selector precision: an unknown source/issue fails loud naming the id.
 *  - G-3 internal-first: writes only under `--out`; no publish/upload step.
 *  - G-4 fail-loud batch: a batch build is attributable + record-and-continue
 *    -- a per-item (or per-source, for --all) failure is caught, recorded
 *    with its id + reason, and does NOT abort its siblings; the run prints a
 *    "built N, failed M" summary listing every failure and exits non-zero if
 *    M > 0. A batch is never silently "OK" when something failed.
 *  - G-6 Typst prerequisite: a missing `typst` binary fails loud (before any
 *    image work) naming the missing dependency.
 */

import path from 'node:path';

import { execCommand } from '@/ocr/exec';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { buildItem } from '@/pdf/render/build';
import { buildAll, buildSource, type BuildSourceResult } from '@/pdf/render/batch';
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

  if (all && selector !== undefined) {
    throw new Error(
      `pdf:build: --all builds the whole corpus and cannot be combined with a selector ` +
        `(got ${JSON.stringify(selector)}).`,
    );
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

/**
 * Prints the G-4 attributable batch summary ("built N, failed M" plus every
 * failure's item id + reason) and sets a non-zero exit code if ANY item (or
 * whole source, for --all) failed -- a batch is never silently "OK" when
 * something failed.
 */
function reportBatch(results: BuildSourceResult[], repoRoot: string): void {
  let builtTotal = 0;
  const failureLines: string[] = [];

  for (const result of results) {
    for (const item of result.built) {
      builtTotal += 1;
      const rel = path.relative(repoRoot, item.outPath);
      process.stdout.write(
        `  OK   ${result.sourceId}/${item.itemId} -> ${rel.startsWith('..') ? item.outPath : rel}\n`,
      );
    }
    for (const failure of result.failed) {
      failureLines.push(`  FAIL ${result.sourceId}/${failure.itemId}: ${failure.error}`);
    }
  }

  process.stdout.write(`\nbuilt ${builtTotal}, failed ${failureLines.length}\n`);

  if (failureLines.length > 0) {
    process.stderr.write(`\nFailures (${failureLines.length}):\n${failureLines.join('\n')}\n`);
    // G-4: a batch with any failure is never silently "OK".
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // G-6: fail loud on a missing Typst binary before any image work, for
  // every selector shape (single item, whole source, or --all).
  await assertTypstAvailable();

  const repoRoot = resolveRepoRoot();
  const outLabel = args.out ?? 'build/pdf (config default)';
  const providerLabel = args.provider ?? '(config default)';

  if (args.all) {
    process.stdout.write(
      `pdf:build -- all committed snapshot sources\n` +
        `  provider: ${providerLabel}\n` +
        `  out root: ${outLabel}\n\n`,
    );
    const results = await buildAll({ provider: args.provider, outDir: args.out });
    reportBatch(results, repoRoot);
    return;
  }

  if (args.selector === undefined) {
    throw new Error(
      'pdf:build: no selector given. Pass "<sourceId>" (every issue of a source), ' +
        '"<sourceId>/<issueId>" (a single item), or --all (the whole committed snapshot).',
    );
  }

  const slashIndex = args.selector.indexOf('/');
  if (slashIndex === -1) {
    const sourceId = args.selector;
    process.stdout.write(
      `pdf:build -- source ${sourceId} (all issues)\n` +
        `  provider: ${providerLabel}\n` +
        `  out root: ${outLabel}\n\n`,
    );
    const result = await buildSource(sourceId, { provider: args.provider, outDir: args.out });
    reportBatch([result], repoRoot);
    return;
  }

  const sourceId = args.selector.slice(0, slashIndex);
  const itemId = args.selector.slice(slashIndex + 1);
  if (sourceId.length === 0 || itemId.length === 0) {
    throw new Error(
      `pdf:build: malformed selector ${JSON.stringify(args.selector)} -- expected ` +
        '"<sourceId>/<issueId>".',
    );
  }

  process.stdout.write(
    `pdf:build -- item ${sourceId}/${itemId}\n` +
      `  provider: ${providerLabel}\n` +
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
