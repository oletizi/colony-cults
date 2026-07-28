/**
 * T020a (spec 018-corpus-config-seam, INV-8/FR-012): the guard proving no
 * epic-spec-2 field has leaked into any spec-1 type.
 *
 * `discoveryMechanism` (pluggable discovery) and `dateNormalizer` (pluggable
 * date normalization) are deliberately deferred to epic spec 2 (domain
 * generalization) -- see spec.md FR-012 and research.md's "Decision". Spec 1
 * (the corpus-config seam this feature adds) must not declare either field
 * anywhere: not on `CorpusManifest`, not on the loader, not on any narrow
 * policy (`ScopeResolutionContext`, `SourceIdPolicy`, `ArchiveLayoutPolicy`,
 * `BrowserProfile`, `SourceFilenamePolicy`), not anywhere else in `src/`.
 *
 * `@/corpus/manifest.test.ts` already pins this at the INSTANCE level for one
 * loaded manifest (`not.toHaveProperty('discoveryMechanism' | 'dateNormalizer')`)
 * and for one rejected fixture. This guard is broader and TYPE/SOURCE-level:
 * it scans every production module under `src/` for either name appearing as
 * a live (non-comment) token, so a spec-2 field added to ANY corpus-seam
 * type -- not just `CorpusManifest` -- trips it immediately, and a doc
 * comment that legitimately explains the deferral (e.g. `@/corpus/manifest`'s
 * "Does NOT declare the epic-spec-2 fields ... (FR-012)") is not mistaken for
 * a violation. See `tests/support/scan-production-src.ts` for how "live code"
 * vs "comment prose" is told apart (the TypeScript compiler's own scanner,
 * not a hand-rolled regex).
 *
 * PRODUCTION SOURCE ONLY: `*.test.ts` files (e.g. this repo's co-located
 * `src/corpus/manifest.test.ts`) and `__fixtures__` directories are excluded
 * by `collectProductionSourceFiles` -- a test fixture asserting the REJECTION
 * of `discoveryMechanism` (e.g.
 * `tests/fixtures/corpora/manifest-cases/unknown-top-level-key.yml`) is
 * exactly the kind of legitimate mention this guard must not forbid, and it
 * is outside `src/` entirely so it is never scanned.
 */

import { describe, expect, it } from 'vitest';
import {
  collectProductionSourceFiles,
  repoRootFromTestSupport,
} from '../../support/scan-production-src';

const SPEC2_FIELDS = ['discoveryMechanism', 'dateNormalizer'] as const;

const repoRoot = repoRootFromTestSupport();
const files = collectProductionSourceFiles(repoRoot);

describe('T020a guard: no epic-spec-2 field leaks into a spec-1 type (INV-8, FR-012)', () => {
  it('sanity: the scan actually found production src files (a guard over zero files is vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  describe.each(SPEC2_FIELDS)('spec-2 field %s', (field) => {
    const pattern = new RegExp(`\\b${field}\\b`);

    it('does not appear as a live (non-comment) token in any production module', () => {
      const offenders = files.filter((f) => pattern.test(f.liveCode));
      expect(
        offenders.map((f) => f.relPath),
        `"${field}" reappeared as live code in: ${offenders.map((f) => f.relPath).join(', ') || '(none)'}`,
      ).toEqual([]);
    });
  });
});
