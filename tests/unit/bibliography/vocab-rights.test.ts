import { describe, expect, it } from 'vitest';

import { isSourceRightsStatus } from '@/bibliography/vocab';

describe('SourceRights status vocabulary (vocab.ts, specs/008)', () => {
  describe('valid rights status values', () => {
    it('accepts "public-domain" (v1 affirmative/distributable)', () => {
      expect(isSourceRightsStatus('public-domain')).toBe(true);
    });

    it('accepts "openly-licensed" (recognized, non-blocking for v1)', () => {
      expect(isSourceRightsStatus('openly-licensed')).toBe(true);
    });

    it('accepts "gov-reusable" (recognized, non-blocking for v1)', () => {
      expect(isSourceRightsStatus('gov-reusable')).toBe(true);
    });
  });

  describe('invalid rights status values', () => {
    it('rejects an unknown value like "all-rights-reserved"', () => {
      expect(isSourceRightsStatus('all-rights-reserved')).toBe(false);
    });

    it('rejects a cross-domain value like "collected" (RepositoryRecord acquisition status)', () => {
      expect(isSourceRightsStatus('collected')).toBe(false);
    });
  });
});
