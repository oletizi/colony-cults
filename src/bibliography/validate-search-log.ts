import path from 'node:path';

import type { SearchLogEntry } from '@/bibliography/search-log';
import { loadSearchLog } from '@/bibliography/search-log';

/**
 * Load + structurally validate `bibliography/search-log.yml` under
 * `repoRoot`, the same way `bib validate`'s `runValidate`
 * (`@/cli/bibliography`) resolves `sourcesDir` under it (`path.join(repoRoot,
 * 'bibliography', ...)`). `loadSearchLog` itself enforces V6 (unique `id`)
 * and V7 (required entry fields) -- see specs/007-corpus-coverage-audit/
 * data-model.md -- failing loud on a malformed file; this wrapper's only job
 * is resolving the path `runValidate` calls it with, so `bib validate` fails
 * loud on a malformed search-log the same way it already does on a malformed
 * SSOT source file, rather than that only surfacing later via `bib coverage`.
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
