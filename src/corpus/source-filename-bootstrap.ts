import { existsSync } from 'node:fs';

import { resolveCorporaRoot, resolveRepoRootUpward } from '@/cli/composition-root';
import { listCorpusManifests } from '@/corpus/manifest';
import type { CorpusManifest } from '@/corpus/manifest';
import {
  buildSourceFilenamePolicy,
  type SourceFilenamePolicy,
  type SourceFilenameShape,
} from '@/corpus/source-filename-policy';

/**
 * THE DEFERRED COMPOSITION ROOT for the source-filename seam (T023, spec
 * 018-corpus-config-seam; FR-018, INV-16) — the exact counterpart of
 * `@/archive/layout-bootstrap` + `@/archive/layout-resolve` for the
 * archive-layout seam, and subject to the same recorded Principle VI
 * deviation (plan.md §VI).
 *
 * WHY IT EXISTS. `loadAllSources` now takes its policy as a REQUIRED
 * parameter, with no default — that part is non-negotiable (FR-018). But
 * roughly half its call sites sit on chains that carry no corpus parameter at
 * all: `sourceKind` is reached from the fetch-source guardrail, the acquire /
 * reconcile / promote pipeline takes a plain input record, and the PDF batch
 * builder is driven from a bin that never composed a corpus. Threading a
 * required field through those input records would touch ~120 call sites in
 * the test suite alone without adding any injection point an operator can
 * actually use. Those sites call {@link committedSourceFilenamePolicy}
 * EXPLICITLY instead — the decision is visible at every call site, and the
 * policy still comes from committed configuration, never from a literal.
 *
 * WHY THE UNION OVER EVERY COMMITTED MANIFEST, not one selected corpus. The
 * `bibliography/sources` directory holds the Sources of every corpus in the
 * repository, and the question these call sites ask ("which files in this
 * directory are Source files") is not scoped to a selection: today
 * `loadAllSources` enumerates all 94 Port Breton records regardless of
 * `--corpus`, and FR-010 requires that stay true. The same choice, for the
 * same reason, is already made by `@/archive/layout-bootstrap` and
 * `@/bibliography/coverage/load-coverage-report`.
 *
 * A CLI command that HAS composed a corpus does NOT come here: it passes
 * `corpus.sourceFilenames` (the narrow policy derived by
 * `@/corpus/policies`' `deriveSourceFilenamePolicy`) straight down. That is
 * the strict-injection path, and {@link installSourceFilenamePolicy} is its
 * process-wide equivalent for an alternative composition root or a fixture
 * corpus (SC-003).
 */

/** The explicitly injected policy, if a composition root installed one. */
let installedPolicy: SourceFilenamePolicy | null = null;
/** The memoized deferred composition, built on first use when none is installed. */
let composedPolicy: SourceFilenamePolicy | null = null;

/**
 * Install the source-filename policy explicitly, PREEMPTING the deferred
 * composition from the committed manifests. A later call replaces the policy
 * and discards any memoized composition. Passing `null` clears the
 * installation (used by tests to restore the committed behavior).
 */
export function installSourceFilenamePolicy(policy: SourceFilenamePolicy | null): void {
  installedPolicy = policy;
  composedPolicy = null;
}

/**
 * Union the source-ID shapes of several manifests into one policy. Exported
 * for the two call sites that already hold the manifests they need
 * (`@/archive/layout-bootstrap`, `@/bibliography/coverage/load-coverage-report`),
 * so they compose from what they loaded rather than reading the corpora root
 * a second time.
 *
 * Fails loud (via `buildSourceFilenamePolicy`) when the manifest list is
 * empty: no committed corpus means no answer to "which files are Sources",
 * and an empty policy would silently enumerate nothing.
 */
export function unionSourceFilenamePolicy(
  manifests: readonly CorpusManifest[],
): SourceFilenamePolicy {
  const shapes: SourceFilenameShape[] = [];
  for (const manifest of manifests) {
    for (const policy of manifest.sourceIds) {
      shapes.push({ prefix: policy.prefix, padWidth: policy.padWidth });
    }
  }
  return buildSourceFilenamePolicy(shapes);
}

/** The production corpora root, resolved depth-agnostically from this module's location. */
function productionCorporaRoot(): string {
  return resolveCorporaRoot(resolveRepoRootUpward());
}

/**
 * The policy in force for a call site with no injected one: the installed
 * policy, else the memoized union over every committed manifest.
 *
 * Fails loud on an absent corpora root — a repository with no committed
 * corpus cannot say which files are Sources, and returning "none" there is
 * the silent-empty-enumeration failure FR-018 exists to remove.
 */
export function committedSourceFilenamePolicy(): SourceFilenamePolicy {
  if (installedPolicy !== null) {
    return installedPolicy;
  }
  if (composedPolicy === null) {
    const corporaRoot = productionCorporaRoot();
    if (!existsSync(corporaRoot)) {
      throw new Error(
        `committedSourceFilenamePolicy: no corpora directory at ${JSON.stringify(corporaRoot)} ` +
          '-- Source files cannot be enumerated without at least one committed corpus ' +
          'manifest (install one explicitly with installSourceFilenamePolicy)',
      );
    }
    composedPolicy = unionSourceFilenamePolicy(listCorpusManifests(corporaRoot));
  }
  return composedPolicy;
}
