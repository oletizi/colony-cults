import path from 'node:path';

import { describeError } from '@/bibliography/load-primitives';
import type { ScopeResolutionContext } from '@/bibliography/scope';
import { resolveScopeRef } from '@/bibliography/scope';
import type { SearchLogEntry } from '@/bibliography/search-log';
import { loadSearchLog } from '@/bibliography/search-log';
import { loadScopesRegistry, threadIdSet } from '@/bibliography/scopes-registry';
import type { ValidationFinding } from '@/bibliography/validate';
import type { Source } from '@/model/source';

/** Where a search-log finding locates the offending entry. */
const SEARCH_LOG_PATH = 'bibliography/search-log.yml';

/**
 * Load + structurally validate `bibliography/search-log.yml` under
 * `repoRoot`, the same way `bib validate`'s `runValidate`
 * (`@/cli/bibliography`) resolves `sourcesDir` under it (`path.join(repoRoot,
 * 'bibliography', ...)`). `loadSearchLog` itself enforces V6 (unique `id`),
 * V7 (required entry fields), and the `campaign:` clean break (FR-004/
 * INV-CUT) -- see specs/007-corpus-coverage-audit/data-model.md and
 * specs/010-corpus-model-coherence/data-model.md -- failing loud on a
 * malformed file; this wrapper's only job is resolving the path `runValidate`
 * calls it with, so `bib validate` fails loud on a malformed search-log the
 * same way it already does on a malformed SSOT source file, rather than that
 * only surfacing later via `bib coverage`.
 *
 * Exported (rather than inlined in `runValidate`) so this wiring is directly
 * testable against a temp fixture root: `resolveRepoRoot()`
 * (`@/cli/bib-sourcegroup`) always resolves to this checked-out repo -- there
 * is no env-var/flag override for it, unlike `--archive-root` -- so a test
 * that needs a malformed search-log calls this function directly with a
 * temp `repoRoot` rather than going through the CLI.
 */
export function loadSearchLogForValidate(repoRoot: string): SearchLogEntry[] {
  return loadSearchLog(path.join(repoRoot, 'bibliography', 'search-log.yml'));
}

/**
 * Build the {@link ScopeResolutionContext} `validateSearchLogScopes` resolves
 * every search-log `scope:` against, from the real corpus under `repoRoot`:
 * `sources` are the already-loaded corpus Sources (the caller's `CanonicalModel
 * .sources`, per `@/bibliography/scope`'s injected-context contract -- this
 * module does no Source loading of its own), and `threadIds` come from
 * `bibliography/scopes.yml` (`@/bibliography/scopes-registry`'s
 * `loadScopesRegistry` + `threadIdSet`; a missing/empty registry yields an
 * empty set, per that loader's own fail-loud contract).
 */
export function buildScopeResolutionContext(
  repoRoot: string,
  sources: readonly Source[],
): ScopeResolutionContext {
  const registry = loadScopesRegistry(path.join(repoRoot, 'bibliography', 'scopes.yml'));
  return { sources, threadIds: threadIdSet(registry) };
}

/**
 * V-SCOPE: every search-log entry's `scope` MUST `resolveScopeRef` against
 * `ctx` (data-model.md § SearchLogEntry, contracts/scope-model.md's
 * search-log cutover clause). Like the retired V8/V9 campaign check this
 * replaces, this is a whole-corpus referential check -- the per-file
 * search-log loader (`@/bibliography/search-log`) only parses the `{kind,
 * id}` shape, it cannot see the Sources or the thread registry -- so it
 * lives here, as a `ValidationFinding` (fail loud AS DATA, never a throw:
 * throwing is reserved for malformed input upstream, per `@/bibliography/
 * validate`'s doc comment) rather than a load-time throw. Reports one
 * `search-log-scope-unresolved` finding per entry whose scope does not
 * resolve, naming the offending entry, its scope, and the resolution
 * failure's own message.
 */
export function validateSearchLogScopes(
  searchLog: readonly SearchLogEntry[],
  ctx: ScopeResolutionContext,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const entry of searchLog) {
    try {
      resolveScopeRef(entry.scope, ctx);
    } catch (error) {
      findings.push({
        kind: 'search-log-scope-unresolved',
        path: SEARCH_LOG_PATH,
        detail:
          `search-log entry "${entry.id}" scope { kind: "${entry.scope.kind}", ` +
          `id: "${entry.scope.id}" } does not resolve: ${describeError(error)}`,
      });
    }
  }
  return findings;
}
