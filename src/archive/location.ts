import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Fixed sibling directory name of the private archive (FR-006). */
const ARCHIVE_DIR_NAME = 'colony-cults-archive';

/**
 * The archive-relative layout for a source. There is no fallback: an unknown
 * source ID throws (the layout is authoritative metadata, not a default).
 */
interface SourceLayout {
  /** Case folder, e.g. `port-breton`. */
  case: string;
  /** Material-type folder, e.g. `newspapers`. */
  type: string;
  /** Source slug, e.g. `la-nouvelle-france`. */
  slug: string;
}

/**
 * Known source -> archive layout mapping, conforming to the archive repo's
 * existing on-disk convention (see specs/.../data-model.md § On-disk layout).
 * Extended per source as new sources are onboarded.
 */
const SOURCE_LAYOUTS: Readonly<Record<string, SourceLayout>> = {
  'PB-P001': {
    case: 'port-breton',
    type: 'newspapers',
    slug: 'la-nouvelle-france',
  },
};

/** Minimal issue shape needed to name its directory. */
export interface IssueLocation {
  /** Issue ark, e.g. `bpt6k5603637g`. */
  ark: string;
  /** Normalized issue date, `YYYY-MM-DD`. */
  date: string;
}

/**
 * Resolve the private archive location as the fixed sibling path
 * `../colony-cults-archive` relative to the public repository root (FR-006).
 * Returns an absolute path; no configuration, no override.
 */
export function resolveArchiveRoot(repoRoot: string): string {
  if (repoRoot.trim().length === 0) {
    throw new Error('resolveArchiveRoot: repoRoot is required');
  }
  return path.resolve(repoRoot, '..', ARCHIVE_DIR_NAME);
}

/**
 * Absolute path of one issue's directory inside the archive:
 * `<archiveRoot>/archive/cases/<case>/<type>/<slug>/<date>_<ark>/`.
 * Throws (fail loud) for a source ID with no registered layout.
 */
export function issueDir(
  sourceId: string,
  issue: IssueLocation,
  archiveRoot: string,
): string {
  const layout = SOURCE_LAYOUTS[sourceId];
  if (layout === undefined) {
    throw new Error(
      `issueDir: no archive layout registered for source "${sourceId}"`,
    );
  }
  if (issue.ark.trim().length === 0 || issue.date.trim().length === 0) {
    throw new Error(
      `issueDir: issue ark and date are required (got ark="${issue.ark}", date="${issue.date}")`,
    );
  }
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
 * Resolve a path to the real absolute path of its nearest EXISTING ancestor,
 * with the not-yet-created trailing segments re-appended. This makes the guard
 * robust to symlinked roots (e.g. macOS `/var` -> `/private/var`) and to paths
 * that do not exist yet (the asset we are about to write).
 */
function realResolve(target: string): string {
  let current = path.resolve(target);
  const trailing: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return trailing.length === 0
        ? real
        : path.join(real, ...trailing.slice().reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached the filesystem root without finding an existing ancestor.
        return path.resolve(target);
      }
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * NON-OVERRIDABLE write-guard (FR-006): throw unless `absPath` resolves to a
 * location STRICTLY inside `archiveRoot`. Guards against `../` escapes and
 * absolute paths outside the archive by resolving both operands to their real
 * absolute forms (collapsing `..` and following symlinks) and requiring the
 * target to be a proper descendant.
 *
 * There is no bypass parameter, by design.
 */
export function assertInsideArchive(absPath: string, archiveRoot: string): void {
  const realRoot = realResolve(archiveRoot);
  const realTarget = realResolve(absPath);
  const rel = path.relative(realRoot, realTarget);

  const inside =
    rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);

  if (!inside) {
    throw new Error(
      `archive guard: refusing to write "${absPath}" -- it resolves to ` +
        `"${realTarget}", which is outside the private archive root ` +
        `"${realRoot}" (no override exists)`,
    );
  }
}
