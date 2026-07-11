/**
 * Batch build orchestration (T025, spec 007 US2): scale the single-item
 * `buildItem` orchestrator (`./build.ts`) across every item of one source
 * (`buildSource`) or every committed snapshot source (`buildAll`).
 *
 * G-1 (one PDF per item) is inherited from `buildItem` -- this module adds
 * enumeration (which items a source/corpus has) and G-4 (attributable,
 * record-and-continue failure, contracts/cli.md): each item is built
 * independently; a per-item failure is caught, recorded with the item id +
 * message, and does NOT abort sibling builds. `buildAll` extends the same
 * record-and-continue posture to a whole source failing (e.g. an unknown or
 * empty source) so one bad source cannot silently kill the rest of the
 * corpus batch. The CLI (`scripts/build-pdf.ts`) turns the returned failure
 * lists into the printed summary + a non-zero exit -- a batch with any
 * failure is never silently "OK".
 */

import { readdirSync } from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import type { RawSource } from '@/browser/model';
import { resolvePdfConfig } from '@/pdf/config';
import { buildItem, type BuildItemOptions } from '@/pdf/render/build';
import { makeCorpusSnapshotReader, type CorpusSnapshotReader } from '@/pdf/load/edition';

/** Suffix of a committed per-source snapshot file (`<sourceId>.json.gz`). */
const SNAPSHOT_SUFFIX = '.json.gz';

/** One item's successful build. */
export interface BatchBuiltItem {
  /** Issue id, or the source id for a monograph. */
  itemId: string;
  /** Absolute path of the written PDF. */
  outPath: string;
}

/** One item's attributable failure (G-4): the item id + the error that aborted it. */
export interface BatchFailedItem {
  /** Issue id, or the source id for a monograph -- or a `(source ...)` marker for a whole-source failure. */
  itemId: string;
  /** The failing error's message (never the raw Error object -- summaries must serialize/print cleanly). */
  error: string;
}

/** The outcome of building every item of one source. */
export interface BuildSourceResult {
  sourceId: string;
  built: BatchBuiltItem[];
  failed: BatchFailedItem[];
}

/** Resolve the RawSource for `sourceId`, or fail loud naming it (G-2; mirrors build.ts's `selectSource`). */
function selectSource(sources: RawSource[], sourceId: string): RawSource {
  const source = sources.find((candidate) => candidate.sourceId === sourceId);
  if (source === undefined) {
    throw new Error(
      `buildSource: unknown source ${JSON.stringify(sourceId)} -- not in the committed snapshot ` +
        `(found: ${sources.map((s) => s.sourceId).join(', ') || 'none'}).`,
    );
  }
  return source;
}

/**
 * Every item id a source builds to: one per issue for a periodical, or the
 * single `[sourceId]` for a monograph -- matches `buildItem`'s monograph
 * convention (itemId === sourceId; see build.ts's `selectIssue`).
 */
function enumerateItemIds(source: RawSource): string[] {
  if (source.kind === 'monograph') {
    return [source.sourceId];
  }
  return source.issues.map((issue) => issue.issueId);
}

/**
 * Lists every committed snapshot source id under `snapshotDirAbs` -- one per
 * `<sourceId>.json.gz` file (the pin sidecar `archive-source.json` is not a
 * source and is excluded by the `.json.gz` suffix check). Sorted for a
 * deterministic, reproducible `--all` build order (T026/SC-004).
 */
export function listSnapshotSourceIds(snapshotDirAbs: string): string[] {
  return readdirSync(snapshotDirAbs)
    .filter((name) => name.endsWith(SNAPSHOT_SUFFIX))
    .map((name) => name.slice(0, -SNAPSHOT_SUFFIX.length))
    .sort();
}

/** Resolve the (possibly-relative) configured snapshot dir to an absolute path. */
function resolveSnapshotDirAbs(env: NodeJS.ProcessEnv): string {
  const config = resolvePdfConfig(env);
  return path.isAbsolute(config.snapshotDir)
    ? config.snapshotDir
    : path.join(resolveRepoRoot(), config.snapshotDir);
}

/**
 * Build every item of ONE source (contracts/cli.md: the bare `<sourceId>`
 * selector). G-4: each item is built independently via `buildItem`; a
 * per-item failure is caught and recorded (never thrown), so one broken
 * item cannot prevent its siblings from building. Returns both the built
 * and failed lists -- the caller (CLI) decides how to report/exit.
 *
 * @throws Error only for a batch-level problem: an unknown `sourceId` (G-2)
 *   or a source with zero items to build. Both name the source directly
 *   rather than being folded into `failed` -- there is no sibling item in
 *   this batch to keep building.
 */
export async function buildSource(
  sourceId: string,
  opts: BuildItemOptions = {},
): Promise<BuildSourceResult> {
  const env = opts.env ?? process.env;
  const config = resolvePdfConfig(env);
  const snapshotReader: CorpusSnapshotReader =
    opts.snapshotReader ?? makeCorpusSnapshotReader(config.snapshotDir);

  const rawSnapshot = snapshotReader.read(sourceId);
  const source = selectSource(rawSnapshot.sources, sourceId);
  const itemIds = enumerateItemIds(source);
  if (itemIds.length === 0) {
    throw new Error(`buildSource: source ${JSON.stringify(sourceId)} has zero items to build.`);
  }

  const built: BatchBuiltItem[] = [];
  const failed: BatchFailedItem[] = [];

  for (const itemId of itemIds) {
    try {
      // Reuse the same snapshotReader across every item so a batch build
      // reads the source's snapshot file exactly once (and so an injected
      // test fake sees a single, consistent view).
      const { outPath } = await buildItem(sourceId, itemId, { ...opts, snapshotReader });
      built.push({ itemId, outPath });
    } catch (error) {
      failed.push({
        itemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { sourceId, built, failed };
}

/**
 * Build every item of EVERY committed snapshot source (contracts/cli.md
 * `--all`). Sources are built in the deterministic (sorted) order from
 * `listSnapshotSourceIds`. A whole source failing (e.g. `buildSource`'s
 * batch-level throw for an empty source) is caught here and folded into that
 * source's own `BuildSourceResult.failed` list under a `(source ...)`
 * marker id -- G-4's attributable, record-and-continue guarantee extends to
 * the whole-corpus batch, not just to individual items within one source.
 *
 * @throws Error if no committed snapshot sources are found under the
 *   resolved snapshot dir (a fail-loud empty-run guard -- distinct from a
 *   per-source failure, since there is nothing at all to attribute).
 */
export async function buildAll(opts: BuildItemOptions = {}): Promise<BuildSourceResult[]> {
  const env = opts.env ?? process.env;
  const sourceIds = listSnapshotSourceIds(resolveSnapshotDirAbs(env));
  if (sourceIds.length === 0) {
    throw new Error(
      'buildAll: no committed snapshot sources found (expected one or more <sourceId>.json.gz ' +
        'files under the snapshot dir). Run "npm run site:snapshot" first.',
    );
  }

  const results: BuildSourceResult[] = [];
  for (const sourceId of sourceIds) {
    try {
      results.push(await buildSource(sourceId, opts));
    } catch (error) {
      results.push({
        sourceId,
        built: [],
        failed: [
          {
            itemId: `(source ${sourceId})`,
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }
  return results;
}
