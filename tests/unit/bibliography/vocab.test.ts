import { describe, expect, it } from 'vitest';

import { isAllowed } from '@/bibliography/vocab';

describe('Status vocabulary (vocab.ts)', () => {
  describe('existing status values (FR-008: backward compatibility)', () => {
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

  describe('new status values for source-groups (User Story 3)', () => {
    it('accepts "discovered" as a valid status (T011 extends STATUS_VALUES)', () => {
      expect(isAllowed('status', 'discovered')).toBe(true);
    });

    it('accepts "approved-for-acquisition" as a valid status (T011 extends STATUS_VALUES)', () => {
      expect(isAllowed('status', 'approved-for-acquisition')).toBe(true);
    });

    it('accepts "excluded" as a valid status (T011 extends STATUS_VALUES)', () => {
      expect(isAllowed('status', 'excluded')).toBe(true);
    });
  });

  describe('invalid status values', () => {
    it('rejects an unknown status value like "bogus-status"', () => {
      expect(isAllowed('status', 'bogus-status')).toBe(false);
    });
  });
});
