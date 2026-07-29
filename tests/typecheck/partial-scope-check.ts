import type { CanonicalModel } from '@/bibliography/model';
import type { SearchLogEntry } from '@/bibliography/search-log';
import { validate } from '@/bibliography/validate';

/**
 * AUDIT-06 NEGATIVE COMPILE FIXTURE — deliberately does NOT typecheck.
 *
 * Compiled ONLY by `tests/typecheck/tsconfig.json`, which
 * `tests/unit/bibliography/audit-06-scope-check-options.test.ts` drives and
 * asserts FAILS. It is excluded from the repository's own `tsc --noEmit`
 * (see the root `tsconfig.json`'s `exclude`), so its errors never pollute
 * `npm run typecheck`.
 *
 * Each call below supplies a PROPER SUBSET of the three values the search-log
 * scope check needs. Under the old `ValidateOptions` -- three independent
 * optional fields gated by `&& opts?.validCaseIds !== undefined` -- every one
 * of them compiled and then silently SKIPPED a check that had previously run
 * unconditionally. They must now be rejected by the type system, not merely
 * by a runtime guard.
 */

declare const model: CanonicalModel;
declare const searchLog: readonly SearchLogEntry[];
declare const validCaseIds: ReadonlySet<string>;

// 1. searchLog + repoRoot, no validCaseIds -- the exact latent trap AUDIT-06 named.
validate(model, { repoRoot: '/repo', searchLog });

// 2. searchLog + validCaseIds, no repoRoot.
validate(model, { searchLog, validCaseIds });

// 3. repoRoot + validCaseIds, no searchLog.
validate(model, { repoRoot: '/repo', validCaseIds });

// 4. The scope check's inputs must travel together, never loose at top level.
validate(model, { searchLog });
