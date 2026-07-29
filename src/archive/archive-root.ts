import { realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Archive-ROOT resolution and the non-overridable write guard.
 *
 * Extracted verbatim from `@/archive/location` by T013 (spec
 * 018-corpus-config-seam). Neither function takes a sourceId nor consumes any
 * corpus policy, so keeping them here leaves this module DEPENDENCY-FREE --
 * which is what lets `@/bibliography/summary-reference` (reachable from
 * `@/bibliography/load`) import `assertInsideArchive` without creating an
 * import cycle through the layout-policy bootstrap, which loads the SSOT.
 * `@/archive/location` re-exports both, so its existing importers are
 * unaffected.
 */

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

/** True when `p` contains a `..` PATH SEGMENT (not merely the characters `..`). */
function hasParentSegment(p: string): boolean {
  return p.split(/[\\/]+/).includes('..');
}

/**
 * NON-OVERRIDABLE write-guard (FR-006): throw unless `absPath` resolves to a
 * location STRICTLY inside `archiveRoot`. Guards against `../` escapes and
 * absolute paths outside the archive by resolving both operands to their real
 * absolute forms (following symlinks) and requiring the target to be a proper
 * descendant.
 *
 * A `..` SEGMENT IS REFUSED OUTRIGHT rather than resolved (AUDIT-31). `..` is
 * not a lexical operation on the filesystem: `<root>/link/../x` where `link`
 * is a symlink out of the archive really resolves to `<link-target>/../x`,
 * NOT to `<root>/x`. Any normalization that folds `..` before following the
 * symlinks -- which is exactly what `path.resolve` does -- therefore measures a
 * path the kernel would never produce, and can report "inside" for a write
 * that lands outside. Rather than reimplement the kernel's interleaved
 * resolution, the guard declines to judge such a path at all. This costs
 * nothing: every caller builds its path with `path.join` (which normalizes
 * `..` away against real directory names), and `@/bibliography/
 * summary-reference` already rejects `..` before it calls in here.
 *
 * There is no bypass parameter, by design.
 */
export function assertInsideArchive(absPath: string, archiveRoot: string): void {
  if (hasParentSegment(absPath)) {
    throw new Error(
      `archive guard: refusing to write "${absPath}" -- it contains a parent-directory ` +
        '(`..`) segment, whose meaning depends on symlinks that have not been followed yet, ' +
        'so it cannot be proven to stay inside the private archive root ' +
        `"${archiveRoot}". Pass an already-normalized path (no override exists)`,
    );
  }
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
