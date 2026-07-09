import { describe, expect, it } from 'vitest';

import { classifyIdentifier } from '@/model/identifiers';
import { isAllowed } from '@/bibliography/vocab';

describe('classifyIdentifier', () => {
  it.each(['isbn', 'issn', 'oclc'] as const)(
    'classifies %s as a work-level identifier',
    (type) => {
      expect(classifyIdentifier(type)).toBe('work');
    },
  );

  it.each(['ark', 'iiif-manifest', 'scan-doi'] as const)(
    'classifies %s as a copy-level identifier',
    (type) => {
      expect(classifyIdentifier(type)).toBe('copy');
    },
  );

  it('throws a descriptive error for an unknown identifier type', () => {
    expect(() => classifyIdentifier('lccn')).toThrow(/lccn/);
  });
});

describe('vocab.isAllowed', () => {
  it('allows a valid status', () => {
    expect(isAllowed('status', 'collected')).toBe(true);
  });

  it('rejects an invalid status', () => {
    expect(isAllowed('status', 'acquired')).toBe(false);
  });
});
