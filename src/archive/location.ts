import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { assertValidArk } from '@/gallica/ark';
import type { Source } from '@/model/source';

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
  // The de Groote 1880 book, acquired via the Internet Archive adapter (spec 013).
  // Registered so `sourceLayout` resolves it for the translator/OCR the same way
  // its companions are filed (matches deriveSourceLayout's slug for this title).
  'PB-P055': {
    case: 'port-breton',
    type: 'books',
    slug: 'nouvelle-france-colonie-libre-de-port-breton-oceanie-uvre-de-colonisation',
    kind: 'monograph',
  },
  // The Cour de cassation extract (an excerpt within a larger serial fascicule,
  // acquired page-range-only via spec 012's `fetch-source --pages`). Registered
  // so `sourceLayout` resolves it for the translator/OCR; slug verified against
  // the archive clone's on-disk directory (folio sidecar `id: "PB-P054"`).
  'PB-P054': {
    case: 'port-breton',
    type: 'books',
    slug: 'cour-de-cassation-chambre-criminelle-arret-de-rejet-du-pourvoi-de-charles',
    kind: 'monograph',
  },
};

/**
 * Runtime overlay of source -> archive layout, ADDITIVE to (never replacing)
 * the static {@link SOURCE_LAYOUTS} registry above. Exists so a source-group
 * member -- created at runtime by the acquisition pipeline (`bib inventory`),
 * never hand-added to the static registry -- can still resolve a layout when
 * `bib acquire` drives it through the shipped fetcher (which calls
 * {@link sourceLayout} deep inside, synchronously, sourceId-only). See
 * {@link registerSourceLayout} / {@link deriveSourceLayout}.
 */
const runtimeLayoutOverlay = new Map<string, SourceLayout>();

/** Structural equality for two {@link SourceLayout} values. */
function layoutsEqual(a: SourceLayout, b: SourceLayout): boolean {
  return a.case === b.case && a.type === b.type && a.slug === b.slug && a.kind === b.kind;
}

/**
 * Register (or idempotently re-register) a source's archive layout in the
 * runtime overlay -- NEVER the static registry, which stays hand-authored and
 * unchanged. Re-registering the SAME sourceId with an EQUAL layout is a no-op
 * (idempotent, so a retried `bib acquire` invocation does not fail); a
 * CONFLICTING re-registration (same id, different layout) throws -- fail
 * loud, since a source's archive location must never silently move under it.
 */
export function registerSourceLayout(sourceId: string, layout: SourceLayout): void {
  const existing = runtimeLayoutOverlay.get(sourceId);
  if (existing !== undefined && !layoutsEqual(existing, layout)) {
    throw new Error(
      `registerSourceLayout: source "${sourceId}" is already registered with a different ` +
        `layout (existing: ${JSON.stringify(existing)}, attempted: ${JSON.stringify(layout)})`,
    );
  }
  runtimeLayoutOverlay.set(sourceId, layout);
}

/**
 * True when a layout is already resolvable for `sourceId` -- the static
 * {@link SOURCE_LAYOUTS} registry OR the runtime overlay -- i.e. the
 * non-throwing predicate form of {@link sourceLayout}. Used by the member-layout
 * bridge to skip re-deriving a source that is already known (so a static source
 * is never re-registered under a divergent derived slug).
 */
export function isSourceLayoutRegistered(sourceId: string): boolean {
  return (
    SOURCE_LAYOUTS[sourceId] !== undefined || runtimeLayoutOverlay.has(sourceId)
  );
}

/**
 * Resolve the archive layout (case / type / slug) for a source ID. Resolution
 * order: the static {@link SOURCE_LAYOUTS} registry FIRST (existing sources'
 * behavior is unchanged), then the runtime overlay (source-group members
 * registered via {@link registerSourceLayout}), else throws -- the layout is
 * authoritative metadata, not a default. Shared by {@link issueDir} and the
 * provenance layer.
 */
export function sourceLayout(sourceId: string): SourceLayout {
  const staticLayout = SOURCE_LAYOUTS[sourceId];
  if (staticLayout !== undefined) {
    return staticLayout;
  }
  const overlayLayout = runtimeLayoutOverlay.get(sourceId);
  if (overlayLayout !== undefined) {
    return overlayLayout;
  }
  throw new Error(
    `sourceLayout: no archive layout registered for source "${sourceId}"`,
  );
}

/** Maximum length of a derived slug (see {@link deriveSourceLayout}). */
const MAX_DERIVED_SLUG_LENGTH = 80;

/**
 * Slugify free text into a lowercase, hyphen-separated archive slug: accents
 * transliterated to ASCII (`é` -> `e`) via Unicode NFD decomposition, lowercased,
 * any run of non-alphanumeric characters collapsed to a single `-`, leading/
 * trailing hyphens trimmed, and capped to {@link MAX_DERIVED_SLUG_LENGTH}
 * characters at a WORD boundary (never cutting mid-word or ending mid-hyphen).
 */
