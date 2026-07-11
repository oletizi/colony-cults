/**
 * Resolves the repo root -- the nearest ancestor directory that contains
 * `bibliography/sources/`.
 *
 * Anchored on this module's own location and walked upward (rather than a fixed
 * offset) so it is correct whether the module runs from source (`src/browser/
 * load/*.ts`, e.g. under vitest/tsx) or from a bundle that a build tool emitted
 * deeper inside the repo (e.g. Astro's `site/dist/...` server output, whose
 * ancestors still include the repo root). `bibliography/sources/` is committed
 * to this repo (public metadata), so the anchor is present even on a deploy
 * that has no private archive clone. Fail-loud: throws if no such ancestor
 * exists rather than returning a wrong path.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveRepoRoot(): string {
  const start = path.dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, 'bibliography', 'sources'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        'resolveRepoRoot: could not locate the repo root -- no ancestor of ' +
          `${JSON.stringify(start)} contains a "bibliography/sources" directory.`
      );
    }
    dir = parent;
  }
}
