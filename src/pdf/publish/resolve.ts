/**
 * Publish-target resolution (T016, spec 008-edition-publishing): resolve the
 * source + `--variant` + built-PDF output dir and enumerate the issue PDFs
 * `pdf:publish` is asked to publish -- WITHOUT building anything
 * (contracts/cli.md G-1: publish operates only over PRE-BUILT PDFs already
 * written by `pdf:build` under `<outDir>/<sourceId>/<issueId>.pdf`, see
 * `src/pdf/render/build.ts`'s `buildItem`).
 *
 * G-7 (attributable, fail-loud batch): a missing built PDF for an enumerated
 * issue is never silently dropped -- every missing PDF is collected (its
 * issueId + the expected path) and returned alongside the present ones, so
 * the caller (T020 publish orchestration) can print "published N, failed M"
 * and decide record-and-continue vs abort, per contracts/cli.md.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import type { RawSource } from '@/browser/model';
import { resolvePdfConfig } from '@/pdf/config';
import { makeCorpusSnapshotReader, type CorpusSnapshotReader } from '@/pdf/load/edition';
import type { PublicationVariant } from '@/pdf/publish/key';

/** Options for {@link resolvePublishTargets}. */
export interface ResolvePublishTargetsOptions {
  /** Snapshot source id (e.g. `PB-P001`). */
  sourceId: string;
  /** Which edition variant to publish (recorded, not inferable from the built path -- FR-012). */
  variant: PublicationVariant;
  /** Built-PDF output root; overrides the resolved config (`PdfConfig.outDir`, default `build/pdf`). */
  outDir?: string;
  /** Committed snapshot dir; overrides the resolved config (`PdfConfig.snapshotDir`, default `site/data`). */
  snapshotDir?: string;
  /** Environment used to resolve config; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Injected snapshot reader (tests); defaults to the concrete committed-snapshot reader. */
  snapshotReader?: CorpusSnapshotReader;
}

/** One enumerated issue whose built PDF is present at the expected path. */
export interface ResolvedPublishIssue {
  issueId: string;
  /** Absolute path to the pre-built PDF (`<outDir>/<sourceId>/<issueId>.pdf`). */
  pdfPath: string;
}

/** One enumerated issue whose built PDF is MISSING -- an attributable failure (G-7). */
export interface MissingPublishIssue {
  issueId: string;
  /** Absolute path where the built PDF was expected but not found. */
  expectedPath: string;
}

/** The resolved publish targets for one source + variant. */
export interface ResolvePublishTargetsResult {
  sourceId: string;
  variant: PublicationVariant;
  /** Every enumerated issue whose built PDF exists, ready to publish. */
  issues: ResolvedPublishIssue[];
  /** Every enumerated issue whose built PDF is missing -- surfaced, never dropped (G-7). */
  missing: MissingPublishIssue[];
}

/** Resolve the RawSource for `sourceId`, or fail loud naming it (mirrors build.ts/batch.ts's `selectSource`). */
function selectSource(sources: RawSource[], sourceId: string): RawSource {
  const source = sources.find((candidate) => candidate.sourceId === sourceId);
  if (source === undefined) {
    throw new Error(
      `resolvePublishTargets: unknown source ${JSON.stringify(sourceId)} -- not in the ` +
        `committed snapshot (found: ${sources.map((s) => s.sourceId).join(', ') || 'none'}).`,
    );
  }
  return source;
}

/**
 * Every item id a source publishes: one per issue for a periodical, or the
 * single `[sourceId]` for a monograph (matches `buildItem`'s monograph
 * convention: itemId === sourceId).
 *
 * `@/pdf/render/batch` has an identically-shaped `enumerateItemIds`, but it
 * is a private (non-exported) helper there, so it cannot be imported here.
 * This is a deliberate, minimal duplication of that same 3-line convention
 * -- NOT a reimplementation of the built-PDF resolution logic this module
 * owns. If/when `enumerateItemIds` is exported from `batch.ts`, this local
 * copy should be deleted in favor of importing it.
 */
function enumerateItemIds(source: RawSource): string[] {
  if (source.kind === 'monograph') {
    return [source.sourceId];
  }
  return source.issues.map((issue) => issue.issueId);
}

/** Resolve the (possibly-relative) built-PDF output root to an absolute path. */
function resolveOutDirAbs(outDir: string, repoRoot: string): string {
  return path.isAbsolute(outDir) ? outDir : path.join(repoRoot, outDir);
}

/**
 * Resolve the source + variant + built-PDF dir and enumerate the issue PDFs
 * to publish (contracts/cli.md G-1/G-7). Never builds, fetches images, or
 * runs Typst -- only checks for the built PDF `pdf:build` is expected to
 * have already written at `<outDir>/<sourceId>/<issueId>.pdf`.
 *
 * @throws Error if `sourceId` is not in the committed snapshot (fail loud,
 *   naming the id -- mirrors `buildItem`/`buildSource`'s unknown-source
 *   guard). A missing built PDF for an enumerated issue is NOT thrown here
 *   -- it is collected into the returned `missing` list (G-7) so the caller
 *   can report every failure rather than aborting on the first one.
 */
export async function resolvePublishTargets(
  opts: ResolvePublishTargetsOptions,
): Promise<ResolvePublishTargetsResult> {
  const { sourceId, variant } = opts;
  const env = opts.env ?? process.env;
  const config = resolvePdfConfig(env);
  const repoRoot = resolveRepoRoot();

  const snapshotDir = opts.snapshotDir ?? config.snapshotDir;
  const snapshotReader = opts.snapshotReader ?? makeCorpusSnapshotReader(snapshotDir);
  const rawSnapshot = snapshotReader.read(sourceId);
  const source = selectSource(rawSnapshot.sources, sourceId);
  const itemIds = enumerateItemIds(source);

  const outDirAbs = resolveOutDirAbs(opts.outDir ?? config.outDir, repoRoot);
  const sourceOutDir = path.join(outDirAbs, sourceId);

  const issues: ResolvedPublishIssue[] = [];
  const missing: MissingPublishIssue[] = [];

  for (const issueId of itemIds) {
    const pdfPath = path.join(sourceOutDir, `${issueId}.pdf`);
    if (existsSync(pdfPath)) {
      issues.push({ issueId, pdfPath });
    } else {
      missing.push({ issueId, expectedPath: pdfPath });
    }
  }

  return { sourceId, variant, issues, missing };
}