function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics: e-acute -> e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= MAX_DERIVED_SLUG_LENGTH) {
    return slug;
  }
  // Truncate at the last word boundary within the cap so the slug never ends
  // mid-word (a bare `slice` can chop "sténographie" to "st-no").
  const capped = slug.slice(0, MAX_DERIVED_SLUG_LENGTH);
  const lastHyphen = capped.lastIndexOf('-');
  const trimmed = lastHyphen > 0 ? capped.slice(0, lastHyphen) : capped;
  return trimmed.replace(/-+$/g, '');
}

/**
 * Derive a source-group member's slug from its titles: prefers the `canonical`
 * title, falling back to the first title of any role; falls back to the
 * lowercased `sourceId` when the source has no titles at all (or its titles
 * slugify to an empty string, e.g. a title that is pure punctuation).
 */
function deriveSlug(source: Source): string {
  const canonical = source.titles.find((title) => title.role === 'canonical');
  const chosenTitle = canonical ?? source.titles[0];
  const fromTitle = chosenTitle !== undefined ? slugify(chosenTitle.text) : '';
  return fromTitle.length > 0 ? fromTitle : slugify(source.sourceId);
}

/**
 * Derive a {@link SourceLayout} for a source-group member from its own data
 * (FR-016-adjacent) -- used to auto-register a runtime layout (via
 * {@link registerSourceLayout}) for a member that was never hand-added to the
 * static {@link SOURCE_LAYOUTS} registry. A member is always `monograph`,
 * `periodical`, or `archival-item`, never `source-group` (enforced by
 * `Source.kind` elsewhere; this function does not re-validate that).
 *
 * - `case`: `source.case` if present, else `fallbackCase` (e.g. the owning
 *   group's `case`). Throws (fail loud) if NEITHER is available -- a layout
 *   with no case cannot be placed in the archive's `cases/<case>/` tree.
 * - `type`: `newspapers` for a `periodical` source, `books` otherwise
 *   (including `archival-item`, which are discrete objects like monographs).
 * - `slug`: derived from the source's canonical (or first) title, lowercased
 *   with non-alphanumeric runs collapsed to `-`; falls back to the lowercased
 *   `sourceId` when the source has no usable title (see {@link deriveSlug}).
 * - `kind`: `periodical` for a periodical source, `monograph` otherwise
 *   (archival items are laid out like monographs).
 */
export function deriveSourceLayout(source: Source, fallbackCase?: string): SourceLayout {
  const resolvedCase = source.case ?? fallbackCase;
  if (resolvedCase === undefined || resolvedCase.trim().length === 0) {
    throw new Error(
      `deriveSourceLayout: source "${source.sourceId}" has no "case" and no fallback case was ` +
        `given -- an archive layout cannot be derived without one`,
    );
  }
  const isPeriodical = source.kind === 'periodical';
  return {
    case: resolvedCase,
    type: isPeriodical ? 'newspapers' : 'books',
    slug: deriveSlug(source),
    kind: isPeriodical ? 'periodical' : 'monograph',
  };
}

/** Minimal issue shape needed to name its directory. */
export interface IssueLocation {
  /** Issue ark, e.g. `bpt6k5603637g`. */
  ark: string;
  /** Normalized issue date, `YYYY-MM-DD`. */
  date: string;
}

/**
 * Resolve the private archive root from an EXPLICIT source only, in precedence
 * order -- never a silent shared default (TASK-19). The archive is a per-session
 * private worktree; a machine-global shared sibling clone would funnel
 * concurrent sessions into one working tree and corrupt it (the TASK-17
 * corruption class: non-ff pushes, add/add conflicts, `--checkpoint` sweeping
 * another session's files). B2 is the shared asset store; the working tree is not.
 *
 *   1. `override`, if provided and non-empty -- an explicit, caller-supplied
 *      archive root (e.g. threaded through from a CLI `--archive-root` flag).
 *   2. `env.COLONY_ARCHIVE_ROOT`, if set and non-empty.
 *   3. Neither set -> FAIL LOUD. There is no fallback (per the no-fallback rule
 *      and the per-session-archive-clone policy): silently resolving a
 *      might-be-wrong shared path is exactly the bug being removed.
 *
 * Returns an absolute path, or throws a descriptive Error naming both ways to
 * supply a root. `env` defaults to `process.env`.
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
  throw new Error(
    'resolveArchiveRoot: no archive root configured. Pass --archive-root <path> ' +
      'or set COLONY_ARCHIVE_ROOT to your own private per-session archive worktree. ' +
      'Refusing to default to a shared sibling clone (../colony-cults-archive): a shared ' +
      'archive working tree funnels concurrent sessions into one tree and corrupts it ' +
      '(TASK-19; per-session-archive-clone policy). B2 is the shared asset store, not the ' +
      'working tree.',
  );
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
 * Resolve an already-fetched source's on-disk directory for a per-document
 * command (`ocr`, `restore-images`), branching on the registered `kind`:
 *  - `monograph`: the one flat {@link monographDir} (the `issueArk` names the
 *    single document but is not needed to locate it); throws if it is not
 *    fetched yet.
 *  - `periodical`: {@link findIssueDir} for the dated issue matching `issueArk`.
 *
 * Fails loud (no fallback) for an unregistered source or an unfetched target.
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
