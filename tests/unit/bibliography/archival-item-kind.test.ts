import { describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import { isSourceStructuralKind } from '@/bibliography/vocab';
import { validateSourceGroups } from '@/bibliography/validate-checks';
import { validateGroupOnlyFields } from '@/bibliography/validate-coverage-checks';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/** A minimal, otherwise-empty {@link CanonicalModel} fixture. */
function makeModel(overrides: Partial<CanonicalModel> = {}): CanonicalModel {
  return {
    sources: [],
    repositoryRecords: [],
    identifierLeaks: [],
    ...overrides,
  };
}

/** A minimal, valid {@link Source} fixture. */
function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-TEST-001',
    kind: 'monograph',
    titles: [{ text: 'Test Source', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

/** A minimal, valid source-group {@link Source} fixture. */
function makeSourceGroup(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-TEST-GROUP',
    kind: 'source-group',
    titles: [{ text: 'Test Group', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

describe('archival-item structural kind (T002)', () => {
  describe('isSourceStructuralKind vocabulary check', () => {
    it('accepts "archival-item" as a valid structural kind', () => {
      expect(isSourceStructuralKind('archival-item')).toBe(true);
    });

    it('accepts "periodical" as a valid structural kind', () => {
      expect(isSourceStructuralKind('periodical')).toBe(true);
    });

    it('accepts "monograph" as a valid structural kind', () => {
      expect(isSourceStructuralKind('monograph')).toBe(true);
    });

    it('accepts "source-group" as a valid structural kind', () => {
      expect(isSourceStructuralKind('source-group')).toBe(true);
    });

    it('rejects an unknown kind like "unknown-kind"', () => {
      expect(isSourceStructuralKind('unknown-kind')).toBe(false);
    });
  });

  describe('archival-item as a valid member kind', () => {
    it('validates a Source with kind: archival-item', () => {
      const archival = makeSource({
        sourceId: 'PB-TEST-PHOTO',
        kind: 'archival-item',
        titles: [{ text: 'Historical Photograph', role: 'canonical' }],
      });
      const model = makeModel({ sources: [archival] });

      // Should pass all validation checks (no findings reported)
      const groupFindings = validateSourceGroups(model);
      expect(groupFindings).toHaveLength(0);
    });

    it('allows archival-item as a source-group member', () => {
      const group = makeSourceGroup({ sourceId: 'PB-TEST-GROUP' });
      const member = makeSource({
        sourceId: 'PB-TEST-PHOTO',
        kind: 'archival-item',
        partOf: 'PB-TEST-GROUP',
        titles: [{ text: 'Member Archival Item', role: 'canonical' }],
      });
      const model = makeModel({ sources: [group, member] });

      // Should report no source-group validation findings
      const groupFindings = validateSourceGroups(model);
      expect(groupFindings).toHaveLength(0);
    });

    it('treats archival-item as a fetchable work (isFetchableWork)', () => {
      // This is implicitly tested by source-group membership validation:
      // an archival-item as a member is valid and does not report
      // "source-group must not be a member" errors.
      const group = makeSourceGroup();
      const member = makeSource({
        kind: 'archival-item',
        partOf: 'PB-TEST-GROUP',
      });
      const model = makeModel({ sources: [group, member] });

      const groupFindings = validateSourceGroups(model);
      expect(groupFindings).toHaveLength(0);
    });
  });

  describe('archival-item rejects source-group-only fields', () => {
    it('rejects knownMemberCount on an archival-item (group-only field)', () => {
      const archival = makeSource({
        kind: 'archival-item',
        knownMemberCount: 1,
      });
      const model = makeModel({ sources: [archival] });

      const findings = validateGroupOnlyFields(model);
      expect(findings).toHaveLength(1);
      expect(findings[0].kind).toBe('group-only-field');
      expect(findings[0].detail).toContain('knownMemberCount');
      expect(findings[0].detail).toContain('archival-item');
    });

    it('rejects suspected gaps on an archival-item (group-only field)', () => {
      const archival = makeSource({
        kind: 'archival-item',
        suspected: [
          {
            description: 'Related archival item',
            basis: 'mentioned in reference',
          },
        ],
      });
      const model = makeModel({ sources: [archival] });

      const findings = validateGroupOnlyFields(model);
      expect(findings).toHaveLength(1);
      expect(findings[0].kind).toBe('group-only-field');
      expect(findings[0].detail).toContain('suspected');
      expect(findings[0].detail).toContain('archival-item');
    });

    it('rejects both knownMemberCount and suspected on an archival-item', () => {
      const archival = makeSource({
        kind: 'archival-item',
        knownMemberCount: 5,
        suspected: [
          {
            description: 'Missing related item',
            basis: 'from archive catalog',
          },
        ],
      });
      const model = makeModel({ sources: [archival] });

      const findings = validateGroupOnlyFields(model);
      expect(findings).toHaveLength(2);
      const details = findings.map((f) => f.detail);
      expect(details.some((d) => d.includes('knownMemberCount'))).toBe(true);
      expect(details.some((d) => d.includes('suspected'))).toBe(true);
    });
  });

  describe('archival-item is orthogonal to evidenceClass', () => {
    it('allows evidenceClass on an archival-item', () => {
      const archival = makeSource({
        kind: 'archival-item',
        evidenceClass: 'correspondence',
      });
      // Type checking ensures this is well-formed
      expect(archival.kind).toBe('archival-item');
      expect(archival.evidenceClass).toBe('correspondence');
    });

    it('allows archival-item without evidenceClass', () => {
      const archival = makeSource({
        kind: 'archival-item',
      });
      // Type checking ensures this is well-formed
      expect(archival.kind).toBe('archival-item');
      expect(archival.evidenceClass).toBeUndefined();
    });
  });
});
