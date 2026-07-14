import { describe, expect, it } from 'vitest';

import type { RightsAssessment } from '@/model/rights';

describe('RightsAssessment', () => {
  it('accepts a valid operator-authored shape', () => {
    const assessment: RightsAssessment = {
      rightsRaw: '© State Library of Queensland. Public domain.',
      rightsStatus: 'public-domain',
      rightsBasis: 'Photograph created before 1955; Australian pre-1969 term',
      rightsJurisdiction: 'AU',
      assessedBy: 'operator',
      assessedAt: '2026-07-14T00:00:00.000Z',
    };

    expect(assessment.rightsStatus).toBe('public-domain');
    expect(assessment.assessedBy).toBe('operator');
    expect(assessment.rightsBasis.length).toBeGreaterThan(0);
  });

  it('accepts a minimal shape with only the required fields', () => {
    const assessment: RightsAssessment = {
      rightsStatus: 'uncertain',
      rightsBasis: 'No credit line found; pending manual review',
      assessedBy: 'operator',
      assessedAt: '2026-07-14T00:00:00.000Z',
    };

    expect(assessment.rightsRaw).toBeUndefined();
    expect(assessment.rightsJurisdiction).toBeUndefined();
  });

  it('rejects a rightsStatus outside the closed vocab (type-level check)', () => {
    const invalid: RightsAssessment = {
      // @ts-expect-error -- rightsStatus must be 'public-domain' | 'restricted' | 'uncertain'
      rightsStatus: 'unknown',
      rightsBasis: 'basis',
      assessedBy: 'operator',
      assessedAt: '2026-07-14T00:00:00.000Z',
    };
    void invalid;
  });

  it('rejects an assessedBy value other than operator (type-level check)', () => {
    const invalid: RightsAssessment = {
      rightsStatus: 'restricted',
      rightsBasis: 'basis',
      // @ts-expect-error -- assessedBy must be the literal 'operator'
      assessedBy: 'model',
      assessedAt: '2026-07-14T00:00:00.000Z',
    };
    void invalid;
  });

  it('rejects an assessment with no rightsBasis (type-level check)', () => {
    // @ts-expect-error -- rightsBasis is required
    const invalid: RightsAssessment = {
      rightsStatus: 'restricted',
      assessedBy: 'operator',
      assessedAt: '2026-07-14T00:00:00.000Z',
    };
    void invalid;
  });
});
