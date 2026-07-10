import { describe, expect, it } from 'vitest';

import { isAllowed, isSourceLifecycleStatus } from '@/bibliography/vocab';

describe('RepositoryRecord acquisition status vocabulary (vocab.ts)', () => {
  describe('existing acquisition status values (FR-008: backward compatibility)', () => {
    it('accepts "wanted" as a valid status', () => {
      expect(isAllowed('status', 'wanted')).toBe(true);
    });

    it('accepts "to-collect" as a valid status', () => {
      expect(isAllowed('status', 'to-collect')).toBe(true);
    });

    it('accepts "collecting" as a valid status', () => {
      expect(isAllowed('status', 'collecting')).toBe(true);
    });

    it('accepts "collected" as a valid status', () => {
      expect(isAllowed('status', 'collected')).toBe(true);
    });

    it('accepts "archived" as a valid status', () => {
      expect(isAllowed('status', 'archived')).toBe(true);
    });
  });

  describe('cross-domain rejection: Source lifecycle values are NOT acquisition statuses', () => {
    it('rejects "discovered" as a status (that is a Source lifecycle value)', () => {
      expect(isAllowed('status', 'discovered')).toBe(false);
    });

    it('rejects "approved-for-acquisition" as a status (Source lifecycle value)', () => {
      expect(isAllowed('status', 'approved-for-acquisition')).toBe(false);
    });

    it('rejects "excluded" as a status (Source lifecycle value)', () => {
      expect(isAllowed('status', 'excluded')).toBe(false);
    });
  });

  describe('invalid status values', () => {
    it('rejects an unknown status value like "bogus-status"', () => {
      expect(isAllowed('status', 'bogus-status')).toBe(false);
    });
  });
});

describe('Source lifecycle status vocabulary (vocab.ts, US3)', () => {
  describe('valid lifecycle values', () => {
    it('accepts "discovered"', () => {
      expect(isSourceLifecycleStatus('discovered')).toBe(true);
    });

    it('accepts "approved-for-acquisition"', () => {
      expect(isSourceLifecycleStatus('approved-for-acquisition')).toBe(true);
    });

    it('accepts "excluded"', () => {
      expect(isSourceLifecycleStatus('excluded')).toBe(true);
    });
  });

  describe('cross-domain rejection: RepositoryRecord acquisition values are NOT Source lifecycle statuses', () => {
    it('rejects "wanted"', () => {
      expect(isSourceLifecycleStatus('wanted')).toBe(false);
    });

    it('rejects "to-collect"', () => {
      expect(isSourceLifecycleStatus('to-collect')).toBe(false);
    });

    it('rejects "collecting"', () => {
      expect(isSourceLifecycleStatus('collecting')).toBe(false);
    });

    it('rejects "collected"', () => {
      expect(isSourceLifecycleStatus('collected')).toBe(false);
    });

    it('rejects "archived"', () => {
      expect(isSourceLifecycleStatus('archived')).toBe(false);
    });
  });

  describe('invalid lifecycle values', () => {
    it('rejects an unknown value like "bogus-status"', () => {
      expect(isSourceLifecycleStatus('bogus-status')).toBe(false);
    });
  });
});
