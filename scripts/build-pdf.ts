/**
 * scripts/build-pdf.ts
 *
 * The `pdf:build` CLI (T022/T025, spec 007; archive-direct per spec 014,
 * contracts/cli.md): render corpus items to facing-page facsimile PDFs.
 * Sibling to `site:snapshot` / `site:export-public` in `package.json`.
 *
 * The Edition is assembled DIRECTLY from the private archive (spec 014) --
 * NOT from the committed snapshot -- so the build requires a resolvable
 * archive root (`--archive-root <dir>` or `COLONY_ARCHIVE_ROOT`).
 *
 *   npm run pdf:build -- <sourceId>/<issueId>   # one item (US1)
 *   npm run pdf:build -- <sourceId>             # every issue of a source (US2);
 *                                                # a source-group id (e.g. PB-P060)
 *                                                # builds the ONE combined
 *                                                # group-edition PDF instead
 *                                                # (spec 017)
 *   npm run pdf:build -- --all                  # every source the archive has (US2)
 *
 * Flags:
 *   --provider b2|iiif   image provider (default: config PDF_IMAGE_PROVIDER, else b2)
 *   --out <dir>          output root (default: config PDF_OUT_DIR, else build/pdf)
 *   --archive-root <dir> private archive worktree root (default: COLONY_ARCHIVE_ROOT
 *                        env var; fail-loud if neither is set -- see
 *                        `@/archive/location`'s `resolveArchiveRoot`)
 *   --no-french          render the English-only *reading* recto (two English
 *                        columns, FR label dropped) instead of the default
 *                        two-column parallel FR|EN *study* recto. Overrides the
 *                        PDF_SHOW_FRENCH env toggle for this build. See
 *                        pdf/template/DESIGN.md § "Variant: English-only recto".
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
 *
 * Spec 017 T012: a slash-less selector whose bibliography SSOT entry carries
 * `kind: 'source-group'` (e.g. `PB-P060`) routes to `buildGroupEdition`
 * (`@/pdf/render/group-edition`) -- ONE combined PDF for the whole group --
 * instead of `buildSource`. See {@link resolveSelectorRoute}.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { execCommand } from '@/ocr/exec';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { resolveArchiveRoot } from '@/archive/location';
import { resolveObjectStoreConfig } from '@/archive/b2-config';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { loadSourceFile } from '@/bibliography/load';
import type { Source } from '@/model/source';
import { buildItem } from '@/pdf/render/build';
import { buildAll, buildSource, type BuildSourceResult } from '@/pdf/render/batch';
import { buildGroupEdition } from '@/pdf/render/group-edition';
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
  /**
   * `--archive-root` dir, or `undefined` (fall back to `COLONY_ARCHIVE_ROOT`;
   * `resolveArchiveRoot` fails loud if neither is set).
   */
  archiveRoot: string | undefined;
  /**
   * `--no-french` flag: when set, forces the English-only recto
   * (`showFrench=false`), overriding the `PDF_SHOW_FRENCH` env toggle. When
   * unset, `showFrench` is left to config/env (default: parallel FR|EN).
   */
  noFrench: boolean;
}

/** Parse `process.argv.slice(2)`. Fails loud on an unknown flag or bad value. */
function parseArgs(argv: string[]): CliArgs {
  let selector: string | undefined;
  let all = false;
  let provider: PdfImageProviderKind | undefined;
  let out: string | undefined;
  let archiveRoot: string | undefined;
  let noFrench = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--no-french') {
      noFrench = true;
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
    } else if (arg === '--archive-root') {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined || value.trim().length === 0) {
        throw new Error('pdf:build: --archive-root expects a directory path.');
      }
      archiveRoot = value;
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

  return { selector, all, provider, out, archiveRoot, noFrench };
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
 * Preflight the private archive root: fail loud, BEFORE any build work, if
 * neither `--archive-root` nor `COLONY_ARCHIVE_ROOT` resolves an archive
 * worktree. `resolveArchiveRoot` already fails loud when the build itself
 * runs, but preflighting here (mirroring {@link assertTypstAvailable}) gives a
 * clear upfront message instead of failing partway into the first item.
 */
function assertArchiveRootResolvable(repoRoot: string, archiveRootArg: string | undefined): void {
  resolveArchiveRoot(repoRoot, archiveRootArg, process.env);
}

/**
 * Pure routing decision (spec 017 T012): 'group' when `source.kind ===
 * 'source-group'`, else 'source' -- the existing `buildSource` path, which
 * already handles both a standalone source AND a single source-group member
 * (`@/pdf/render/batch`'s own `loadMemberCandidate` routing). Kept separate
 * from the bibliography lookup below so the decision itself is testable
 * without touching the filesystem.
 */
