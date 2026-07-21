/**
 * Leaf module holding the default grace-window parameters.
 *
 * This lives OUTSIDE `source-config.ts` on purpose. `source-config.ts`
 * value-imports `sources/papers-past.ts` at its bottom to auto-register
 * `PAPERS_PAST`, and `papers-past.ts` needs `DEFAULT_GRACE`. Keeping the
 * constant here — depending only on the leaf `types` module — lets
 * `papers-past.ts` (and `sources/fixture.ts`) import it WITHOUT a runtime
 * dependency back on `source-config.ts`, breaking what would otherwise be a
 * circular value-import. `source-config.ts` re-exports this symbol so every
 * existing `DEFAULT_GRACE`-from-source-config importer keeps working.
 */

import type { GraceWindowConfig } from '@/sourcequery/types';

/**
 * Conservative default grace-window parameters (research R6).
 * Per-source configs may override any of these.
 */
export const DEFAULT_GRACE: GraceWindowConfig = {
  settleMs: 8000,
  extraSlowIntervalMs: 15000,
  maxRequests: 3,
  maxWindowMs: 60000,
};
