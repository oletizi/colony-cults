import { describe, expect, it } from 'vitest';

import type {
  ExcludedLeaf,
  LeafRange,
  PageMethodProvenance,
  QualityAssessment,
} from '@/model/quality-assessment';

describe('QualityAssessment', () => {
  it('accepts a sound assessment with all fields set', () => {
    const range: LeafRange = { start: 3, end: 40 };
    const assessment: QualityAssessment = {
      status: 'sound',
      assessedBy: 'operator',
      assessedAt: '2026-07-16T00:00:00.000Z',
      sourceFileChecksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      expectedPageCount: 38,
      observedPageCount: 42,
      approvedLeafRange: range,
      notes: 'Front/back covers and a scanner notice page excluded.',
    };

    expect(assessment.status).toBe('sound');
    expect(assessment.assessedBy).toBe('operator');
    expect(assessment.approvedLeafRange).toEqual({ start: 3, end: 40 });
  });

  it('accepts a minimal unsound assessment without notes', () => {
    const assessment: QualityAssessment = {
      status: 'unsound',
      assessedBy: 'operator',
      assessedAt: '2026-07-16T00:00:00.000Z',
      sourceFileChecksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      expectedPageCount: 38,
      observedPageCount: 12,
      approvedLeafRange: { start: 1, end: 12 },
    };

    expect(assessment.status).toBe('unsound');
    expect(assessment.notes).toBeUndefined();
  });

  it('rejects a status value outside the sound/unsound union (type-level check)', () => {
    const invalid: QualityAssessment = {
      // @ts-expect-error -- status must be 'sound' | 'unsound'
      status: 'maybe',
      assessedBy: 'operator',
      assessedAt: '2026-07-16T00:00:00.000Z',
      sourceFileChecksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      expectedPageCount: 38,
      observedPageCount: 38,
      approvedLeafRange: { start: 1, end: 38 },
    };
    void invalid;
  });

  it('rejects an assessedBy value other than operator (type-level check)', () => {
    const invalid: QualityAssessment = {
      status: 'sound',
      // @ts-expect-error -- assessedBy is always 'operator'
      assessedBy: 'automated-classifier',
      assessedAt: '2026-07-16T00:00:00.000Z',
      sourceFileChecksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      expectedPageCount: 38,
      observedPageCount: 38,
      approvedLeafRange: { start: 1, end: 38 },
    };
    void invalid;
  });

  it('rejects a shape missing a required field (type-level check)', () => {
    // @ts-expect-error -- sourceFileChecksum is required
    const invalid: QualityAssessment = {
      status: 'sound',
      assessedBy: 'operator',
      assessedAt: '2026-07-16T00:00:00.000Z',
      expectedPageCount: 38,
      observedPageCount: 38,
      approvedLeafRange: { start: 1, end: 38 },
    };
    void invalid;
  });
});

describe('ExcludedLeaf', () => {
  it('accepts each classification value', () => {
    const classifications: ExcludedLeaf['classification'][] = [
      'scanner-notice',
      'cover',
      'color-card',
      'blank',
      'other',
    ];

    for (const classification of classifications) {
      const leaf: ExcludedLeaf = {
        leaf: 1,
        classification,
        reason: 'Excluded from reading assets; retained in the source PDF.',
      };
      expect(leaf.classification).toBe(classification);
    }
  });

  it('rejects a classification outside the enumerated set (type-level check)', () => {
    const invalid: ExcludedLeaf = {
      leaf: 1,
      // @ts-expect-error -- classification must be one of the enumerated values
      classification: 'discarded',
      reason: 'Excluded from reading assets; retained in the source PDF.',
    };
    void invalid;
  });
});

describe('PageMethodProvenance', () => {
  it('accepts the pdfimages-lossless method with sourcePdfObject', () => {
    const provenance: PageMethodProvenance = {
      leaf: 5,
      logicalPage: 3,
      method: 'pdfimages-lossless',
      sourcePdfObject: 'im12',
    };

    expect(provenance.method).toBe('pdfimages-lossless');
    expect(provenance.sourcePdfObject).toBe('im12');
    expect(provenance.resolutionDpi).toBeUndefined();
  });

  it('accepts the pdftoppm-rasterised method with resolutionDpi', () => {
    const provenance: PageMethodProvenance = {
      leaf: 5,
      logicalPage: 3,
      method: 'pdftoppm-rasterised',
      resolutionDpi: 400,
    };

    expect(provenance.method).toBe('pdftoppm-rasterised');
    expect(provenance.resolutionDpi).toBe(400);
    expect(provenance.sourcePdfObject).toBeUndefined();
  });

  it('accepts the image-set-jpeg method with sourceImage', () => {
    const provenance: PageMethodProvenance = {
      leaf: 5,
      logicalPage: 3,
      method: 'image-set-jpeg',
      sourceImage: 'nouvellefrancec00groogoog_tif/nouvellefrancec00groogoog_0005.tif',
    };

    expect(provenance.method).toBe('image-set-jpeg');
    expect(provenance.sourceImage).toBe(
      'nouvellefrancec00groogoog_tif/nouvellefrancec00groogoog_0005.tif',
    );
    expect(provenance.sourcePdfObject).toBeUndefined();
    expect(provenance.resolutionDpi).toBeUndefined();
  });

  it('rejects a method outside the enumerated set (type-level check)', () => {
    const invalid: PageMethodProvenance = {
      leaf: 5,
      logicalPage: 3,
      // @ts-expect-error -- method must be 'pdfimages-lossless' | 'pdftoppm-rasterised' | 'image-set-jpeg'
      method: 'manual-crop',
    };
    void invalid;
  });
});
