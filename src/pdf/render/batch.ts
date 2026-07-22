/**
 * Batch build orchestration (T025, spec 007 US2; archive-direct T009, spec
 * 014): scale the single-item `buildItem` orchestrator (`./build.ts`) across
 * every item of one source (`buildSource`) or every buildable source in the
 * private archive (`buildAll`).
 *
 * G-1 (one PDF per item) is inherited from `buildItem` -- this module adds
 * enumeration (which items a source/corpus has) and G-4 (attributable,
 * record-and-continue failure, contracts/cli.md): each item is built
 * independently; a per-item failure is caught, recorded with the item id +
 * message, and does NOT abort sibling builds. `buildAll` extends the same
 * record-and-continue posture to a whole source failing (e.g. an
 * unregistered or empty source) so one bad source cannot silently kill the
 * rest of the corpus batch. The CLI (`scripts/build-pdf.ts`) turns the
 * returned failure lists into the printed summary + a non-zero exit -- a
 * batch with any failure is never silently "OK".
 *
 * Archive-direct (spec 014, T009): `buildSource`/`buildAll` enumerate items
 * DIRECTLY from the private archive (`@/pdf/load/archive-source`'s
 * `resolveArchiveSource`) -- no committed snapshot is read here anymore.
 * `buildAll` discovers its candidate sources from the bibliography SSOT
 * (`bibliography/sources/*.yml`), filtered to those with a registered archive
 * layout (`@/archive/location`'s `sourceLayout`) AND an existing archive
 * directory under the resolved archive root -- a source with nothing on disk
 * is simply not attempted, matching the archive-direct build's own I/O
 * boundary rather than a committed-snapshot listing.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '@/browser/load/repo-root';
import { loadAllSources, loadSourceFile } from '@/bibliography/load';
import { authoredToRepositoryRecord } from '@/bibliography/authored-record';
import {
  isSourceLayoutRegistered,
  monographDir,
  resolveArchiveRoot,
  sourceLayout,
} from '@/archive/location';
import { ensureMemberLayoutRegistered } from '@/archive/member-layout';
import { resolveObjectStoreConfig } from '@/archive/b2-config';
import { S3ObjectStore } from '@/archive/s3-object-store';
import type { ObjectStore } from '@/archive/object-store';
import { buildItem, type BuildItemOptions } from '@/pdf/render/build';
import { buildMemberItem } from '@/pdf/render/member-build';
import type { MemberWithRecords } from '@/pdf/render/member-edition';
import { resolveArchiveSource, type ArchiveSourceResolution } from '@/pdf/load/archive-source';

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

/**
 * `BuildItemOptions` plus an optional injected `ObjectStore` -- threaded
 * through to `buildMemberItem` (spec 017 T008) when `sourceId` resolves to a
 * source-group member. Tests inject a fake store; production (no injection)
 * gets a real `S3ObjectStore` constructed on demand (see
 * {@link resolveMemberObjectStore}), so the non-member path never pays for
 * (or requires) B2 credentials it does not need.
 */
export interface BatchBuildOptions extends BuildItemOptions {
  objectStore?: ObjectStore;
}

/**
 * Load `sourceId`'s bibliography SSOT entry and, if it is a spec-017
 * source-group MEMBER, return it widened to `MemberWithRecords` (its
 * `AuthoredRepositoryRecord[]` promoted to full `RepositoryRecord[]` via
 * `authoredToRepositoryRecord`). Returns `undefined` for a non-member source,
 * one with no SSOT file at all (an unregistered id the normal
 * `resolveArchiveSource` path will reject with its own clearer error), or a
 * source that merely carries a bibliographic `partOf` edge WITHOUT the
 * spec-017 acquisition shape.
 *
 * `partOf !== undefined` alone is NOT sufficient: `partOf` is also authored
 * on sources that predate spec 017 and are fetched/built through the
 * ordinary archive-direct path regardless (e.g. `PB-P054`, a `partOf:
 * PB-P004` excerpt fetched via the Gallica page-range pipeline, statically
 * registered in `SOURCE_LAYOUTS`, with real folios + inline `issue.txt` on
 * disk -- routing it here would wrongly swallow its batch-level "no folio
 * sidecars" throw into a caught per-item failure). A spec-017 member is
 * additionally, and uniquely, identified by carrying at least one
 * `page-master`-role asset (the N segment images `bib acquire`/`bib
 * inventory` recorded) -- see `@/pdf/render/member-edition`'s
 * `collectPageMasterSegments`, which requires the same shape.
 *
 * A single-file read (`loadSourceFile`), not a whole-directory scan
 * (`loadAllSources`) -- `buildSource` is called once per source in a
 * `buildAll` batch over potentially every bibliography entry, so this stays
 * O(1) per call rather than O(N) per call (O(N^2) over the whole batch).
 */
