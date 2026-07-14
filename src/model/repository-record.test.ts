import { describe, expect, it } from 'vitest';

import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Type-level coverage for the museum copy-level fields added to
 * `RepositoryRecord` (T005, specs/011-museum-acquisition-path/data-model.md):
 * `assets`, `sourceUrl`, `rightsAssessment`. All three are additive and
 * optional -- an ordinary Gallica-path record with none of them set must
 * remain valid.
 */
describe('RepositoryRecord: museum copy-level fields', () => {
  it('accepts a record with assets, sourceUrl, and rightsAssessment set', () => {
    const asset: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
      role: 'front',
    };

    const record: RepositoryRecord = {
      sourceId: 'PB-P006',
      sourceArchive: 'New Italy Pioneers Museum',
      status: 'collected',
      sourceUrl: 'https://musarch.example/items/1234',
      assets: [asset],
      rightsAssessment: {
        rightsRaw: '© New Italy Museum. Public domain.',
        rightsStatus: 'public-domain',
        rightsBasis: 'Photograph created before 1955; Australian pre-1969 term',
        rightsJurisdiction: 'AU',
        assessedBy: 'operator',
        assessedAt: '2026-07-14T00:00:00.000Z',
      },
    };

    expect(record.assets).toHaveLength(1);
    expect(record.assets?.[0].role).toBe('front');
    expect(record.sourceUrl).toBe('https://musarch.example/items/1234');
    expect(record.rightsAssessment?.rightsStatus).toBe('public-domain');
  });

  it('accepts an ordinary record with none of the museum fields set', () => {
    const record: RepositoryRecord = {
      sourceId: 'PB-P001',
      sourceArchive: 'Gallica / BnF',
      status: 'collected',
    };

    expect(record.assets).toBeUndefined();
    expect(record.sourceUrl).toBeUndefined();
    expect(record.rightsAssessment).toBeUndefined();
  });

  it('rejects a rightsAssessment with a model-authored assessedBy (type-level check)', () => {
    const invalid: RepositoryRecord = {
      sourceId: 'PB-P006',
      sourceArchive: 'New Italy Pioneers Museum',
      status: 'wanted',
      rightsAssessment: {
        rightsStatus: 'uncertain',
        rightsBasis: 'No credit line found; pending manual review',
        // @ts-expect-error -- assessedBy must be the literal 'operator'
        assessedBy: 'model',
        assessedAt: '2026-07-14T00:00:00.000Z',
      },
    };
    void invalid;
  });
});
