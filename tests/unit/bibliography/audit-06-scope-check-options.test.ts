import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import { validate } from '@/bibliography/validate';

/**
 * AUDIT-06 REGRESSION — the search-log scope check could be silently skipped.
 *
 * `validate()` gated that check on
 * `opts?.searchLog !== undefined && opts?.repoRoot !== undefined &&
 *  opts?.validCaseIds !== undefined`, with all three declared as INDEPENDENT
 * optional fields. A caller supplying two of the three compiled cleanly and
 * got a VACUOUS pass on a check that ran unconditionally before the corpus
 * seam threaded `validCaseIds` through it.
 *
 * The single shipped caller (`@/cli/bibliography`'s `runValidate`) does pass
 * all three, so this was latent rather than live -- which is exactly why a
 * runtime assertion is the wrong fix. The three values now travel as ONE
 * required sub-object, so a partial supply is UNREPRESENTABLE. That is a
 * claim about the TYPE, so it is pinned by compiling a negative fixture and
 * asserting `tsc` rejects it.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TYPECHECK_PROJECT = path.join(REPO_ROOT, 'tests', 'typecheck', 'tsconfig.json');

describe('AUDIT-06 — a partial scope-check supply must not compile', () => {
  it('tsc REJECTS every proper subset of {searchLog, repoRoot, validCaseIds}', () => {
    const result = spawnSync(
      'npx',
      ['tsc', '--noEmit', '-p', TYPECHECK_PROJECT],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    );
    const output = `${result.stdout}${result.stderr}`;

    // A zero exit means the negative fixture compiled -- i.e. the partial
    // supply is still representable and the trap is still open.
    expect(output).toContain('partial-scope-check.ts');
    expect(result.status).not.toBe(0);
  }, 120_000);
});

const EMPTY_MODEL: CanonicalModel = {
  sources: [],
  repositoryRecords: [],
  identifierLeaks: [],
};

describe('AUDIT-06 — the check still RUNS when the scope inputs are supplied', () => {
  it('resolves search-log scopes through the grouped option', () => {
    const findings = validate(EMPTY_MODEL, {
      repoRoot: REPO_ROOT,
      scopeCheck: {
        searchLog: [
          {
            id: 'SRCH-9999',
            date: '2026-07-29',
            repository: 'audit-06 probe repository',
            scope: { kind: 'case', id: 'no-such-case-anywhere' },
            query: 'audit-06 probe',
            coverage: 'a scope no corpus declares',
          },
        ],
        validCaseIds: new Set(['port-breton']),
      },
    });

    // The scope is unresolvable against {port-breton}: proof the check ran.
    expect(findings.some((f) => f.kind === 'search-log-scope-unresolved')).toBe(true);
  });
});