function loadMemberCandidate(
  sourceId: string,
  bibliographyDir: string,
): MemberWithRecords | undefined {
  const filePath = path.join(bibliographyDir, `${sourceId}.yml`);
  if (!existsSync(filePath)) {
    return undefined;
  }
  const { source, records } = loadSourceFile(filePath);
  if (source.partOf === undefined) {
    return undefined;
  }
  const repositoryRecords = records.map((record) => authoredToRepositoryRecord(sourceId, record));
  const hasPageMasterAssets = repositoryRecords.some((record) =>
    (record.assets ?? []).some((asset) => asset.role === 'page-master'),
  );
  if (!hasPageMasterAssets) {
    return undefined;
  }
  return { ...source, repositoryRecords };
}

/**
 * Resolve the `ObjectStore` a member build fetches its `ocr-text` asset
 * through: the injected one (tests), else a real B2-backed `S3ObjectStore`
 * constructed from env/credentials (`resolveObjectStoreConfig`) -- fails
 * loud (naming the missing env var/credentials file) if neither is
 * available, exactly like every other `--object-store` consumer in this repo.
 */
function resolveMemberObjectStore(injected: ObjectStore | undefined): ObjectStore {
  if (injected !== undefined) {
    return injected;
  }
  return new S3ObjectStore(resolveObjectStoreConfig());
}

/**
 * Every item id a source builds to, straight from its archive resolution:
 * one per issue for a periodical, or the single `[sourceId]` for a monograph
 * -- matches `buildItem`'s monograph convention (itemId === sourceId).
 */
function enumerateArchiveItemIds(resolution: ArchiveSourceResolution): string[] {
  if (resolution.kind === 'monograph') {
    return [resolution.sourceId];
  }
  return resolution.issues.map((issue) => issue.issueId);
}

/**
 * Absolute path of a periodical source's per-source archive directory
 * (mirrors `@/pdf/load/archive-source`'s private `resolvePeriodical` path
 * shape -- that helper is not exported, so the shape is reproduced here for
 * the existence check only; folio enumeration itself always goes through
 * `resolveArchiveSource`).
 */
function periodicalSourceDir(sourceId: string, archiveRoot: string): string {
  const layout = sourceLayout(sourceId);
  return path.join(archiveRoot, 'archive', 'cases', layout.case, layout.type, layout.slug);
}

/**
 * True when `sourceId` has a registered archive layout AND an existing
 * archive directory under `archiveRoot` -- the discoverability test
 * `buildAll` applies to every bibliography-listed source.
 */
function hasArchiveDir(sourceId: string, archiveRoot: string): boolean {
  if (!isSourceLayoutRegistered(sourceId)) {
    return false;
  }
  const layout = sourceLayout(sourceId);
  const dir =
    layout.kind === 'monograph'
      ? monographDir(sourceId, archiveRoot)
      : periodicalSourceDir(sourceId, archiveRoot);
  return existsSync(dir);
}

/**
 * Discover every buildable source id: every source in the bibliography SSOT
 * (`bibliography/sources/*.yml`) that both has a registered archive layout
 * and an existing archive directory under `archiveRoot`. Sorted for a
 * deterministic, reproducible `--all` build order (T026/SC-004).
 *
 * Spec 017 T002: `ensureMemberLayoutRegistered` (`@/archive/member-layout`)
 * runs for EVERY loaded bibliography source BEFORE the `hasArchiveDir`
 * filter -- a source-group MEMBER (e.g. PB-P061) is never hand-added to the
 * static `SOURCE_LAYOUTS` registry, so without this its layout stays
 * unregistered and `hasArchiveDir` (which checks `isSourceLayoutRegistered`
 * first) always excludes it, no matter how much is on disk. The call is a
 * no-op for every already-registered source, non-member, or source-group
 * (see the bridge's own doc comment), so this is safe across the whole
 * bibliography.
 */
function discoverBuildableSourceIds(repoRoot: string, archiveRoot: string): string[] {
  const bibliographyDir = path.join(repoRoot, 'bibliography', 'sources');
  const sourceIds = loadAllSources(bibliographyDir).map((loaded) => loaded.source.sourceId);
  for (const sourceId of sourceIds) {
    ensureMemberLayoutRegistered(sourceId, bibliographyDir);
  }
  return sourceIds.filter((sourceId) => hasArchiveDir(sourceId, archiveRoot)).sort();
}

