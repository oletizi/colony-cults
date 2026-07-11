import { describe, it, expect } from 'vitest';
import type { CanonicalModel } from '@/bibliography/model';
import { validateVocab } from '@/bibliography/validate-checks';
import {
  SOURCE_LIFECYCLE_STATUS_VALUES,
  REPOSITORY_ACQUISITION_STATUS_VALUES,
} from '@/bibliography/vocab';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Regression test (FR-022): assert that the two lifecycle vocabularies stay
 * DISJOINT -- a Source-lifecycle value must be rejected on a RepositoryRecord's
 * acquisition `status` (and vice-versa). Reuses shipped validation
 * (validateVocab in @/bibliography/validate-checks.ts, wired via
 * @/bibliography/validate.ts, keyed on field name 'status' →
 * REPOSITORY_ACQUISITION_STATUS_VALUES).
 */

describe('vocab disjointness (FR-022)', () => {
  function buildModel(records: RepositoryRecord[]): CanonicalModel {
    return {
      sources: [],
      repositoryRecords: records,
      identifierLeaks: [],
    };
  }

  it('rejects a Source-lifecycle value ("discovered") on a RepositoryRecord status', () => {
    const record: RepositoryRecord = {
      sourceId: 'PB-P001',
      sourceArchive: 'Test Archive',
      status: 'discovered' as string,
    };
    const model = buildModel([record]);

    const findings = validateVocab(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('vocab');
    expect(findings[0].detail).toContain('status');
    expect(findings[0].detail).toContain('discovered');
  });

  it('rejects another Source-lifecycle value ("excluded") on a RepositoryRecord status', () => {
    const record: RepositoryRecord = {
      sourceId: 'PB-P002',
      sourceArchive: 'Test Archive',
      status: 'excluded' as string,
    };
    const model = buildModel([record]);

    const findings = validateVocab(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('vocab');
    expect(findings[0].detail).toContain('excluded');
  });

  it('accepts a valid RepositoryRecord acquisition status ("wanted")', () => {
    const record: RepositoryRecord = {
      sourceId: 'PB-P003',
      sourceArchive: 'Test Archive',
      status: 'wanted',
    };
    const model = buildModel([record]);

    const findings = validateVocab(model);

    expect(findings).toHaveLength(0);
  });

  it('accepts all valid RepositoryRecord acquisition statuses', () => {
    const records: RepositoryRecord[] = REPOSITORY_ACQUISITION_STATUS_VALUES.map(
      (status, i) => ({
        sourceId: `PB-P${String(i).padStart(3, '0')}`,
        sourceArchive: 'Test Archive',
        status,
      }),
    );
    const model = buildModel(records);

    const findings = validateVocab(model);

    expect(findings).toHaveLength(0);
  });

  it('asserts that the two vocabulary value sets are disjoint (no intersection)', () => {
    const sourceLifecycleSet = new Set(SOURCE_LIFECYCLE_STATUS_VALUES);
    const acquisitionStatusSet = new Set(REPOSITORY_ACQUISITION_STATUS_VALUES);

    const intersection = [...sourceLifecycleSet].filter((value) =>
      acquisitionStatusSet.has(value as never),
    );

    expect(intersection).toHaveLength(0);
  });

  it('rejects all Source-lifecycle values on a RepositoryRecord status', () => {
    const records: RepositoryRecord[] = SOURCE_LIFECYCLE_STATUS_VALUES.map(
      (status, i) => ({
        sourceId: `PB-Q${String(i).padStart(3, '0')}`,
        sourceArchive: 'Test Archive',
        status: status as string,
      }),
    );
    const model = buildModel(records);

    const findings = validateVocab(model);

    expect(findings).toHaveLength(SOURCE_LIFECYCLE_STATUS_VALUES.length);
    findings.forEach((finding) => {
      expect(finding.kind).toBe('vocab');
      expect(finding.detail).toContain('status');
    });
  });

  it('ignores empty status string (loader sentinel) and does not report it as a vocab error', () => {
    const record: RepositoryRecord = {
      sourceId: 'PB-P004',
      sourceArchive: 'Test Archive',
      status: '',
    };
    const model = buildModel([record]);

    const findings = validateVocab(model);

    // Empty string is a special loader sentinel and is NOT reported as vocab error
    // (it is reported as missing-required error instead by validateMissingRequired)
    expect(findings).toHaveLength(0);
  });
});
