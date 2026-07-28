import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { assertValidArk } from '@/gallica/ark';
import { sourceLayout } from '@/archive/layout-resolve';

/**
 * Archive PATH construction: where a source's issues/documents live inside the
 * private archive worktree.
 *
 * T013 (spec 018-corpus-config-seam) retired the static `SOURCE_LAYOUTS` map
 * that used to live here -- coupling point #4 of five. A source's layout is
 * now resolved by `@/archive/layout-resolve` in the FR-017 total order
 * (manifest `archiveLayoutOverrides` -> runtime overlay -> precomputed
 * generic derivation -> throw), from a policy composed by
 * `@/archive/layout-bootstrap`. Splitting those out (plus the pure derivation
 * in `@/archive/derive-layout` and the root/guard pair in
 * `@/archive/archive-root`) keeps every file inside the 300-500 line limit.
 *
 * This module re-exports that whole surface, so the ~40 modules importing
 * `@/archive/location` keep working unchanged.
 */

export {
  deriveSourceLayout,
  layoutsEqual,
  type SourceLayout,
} from '@/archive/derive-layout';
export {
  installArchiveLayoutPolicy,
  isSourceLayoutRegistered,
  registerSourceLayout,
  sourceLayout,
} from '@/archive/layout-resolve';
export { assertInsideArchive, resolveArchiveRoot } from '@/archive/archive-root';

/** Minimal issue shape needed to name its directory. */
export interface IssueLocation {
  /** Issue ark, e.g. `bpt6k5603637g`. */
  ark: string;
  /** Normalized issue date, `YYYY-MM-DD`. */
  date: string;
}

/**
 * Absolute path of one issue's directory inside the archive:
 * `<archiveRoot>/archive/cases/<case>/<type>/<slug>/<date>_<ark>/`.
 * Throws (fail loud) for a source ID with no resolvable layout.
 */
export function issueDir(
  sourceId: string,
  issue: IssueLocation,
  archiveRoot: string,
): string {
  const layout = sourceLayout(sourceId);
  if (issue.ark.trim().length === 0 || issue.date.trim().length === 0) {
    throw new Error(
      `issueDir: issue ark and date are required (got ark="${issue.ark}", date="${issue.date}")`,
    );
  }
  // Defense-in-depth: the ark is spliced into the directory name, so reject a
  // malformed one (path separators, `..`, whitespace) before building a path.
  assertValidArk(issue.ark.trim());
  return path.join(
    archiveRoot,
    'archive',
    'cases',
    layout.case,
    layout.type,
    layout.slug,
    `${issue.date}_${issue.ark}`,
  );
}

/**
 * Absolute path of a monograph source's single document directory (FR-016):
 * `<archiveRoot>/archive/cases/<case>/<type>/<slug>/`. Unlike {@link issueDir}
 * there is no dated subdirectory -- a monograph source has exactly one
 * document, so its slug directory holds the pages directly. Throws (fail
 * loud) for a source ID with no resolvable layout, or one whose layout is not
 * `kind: 'monograph'`.
 */
export function monographDir(sourceId: string, archiveRoot: string): string {
  const layout = sourceLayout(sourceId);
  if (layout.kind !== 'monograph') {
    throw new Error(
      `monographDir: source "${sourceId}" is registered as kind ` +
        `"${layout.kind}", not "monograph"`,
    );
  }
  return path.join(
    archiveRoot,
    'archive',
    'cases',
    layout.case,
    layout.type,
    layout.slug,
  );
}

/**
 * Absolute path of a source's OWN directory -- the parent of every dated
 * issue subdirectory for a `periodical` (`<archiveRoot>/archive/cases/<case>/
 * <type>/<slug>/`), or the SAME directory {@link monographDir} resolves for a
 * `monograph` (there, it holds the document's pages directly instead of dated
 * issue subdirectories). The per-source ROLLUP summary (spec 017 US4,
 * `source.summary.long.en.md` / `source.summary.short.en.md`) is always
 * written here, one level above any per-issue artifact. Throws (fail loud)
 * for a source ID with no resolvable layout, same as {@link issueDir} /
 * {@link monographDir}.
 */
export function sourceRootDir(sourceId: string, archiveRoot: string): string {
  const layout = sourceLayout(sourceId);
  return path.join(archiveRoot, 'archive', 'cases', layout.case, layout.type, layout.slug);
}

/**
 * Locate an already-fetched issue's directory purely from what is on disk:
 * the reverse of {@link issueDir}, used by the `ocr` command (T031) so it
 * never needs the issue's date (no census lookup, no network) -- it just
 * finds the one entry under the source's directory whose name ends with
 * `_<bareArk>`. Throws (fail loud) when the source has nothing fetched yet,
 * or when no directory matches the ark -- OCR only ever operates on images
 * that already exist.
 */
export function findIssueDir(
  sourceId: string,
  issueArk: string,
  archiveRoot: string,
): string {
  const layout = sourceLayout(sourceId);
  const bareArk = assertValidArk(issueArk.trim().replace(/^ark:\/12148\//, ''));
  const sourceDir = path.join(
    archiveRoot,
    'archive',
    'cases',
    layout.case,
    layout.type,
    layout.slug,
  );
  if (!existsSync(sourceDir)) {
    throw new Error(
      `findIssueDir: no fetched issues found for source "${sourceId}" ` +
        `(missing ${sourceDir}) -- run fetch-issue/fetch-source first`,
    );
  }
  const match = readdirSync(sourceDir).find((name) => name.endsWith(`_${bareArk}`));
  if (match === undefined) {
    throw new Error(
      `findIssueDir: no fetched issue directory found for ark "${bareArk}" ` +
        `under ${sourceDir} -- fetch its images first`,
    );
  }
  return path.join(sourceDir, match);
}

/**
 * Resolve an already-fetched source's on-disk directory for a per-document
 * command (`ocr`, `restore-images`), branching on the resolved `kind`:
 *  - `monograph`: the one flat {@link monographDir} (the `issueArk` names the
 *    single document but is not needed to locate it); throws if it is not
 *    fetched yet.
 *  - `periodical`: {@link findIssueDir} for the dated issue matching `issueArk`.
 *
 * Fails loud (no fallback) for an unresolvable source or an unfetched target.
 * This is the reverse-lookup counterpart shared by commands that operate on an
 * existing document regardless of its layout.
 */
export function resolveFetchedDir(
  sourceId: string,
  issueArk: string,
  archiveRoot: string,
): string {
  if (sourceLayout(sourceId).kind === 'monograph') {
    const dir = monographDir(sourceId, archiveRoot);
    if (!existsSync(dir)) {
      throw new Error(
        `resolveFetchedDir: no fetched document found for monograph source ` +
          `"${sourceId}" (missing ${dir}) -- run fetch-source first`,
      );
    }
    return dir;
  }
  return findIssueDir(sourceId, issueArk, archiveRoot);
}
