import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { assertValidArk } from '@/gallica/ark';

/** Fixed sibling directory name of the private archive (FR-006). */
const ARCHIVE_DIR_NAME = 'colony-cults-archive';

/**
 * The archive-relative layout for a source. There is no fallback: an unknown
 * source ID throws (the layout is authoritative metadata, not a default).
 *
 * `kind` (FR-016) distinguishes a periodical (many dated issues, enumerated by
 * a census) from a monograph (a single Gallica document ark with no census --
 * one "issue" is the whole document). It determines which directory shape a
 * source's pages are written into: {@link issueDir} (dated per-issue
 * subdirectories) for `periodical`, {@link monographDir} (one flat directory)
 * for `monograph`.
 */
export interface SourceLayout {
  /** Case folder, e.g. `port-breton`. */
  case: string;
  /** Material-type folder, e.g. `newspapers`, `books`. */
  type: string;
  /** Source slug, e.g. `la-nouvelle-france`. */
  slug: string;
  /** Periodical (census-driven, dated issue dirs) or monograph (single doc). */
  kind: 'periodical' | 'monograph';
}

/**
 * Known source -> archive layout mapping, conforming to the archive repo's
 * existing on-disk convention (see specs/.../data-model.md § On-disk layout
 * and the archive's `acquisition-register.csv`). Extended per source as new
 * sources are onboarded.
 */
const SOURCE_LAYOUTS: Readonly<Record<string, SourceLayout>> = {
  'PB-P001': {
    case: 'port-breton',
    type: 'newspapers',
    slug: 'la-nouvelle-france',
    kind: 'periodical',
  },
  'PB-P002': {
    case: 'port-breton',
    type: 'books',
    slug: 'nouvelle-france-colonie-libre-port-breton',
    kind: 'monograph',
  },
  'PB-P003': {
    case: 'port-breton',
    type: 'books',
    slug: 'baudouin-aventure-port-breton-1883',
    kind: 'monograph',
  },
};

/**
 * Resolve the archive layout (case / type / slug) for a source ID, failing
 * loud for an unregistered source -- the layout is authoritative metadata, not
 * a default. Shared by {@link issueDir} and the provenance layer.
 */
export function sourceLayout(sourceId: string): SourceLayout {
  const layout = SOURCE_LAYOUTS[sourceId];
  if (layout === undefined) {
    throw new Error(
      `sourceLayout: no archive layout registered for source "${sourceId}"`,
    );
  }
  return layout;
}

/** Minimal issue shape needed to name its directory. */
export interface IssueLocation {
  /** Issue ark, e.g. `bpt6k5603637g`. */
  ark: string;
  /** Normalized issue date, `YYYY-MM-DD`. */
  date: string;
}

/**
 * Resolve the private archive root, with an explicit resolution precedence
 * (FR-014) so dev/test can target a dedicated worktree instead of the fixed
 * sibling clone:
 *
 *   1. `override`, if provided and non-empty -- an explicit, caller-supplied
 *      archive root (e.g. threaded through from a CLI flag).
 *   2. `env.COLONY_ARCHIVE_ROOT`, if set and non-empty.
 *   3. The fixed sibling `../colony-cults-archive` relative to `repoRoot`
 *      (FR-006), unchanged default behavior for existing callers.
 *
 * Always returns an absolute path. `env` defaults to `process.env` so
 * existing callers (`resolveArchiveRoot(repoRoot)`) keep working unchanged.
 */
export function resolveArchiveRoot(
  repoRoot: string,
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (repoRoot.trim().length === 0) {
    throw new Error('resolveArchiveRoot: repoRoot is required');
  }
  if (override !== undefined && override.trim().length > 0) {
    return path.resolve(override);
  }
  const envRoot = env.COLONY_ARCHIVE_ROOT;
  if (envRoot !== undefined && envRoot.trim().length > 0) {
    return path.resolve(envRoot);
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
 * loud) for a source ID with no registered layout, or one not registered as
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
