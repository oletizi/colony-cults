import { describe, it, expect, beforeEach } from 'vitest';

import {
  deriveSourceLayout,
  installArchiveLayoutPolicy,
  isSourceLayoutRegistered,
  registerSourceLayout,
  sourceLayout,
  type SourceLayout,
} from '@/archive/location';
import type { ArchiveLayoutOverride, ArchiveLayoutPolicy } from '@/corpus/policies';
import type { Source } from '@/model/source';

/**
 * T013 (spec 018-corpus-config-seam): the FR-017 TOTAL resolution order and
 * the retained runtime-overlay semantics (INV-14).
 *
 *   1. manifest `archiveLayoutOverrides`
 *   2. runtime overlay (`registerSourceLayout`)
 *   3. precomputed generic derivation (`policy.derived`)
 *   4. throw -- no default (Principle V)
 *
 * Every case here runs against an INJECTED policy
 * (`installArchiveLayoutPolicy`), never the committed corpora: that is the
 * seam this task opened, and exercising it here is what proves an alternative
 * composition root can point archive-layout resolution at its own corpus with
 * zero core edits. The byte-identical guarantee for the 9 LEGACY Port Breton
 * sources is a separate, deliberately un-injected gate
 * (`location-legacy-characterization.test.ts`).
 */

const OVERRIDDEN = 'ZZ-P001';
const OVERLAID = 'ZZ-P002';
const DERIVED_ONLY = 'ZZ-P003';
const UNKNOWN = 'ZZ-P900';

function source(sourceId: string, title: string): Source {
  return {
    sourceId,
    kind: 'monograph',
    case: 'fixture-case',
    titles: [{ text: title, role: 'canonical' }],
    identifiers: [],
  };
}

function policy(overrides: Record<string, ArchiveLayoutOverride>): ArchiveLayoutPolicy {
  const derived = new Map<string, SourceLayout>([
    [OVERRIDDEN, deriveSourceLayout(source(OVERRIDDEN, 'Overridden Title'))],
    [OVERLAID, deriveSourceLayout(source(OVERLAID, 'Overlaid Title'))],
    [DERIVED_ONLY, deriveSourceLayout(source(DERIVED_ONLY, 'Derived Only Title'))],
  ]);
  return { overrides: new Map(Object.entries(overrides)), derived };
}

const LEGACY_OVERRIDE: ArchiveLayoutOverride = {
  relativePath: 'archive/cases/fixture-case/books/legacy-hand-authored-slug',
  reason: 'the committed masters already live at the legacy slug',
};

describe('archive layout resolution order (T013, FR-017/INV-14)', () => {
  beforeEach(() => {
    installArchiveLayoutPolicy(policy({ [OVERRIDDEN]: LEGACY_OVERRIDE }));
  });

  it('1. a manifest override wins over both the overlay and the derivation', () => {
    registerSourceLayout(OVERRIDDEN, {
      case: 'other-case',
      type: 'newspapers',
      slug: 'an-overlay-slug',
      kind: 'periodical',
    });

    expect(sourceLayout(OVERRIDDEN)).toEqual({
      case: 'fixture-case',
      type: 'books',
      slug: 'legacy-hand-authored-slug',
      kind: 'monograph',
    });
  });

  it('2. the runtime overlay wins over the precomputed derivation', () => {
    const midRun: SourceLayout = {
      case: 'fixture-case',
      type: 'books',
      slug: 'registered-mid-run',
      kind: 'monograph',
    };
    registerSourceLayout(OVERLAID, midRun);

    expect(sourceLayout(OVERLAID)).toEqual(midRun);
  });

  it('3. the precomputed generic derivation resolves a source with neither', () => {
    expect(sourceLayout(DERIVED_ONLY)).toEqual({
      case: 'fixture-case',
      type: 'books',
      slug: 'derived-only-title',
      kind: 'monograph',
    });
  });

  it('4. an unresolvable source throws -- there is no default layout', () => {
    expect(() => sourceLayout(UNKNOWN)).toThrow(/no archive layout registered/i);
  });

  it('isSourceLayoutRegistered is true for all three resolvable steps, false otherwise', () => {
    registerSourceLayout(OVERLAID, {
      case: 'fixture-case',
      type: 'books',
      slug: 'registered-mid-run',
      kind: 'monograph',
    });

    expect(isSourceLayoutRegistered(OVERRIDDEN)).toBe(true);
    expect(isSourceLayoutRegistered(OVERLAID)).toBe(true);
    expect(isSourceLayoutRegistered(DERIVED_ONLY)).toBe(true);
    expect(isSourceLayoutRegistered(UNKNOWN)).toBe(false);
  });

  it('an override whose relativePath is not archive/cases/<case>/<type>/<slug> throws', () => {
    installArchiveLayoutPolicy(
      policy({
        [OVERRIDDEN]: { relativePath: 'somewhere/else', reason: 'malformed on purpose' },
      }),
    );

    expect(() => sourceLayout(OVERRIDDEN)).toThrow(/not of the required form/i);
  });

  it('an override for a source with no generic derivation throws rather than guessing a kind', () => {
    installArchiveLayoutPolicy({
      overrides: new Map([[UNKNOWN, LEGACY_OVERRIDE]]),
      derived: new Map(),
    });

    expect(() => sourceLayout(UNKNOWN)).toThrow(/no generic derivation/i);
  });

  it('registerSourceLayout is idempotent for an equal layout and fails loud on a conflict', () => {
    const layout: SourceLayout = {
      case: 'fixture-case',
      type: 'books',
      slug: 'a-mid-run-member',
      kind: 'monograph',
    };
    registerSourceLayout('ZZ-P010', layout);
    expect(() => registerSourceLayout('ZZ-P010', { ...layout })).not.toThrow();
    expect(() =>
      registerSourceLayout('ZZ-P010', { ...layout, slug: 'a-different-slug' }),
    ).toThrow(/already registered/i);
  });
});
