import { describe, it, expect } from 'vitest';

import { assertPublishable } from '@/pdf/publish/rights-gate';
import type { Source } from '@/model/source';
import type { SourceRights } from '@/model/publication';

/** A minimal, publishable-shaped Source with an optional rights determination. */
function sourceWith(rights: SourceRights | undefined): Source {
  return {
    sourceId: 'PB-P001',
    titles: [{ text: 'Le Colon', role: 'canonical' }],
    kind: 'monograph',
    identifiers: [],
    rights,
  };
}

describe('assertPublishable (SC-003 fail-closed publish rights gate)', () => {
  it('throws naming the source and the rights gap when rights is absent', () => {
    const source = sourceWith(undefined);

    expect(() => assertPublishable(source)).toThrow(/PB-P001/);
    expect(() => assertPublishable(source)).toThrow(
      /no affirmative distributable-rights determination/i,
    );
  });

  it('throws naming the source and the insufficient status for a recognized-but-not-cleared status', () => {
    // `gov-reusable` is a RECOGNIZED SourceRightsStatus but NOT
    // affirmative-distributable in v1 -- it must fail closed.
    const source = sourceWith({
      status: 'gov-reusable',
      basis: 'French government report, reusable',
    });

    expect(() => assertPublishable(source)).toThrow(/PB-P001/);
    expect(() => assertPublishable(source)).toThrow(/gov-reusable/);
  });

  it('returns the basis for an affirmative public-domain determination with a basis', () => {
    const source = sourceWith({
      status: 'public-domain',
      basis: '1881 imprint; French public domain',
    });

    expect(assertPublishable(source)).toBe('1881 imprint; French public domain');
  });

  it('throws when an otherwise-affirmative determination carries an empty basis', () => {
    const source = sourceWith({ status: 'public-domain', basis: '' });

    expect(() => assertPublishable(source)).toThrow(/PB-P001/);
    expect(() => assertPublishable(source)).toThrow(/basis/i);
  });

  it('throws when an otherwise-affirmative determination carries a whitespace-only basis', () => {
    const source = sourceWith({ status: 'public-domain', basis: '   ' });

    expect(() => assertPublishable(source)).toThrow(/basis/i);
  });
});
