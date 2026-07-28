/**
 * T019 (spec 018-corpus-config-seam, SC-004, INV-6/INV-13/INV-16): the
 * regression guard proving none of the SIX corpus-specific constants this
 * feature retired has come back as a literal in a core (production) module,
 * and that no core module hardcodes the corpora root.
 *
 * The six retired constants:
 *   1. `SOURCE_LAYOUTS`        -- was `src/archive/location.ts`
 *   2. `PORT_BRETON_CASE_ID`   -- was `src/bibliography/scope.ts`
 *   3. `MEMBER_PREFIX` / `PAD_WIDTH` / `MEMBER_FILE_RE`
 *                              -- the `PB-P` allocator constants, was
 *                                 `src/sourcegroup/id-alloc.ts`
 *   4. the 44-id browser default source list -- was `src/browser/config.ts`
 *      (removed by commit 78e420d, T014); its exact contents are pinned
 *      below as {@link RETIRED_BROWSER_DEFAULT_IDS} for a byte-exact
 *      reappearance check.
 *   5. `SOURCE_FILE_PATTERN`   -- `/^PB-[A-Z]?\d{3}\.yml$/`, was
 *                                 `src/bibliography/load.ts`
 *   6. `SOURCE_ID_PATTERN`     -- `/^PB-[A-Z]?\d{3}$/`, was
 *                                 `src/bibliography/load.ts` (now a
 *                                 corpus-neutral shape grammar, FR-019)
 *
 * Plus FR-016/INV-13: exactly ONE literal `'corpora'` string is permitted
 * anywhere in `src/` -- `PRODUCTION_CORPORA_DIRNAME` in
 * `@/cli/composition-root`. Any other occurrence means some module resolved
 * the corpora root itself instead of receiving it as an injected parameter,
 * which would make SC-003 (a fixture corpus selected with zero `src/` edits)
 * unsatisfiable.
 *
 * DESIGN NOTES (see also `tests/support/scan-production-src.ts`):
 *
 * - PRODUCTION SOURCE ONLY. `collectProductionSourceFiles` walks `src/`,
 *   excluding `*.test.ts` (this repo co-locates tests beside their module,
 *   e.g. `src/corpus/manifest.test.ts` legitimately says `PORT_BRETON_CASE_ID`
 *   in a fixture) and `__fixtures__` directories. Non-`.ts` files (e.g. the
 *   README under `src/sourcegroup/__fixtures__/`) are excluded by extension.
 *   `tests/` itself (where this guard and dozens of other tests legitimately
 *   use `PB-P` ids everywhere) is never walked at all.
 *
 * - LIVE CODE, NOT PROSE. Several production modules carry doc comments
 *   explaining what was retired and why (e.g. `@/archive/location`'s "T013
 *   ... retired the static `SOURCE_LAYOUTS` map"). That documentation is
 *   valuable and must not be forbidden. `collectProductionSourceFiles` blanks
 *   every comment span using the TypeScript compiler's own scanner
 *   (`ts.createScanner`) before this guard ever sees the text, so a name
 *   mentioned only in a `/** ... *\/` or `// ...` comment is invisible to the
 *   checks below; only a token reachable by the *compiler* (i.e. code) can
 *   trip them.
 *
 * - THE GUARD DOES NOT FLAG ITSELF. This file lives under `tests/`, and
 *   `collectProductionSourceFiles` only ever walks `src/` -- so the forbidden
 *   strings named in this very file (in the identifier list, the regex-body
 *   substring, the id-list signature, and the `'corpora'` pattern) are
 *   structurally never part of the scanned corpus. No self-exclusion logic
 *   is needed.
 *
 * - PRECISION OVER BREADTH. Each check targets the SHAPE of the actual
 *   retired artifact (an exact identifier, an exact regex-source substring,
 *   an exact ordered id sequence, an exact quoted string), not a broad
 *   keyword scan that would flag an innocuous rename or a legitimate new
 *   `'corpora'`-adjacent string (e.g. `'corpora/README.md'`, which contains
 *   "corpora" but is not the bare string, and is untouched by the
 *   `/(["'\`])corpora\1/` pattern because it requires the SAME quote
 *   character to close immediately after "corpora").
 */

import { describe, expect, it } from 'vitest';
import {
  collectProductionSourceFiles,
  repoRootFromTestSupport,
  type ProductionSourceFile,
} from '../../support/scan-production-src';

/** Retired identifiers 1-3, 5, 6 -- checked as whole-word live-code tokens. */
const RETIRED_IDENTIFIERS = [
  'SOURCE_LAYOUTS',
  'PORT_BRETON_CASE_ID',
  'MEMBER_PREFIX',
  'PAD_WIDTH',
  'MEMBER_FILE_RE',
  'SOURCE_FILE_PATTERN',
  'SOURCE_ID_PATTERN',
] as const;

