import { describe, it, expect, afterEach } from 'vitest';

import {
  installArchiveLayoutPolicy,
  isSourceLayoutRegistered,
  registerSourceLayout,
  resetArchiveLayoutResolution,
  sourceLayout,
  type SourceLayout,
} from '@/archive/location';
import type { ArchiveLayoutPolicy } from '@/corpus/policies';

/**
 * AUDIT-33: THE RUNTIME OVERLAY MUST NOT OUTLIVE THE POLICY IT WAS DERIVED
 * FROM.
 *
 * `installArchiveLayoutPolicy` used to replace the policy and drop the
 * memoized composition while leaving `registerSourceLayout`'s runtime overlay
 * completely untouched -- and the overlay had no clear/reset anywhere in the
 * repo. Since the overlay is step 2 of the FR-017 resolution order it
 * OUTRANKS `policy.derived` (step 3), so an entry registered mid-run under
 * corpus A kept answering for its Source ID after corpus B was installed. A
 * fetch driven by B would then mkdir under A's slug while B's record pointed
 * somewhere else -- bytes in the archive that the SSOT record does not
 * reflect (Principle XV).
 *
 * The overlay is per-corpus-run state; these cases pin it to the policy's
 * lifetime.
 */

const SYN = 'SYN0001';

function layout(caseId: string, slug: string): SourceLayout {
  return { case: caseId, type: 'books', slug, kind: 'monograph' };
}

/** A policy whose ONLY derivation for `SYN0001` is the given layout. */
function policyDeriving(derivedLayout: SourceLayout | undefined): ArchiveLayoutPolicy {
  const derived = new Map<string, SourceLayout>();
  if (derivedLayout !== undefined) {
    derived.set(SYN, derivedLayout);
  }
  return { overrides: new Map(), derived };
}

describe('archive-layout policy lifetime (AUDIT-33)', () => {
  afterEach(() => {
    // Leave no module state behind for the next file's resolution.
    resetArchiveLayoutResolution();
  });

  it('a mid-run overlay entry from corpus A does not outrank corpus B after B is installed', () => {
    const corpusA = policyDeriving(layout('port-breton', 'corpus-a-derived-slug'));
    installArchiveLayoutPolicy(corpusA);
    registerSourceLayout(SYN, layout('port-breton', 'corpus-a-mid-run-slug'));
    expect(sourceLayout(SYN).slug).toBe('corpus-a-mid-run-slug');

    const corpusB = policyDeriving(layout('kelp-cove', 'corpus-b-derived-slug'));
    installArchiveLayoutPolicy(corpusB);

    expect(sourceLayout(SYN)).toEqual(layout('kelp-cove', 'corpus-b-derived-slug'));
  });

  it('installing a policy that does not know the id makes it unresolvable again, not silently stale', () => {
    installArchiveLayoutPolicy(policyDeriving(layout('port-breton', 'corpus-a-derived-slug')));
    registerSourceLayout(SYN, layout('port-breton', 'corpus-a-mid-run-slug'));
    expect(isSourceLayoutRegistered(SYN)).toBe(true);

    installArchiveLayoutPolicy({ overrides: new Map(), derived: new Map() });

    expect(isSourceLayoutRegistered(SYN)).toBe(false);
    expect(() => sourceLayout(SYN)).toThrow(/no archive layout registered/i);
  });

  it('a cleared overlay does not collide with a re-registration under the new policy', () => {
    installArchiveLayoutPolicy(policyDeriving(layout('port-breton', 'corpus-a-derived-slug')));
    registerSourceLayout(SYN, layout('port-breton', 'corpus-a-mid-run-slug'));

    installArchiveLayoutPolicy(policyDeriving(layout('kelp-cove', 'corpus-b-derived-slug')));

    // Under the OLD behavior this threw "already registered with a different
    // layout" -- corpus A's leftover entry made corpus B's own mid-run
    // registration a conflict.
    expect(() =>
      registerSourceLayout(SYN, layout('kelp-cove', 'corpus-b-mid-run-slug')),
    ).not.toThrow();
    expect(sourceLayout(SYN).slug).toBe('corpus-b-mid-run-slug');
  });

  it('resetArchiveLayoutResolution clears the installed policy AND the overlay', () => {
    installArchiveLayoutPolicy(policyDeriving(layout('port-breton', 'corpus-a-derived-slug')));
    registerSourceLayout('ZZ-RESET-001', layout('port-breton', 'transient'));

    resetArchiveLayoutResolution();

    // Nothing installed and nothing overlaid: resolution falls through to the
    // deferred composition from the committed corpora, which has never heard
    // of these synthetic ids.
    expect(isSourceLayoutRegistered('ZZ-RESET-001')).toBe(false);
    expect(isSourceLayoutRegistered(SYN)).toBe(false);
  });
});