export function resolveSelectorRoute(source: Source): 'group' | 'source' {
  return source.kind === 'source-group' ? 'group' : 'source';
}

/**
 * Resolve a slash-less selector's route by looking up `sourceId`'s
 * bibliography SSOT entry (`bibliography/sources/<sourceId>.yml`). A
 * sourceId with NO SSOT file on disk resolves to `'source'` too -- this is
 * deliberately NOT a lookup-miss error here: the existing `buildSource` ->
 * `resolveArchiveSource` -> `sourceLayout` chain is the one place a
 * genuinely unknown id fails loud naming it (G-2), and this helper must
 * never race ahead of that with its own "unknown source" throw.
 */
function resolveSourceSelectorRoute(sourceId: string, repoRoot: string): 'group' | 'source' {
  const bibliographyDir = path.join(repoRoot, 'bibliography', 'sources');
  const filePath = path.join(bibliographyDir, `${sourceId}.yml`);
  if (!existsSync(filePath)) {
    return 'source';
  }
  const { source } = loadSourceFile(filePath);
  return resolveSelectorRoute(source);
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

  // Preflight: fail loud on an unresolvable archive root BEFORE any build
  // work -- the build reads the Edition directly from the private archive
  // (spec 014), not the committed snapshot, so it always needs a root.
  assertArchiveRootResolvable(repoRoot, args.archiveRoot);

  const outLabel = args.out ?? 'build/pdf (config default)';
  const providerLabel = args.provider ?? '(config default)';
  const archiveRootLabel = args.archiveRoot ?? 'COLONY_ARCHIVE_ROOT';
  // `--no-french` forces the English-only recto (CLI overrides the
  // PDF_SHOW_FRENCH env toggle); left unset, config/env decides.
  const showFrench = args.noFrench ? false : undefined;
  const editionLabel = args.noFrench ? 'english-only (--no-french)' : '(config default)';

  if (args.all) {
    process.stdout.write(
      `pdf:build -- all archive sources\n` +
        `  provider: ${providerLabel}\n` +
        `  edition:  ${editionLabel}\n` +
        `  archive:  ${archiveRootLabel}\n` +
        `  out root: ${outLabel}\n\n`,
    );
    const results = await buildAll({
      provider: args.provider,
      outDir: args.out,
      archiveRoot: args.archiveRoot,
      showFrench,
    });
    reportBatch(results, repoRoot);
    return;
  }

  if (args.selector === undefined) {
    throw new Error(
      'pdf:build: no selector given. Pass "<sourceId>" (every issue of a source, or -- for a ' +
        'source-group id like PB-P060 -- the one combined group-edition PDF), ' +
        '"<sourceId>/<issueId>" (a single item), or --all (every archive source).',
    );
  }

  const slashIndex = args.selector.indexOf('/');
  if (slashIndex === -1) {
    const sourceId = args.selector;
    const route = resolveSourceSelectorRoute(sourceId, repoRoot);

    if (route === 'group') {
      process.stdout.write(
        `pdf:build -- source-group ${sourceId} (combined edition)\n` +
          `  provider: ${providerLabel}\n` +
          `  edition:  ${editionLabel}\n` +
          `  archive:  ${archiveRootLabel}\n` +
          `  out root: ${outLabel}\n\n`,
      );
      const objectStore = new S3ObjectStore(resolveObjectStoreConfig());
      const { outPath } = await buildGroupEdition(sourceId, {
        provider: args.provider,
        outDir: args.out,
        archiveRoot: args.archiveRoot,
        showFrench,
        env: process.env,
        objectStore,
      });
      const rel = path.relative(repoRoot, outPath);
      process.stdout.write(`\nOK -- wrote ${rel.startsWith('..') ? outPath : rel}\n`);
      return;
    }

    process.stdout.write(
      `pdf:build -- source ${sourceId} (all issues)\n` +
        `  provider: ${providerLabel}\n` +
        `  edition:  ${editionLabel}\n` +
        `  archive:  ${archiveRootLabel}\n` +
        `  out root: ${outLabel}\n\n`,
    );
    const result = await buildSource(sourceId, {
      provider: args.provider,
      outDir: args.out,
      archiveRoot: args.archiveRoot,
      showFrench,
    });
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
      `  edition:  ${editionLabel}\n` +
      `  archive:  ${archiveRootLabel}\n` +
      `  out root: ${outLabel}\n\n`,
  );

  const { outPath } = await buildItem(sourceId, itemId, {
    provider: args.provider,
    outDir: args.out,
    archiveRoot: args.archiveRoot,
    showFrench,
  });

  const rel = path.relative(repoRoot, outPath);
  process.stdout.write(`\nOK -- wrote ${rel.startsWith('..') ? outPath : rel}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