/**
 * The exact source text (not the two-character JS escape) shared by both
 * retired regex literals -- `/^PB-[A-Z]?\d{3}\.yml$/` (filename) and
 * `/^PB-[A-Z]?\d{3}$/` (id). A live reappearance of either regex necessarily
 * contains this substring, so one check covers both without needing two
 * near-duplicate patterns that could drift apart.
 */
const RETIRED_ID_SHAPE_SUBSTRING = 'PB-[A-Z]?\\d{3}';

/**
 * The 44 source ids `src/browser/config.ts` used to hardcode as its default
 * browser source list, in their original committed order (captured from
 * commit 78e420d^:src/browser/config.ts, immediately before T014 removed
 * them). This is the literal DATA payload of the retired constant -- unlike
 * items 1-3/5/6 it had no distinguishing identifier name, so the guard below
 * checks for the reappearance of this exact ordered id sequence instead.
 */
const RETIRED_BROWSER_DEFAULT_IDS = [
  'PB-P001', 'PB-P002', 'PB-P003', 'PB-P007', 'PB-P008', 'PB-P009', 'PB-P010',
  'PB-P011', 'PB-P055', 'PB-P057', 'PB-P058', 'PB-P059', 'PB-P061', 'PB-P062',
  'PB-P063', 'PB-P064', 'PB-P065', 'PB-P066', 'PB-P067', 'PB-P068', 'PB-P069',
  'PB-P070', 'PB-P071', 'PB-P072', 'PB-P073', 'PB-P074', 'PB-P075', 'PB-P076',
  'PB-P077', 'PB-P078', 'PB-P079', 'PB-P080', 'PB-P081', 'PB-P082', 'PB-P083',
  'PB-P084', 'PB-P085', 'PB-P086', 'PB-P087', 'PB-P088', 'PB-P089', 'PB-P090',
  'PB-P091', 'PB-P092',
] as const;

/** `'corpora'` / `"corpora"` / `` `corpora` `` -- the bare quoted literal, no surrounding path. */
const CORPORA_LITERAL_PATTERN = /(["'`])corpora\1/g;

/** The one place FR-016 permits the corpora-root literal. */
const PERMITTED_CORPORA_LITERAL_FILE = 'src/cli/composition-root.ts';

const repoRoot = repoRootFromTestSupport();
const files = collectProductionSourceFiles(repoRoot);

function relPaths(matches: ProductionSourceFile[]): string[] {
  return matches.map((f) => f.relPath);
}

describe('T019 guard: no retired corpus-specific constant survives in core modules (SC-004)', () => {
  it('sanity: the scan actually found production src files (a guard over zero files is vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  describe.each(RETIRED_IDENTIFIERS)('retired identifier %s', (identifier) => {
    const pattern = new RegExp(`\\b${identifier}\\b`);

    it('does not appear as a live (non-comment) token in any production module', () => {
      const offenders = files.filter((f) => pattern.test(f.liveCode));
      expect(
        relPaths(offenders),
        `"${identifier}" reappeared as live code in: ${relPaths(offenders).join(', ') || '(none)'}`,
      ).toEqual([]);
    });
  });

  it('the retired PB-P id-shape regex source (`PB-[A-Z]?\\d{3}`) does not reappear as a live literal', () => {
    const offenders = files.filter((f) => f.liveCode.includes(RETIRED_ID_SHAPE_SUBSTRING));
    expect(
      relPaths(offenders),
      `retired regex shape reappeared as live code in: ${relPaths(offenders).join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('the retired 44-id browser-default source list does not reappear as a literal array, in order', () => {
    // Normalize away formatting (whitespace, quote style) so the check
    // survives a reformat but still requires the SAME 44 ids in the SAME
    // order -- the actual shape of the retired constant's data.
    const signature = RETIRED_BROWSER_DEFAULT_IDS.join(',');
    const offenders = files.filter((f) => {
      const normalized = f.liveCode.replace(/\s+/g, '').replace(/['"`]/g, '');
      return normalized.includes(signature);
    });
    expect(
      relPaths(offenders),
      `retired 44-id browser-default list reappeared in: ${relPaths(offenders).join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('exactly one literal corpora-root string exists in src/, and it is PRODUCTION_CORPORA_DIRNAME (FR-016/INV-13)', () => {
    const hits: { relPath: string; count: number }[] = [];
    for (const f of files) {
      const matches = f.liveCode.match(CORPORA_LITERAL_PATTERN);
      if (matches !== null && matches.length > 0) {
        hits.push({ relPath: f.relPath, count: matches.length });
      }
    }
    expect(hits).toEqual([{ relPath: PERMITTED_CORPORA_LITERAL_FILE, count: 1 }]);
  });
});