/**
 * Build every item of ONE source (contracts/cli.md: the bare `<sourceId>`
 * selector). G-4: each item is built independently via `buildItem`; a
 * per-item failure is caught and recorded (never thrown), so one broken
 * item cannot prevent its siblings from building. Returns both the built
 * and failed lists -- the caller (CLI) decides how to report/exit.
 *
 * @throws Error only for a batch-level problem: no registered archive layout,
 *   no archive directory, no folio sidecars (`resolveArchiveSource`'s own
 *   throws surface unchanged), or an otherwise-resolved periodical with zero
 *   issues. All name the source directly rather than being folded into
 *   `failed` -- there is no sibling item in this batch to keep building.
 */
export async function buildSource(
  sourceId: string,
  opts: BatchBuildOptions = {},
): Promise<BuildSourceResult> {
  const env = opts.env ?? process.env;
  const repoRoot = resolveRepoRoot();
  const archiveRoot = resolveArchiveRoot(repoRoot, opts.archiveRoot, env);
  const bibliographyDir = path.join(repoRoot, 'bibliography', 'sources');

  // Spec 017 T002: a source-group MEMBER (e.g. PB-P061) is never hand-added
  // to the static `SOURCE_LAYOUTS` registry -- derive+register its layout
  // BEFORE `resolveArchiveSource` needs it (a no-op for every other source,
  // see the bridge's own doc comment).
  ensureMemberLayoutRegistered(sourceId, bibliographyDir);

  // Spec 017 T008: a source-group MEMBER collapses its N page-master
  // segments into ONE PDF page via `buildMemberItem`, an entirely different
  // (non-`resolveArchiveSource`) path -- record-and-continue (G-4) applies
  // here exactly as it does to the per-item loop below, so a member's own
  // failure (e.g. no `ObjectStore` configured) never throws out of
  // `buildSource`, it lands in `failed` under the member's own id.
  const member = loadMemberCandidate(sourceId, bibliographyDir);
  if (member !== undefined) {
    const built: BatchBuiltItem[] = [];
    const failed: BatchFailedItem[] = [];
    try {
      const objectStore = resolveMemberObjectStore(opts.objectStore);
      const { outPath } = await buildMemberItem(member, { ...opts, archiveRoot, objectStore });
      built.push({ itemId: sourceId, outPath });
    } catch (error) {
      failed.push({
        itemId: sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { sourceId, built, failed };
  }

  const resolution = await resolveArchiveSource({ sourceId, archiveRoot });
  const itemIds = enumerateArchiveItemIds(resolution);
  if (itemIds.length === 0) {
    throw new Error(`buildSource: source ${JSON.stringify(sourceId)} has zero items to build.`);
  }

  const built: BatchBuiltItem[] = [];
  const failed: BatchFailedItem[] = [];

  for (const itemId of itemIds) {
    try {
      const { outPath } = await buildItem(sourceId, itemId, { ...opts, archiveRoot });
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
 * Build every item of EVERY buildable source in the private archive
 * (contracts/cli.md `--all`). Sources are built in the deterministic
 * (sorted) order from `discoverBuildableSourceIds`. A whole source failing
 * (e.g. `buildSource`'s batch-level throw for an empty or malformed source)
 * is caught here and folded into that source's own `BuildSourceResult.failed`
 * list under a `(source ...)` marker id -- G-4's attributable,
 * record-and-continue guarantee extends to the whole-corpus batch, not just
 * to individual items within one source.
 *
 * @throws Error if no buildable sources are found under the resolved archive
 *   root (a fail-loud empty-run guard -- distinct from a per-source failure,
 *   since there is nothing at all to attribute).
 */
export async function buildAll(opts: BatchBuildOptions = {}): Promise<BuildSourceResult[]> {
  const env = opts.env ?? process.env;
  const repoRoot = resolveRepoRoot();
  const archiveRoot = resolveArchiveRoot(repoRoot, opts.archiveRoot, env);

  const sourceIds = discoverBuildableSourceIds(repoRoot, archiveRoot);
  if (sourceIds.length === 0) {
    throw new Error(
      `buildAll: no buildable sources found under the archive root ${archiveRoot} (expected ` +
        'one or more bibliography sources with a registered archive layout and an existing ' +
        'archive directory).',
    );
  }

  const results: BuildSourceResult[] = [];
  for (const sourceId of sourceIds) {
    try {
      results.push(await buildSource(sourceId, { ...opts, archiveRoot }));
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
