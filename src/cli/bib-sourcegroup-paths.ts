/**
 * Shared path-resolution helpers for the `bib` source-group CLI handlers,
 * split out of `src/cli/bib-sourcegroup.ts` so `src/cli/bib-inventory.ts`
 * (T017) can depend on them without a circular import back into
 * `bib-sourcegroup.ts` (which re-exports `resolveRepoRoot` for its own
 * existing external importers).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the repo root from THIS module's location -- `src/cli/` is two
 * levels below the repo root -- so a `bib` subaction behaves the same
 * regardless of the caller's `process.cwd()`.
 */
export function resolveRepoRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '..', '..');
}

/** The one-file-per-source SSOT directory under the repo root. */
export function sourcesDirOf(repoRoot: string): string {
  return path.join(repoRoot, 'bibliography', 'sources');
}
