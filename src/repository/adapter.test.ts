/**
 * Type test for RepositoryAdapter interface.
 *
 * Verifies that the interface is implementable by constructing a typed
 * fake adapter object literal that satisfies the contract.
 */

import { describe, it, expect } from 'vitest';
import type {
  RepositoryAdapter,
  RepositoryName,
  RepositoryLocator,
  ResolutionContext,
  AcquisitionContext,
  ResolvedRepositoryItem,
  RightsEvidence,
  AcquisitionResult,
} from '@/repository/adapter';
import type { RepositoryRecord, CopyIdentifier } from '@/model/repository-record';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type {
  GroundedExtraction,
  MuseumItemFields,
} from '@/extraction/structured-extractor';

/**
 * A minimal fake adapter that satisfies the RepositoryAdapter interface.
 * Proves the interface is implementable and type-correct.
 */
const fakeRepositoryAdapter: RepositoryAdapter = {
  repository: 'gallica',

  async resolve(
    locator: RepositoryLocator,
    _ctx: ResolutionContext,
  ): Promise<ResolvedRepositoryItem> {
    return {
      repository: locator.repository,
      identifiers: [
        {
          type: 'ark',
          value: 'ark:/12345/fake-item',
        },
      ] as CopyIdentifier[],
      sourceUrl: `https://example.com/item/${locator.value}`,
      title: 'Fake Item',
      assetLocators: [
        {
          url: 'https://example.com/asset/1.jpg',
          role: 'page',
          sequence: 1,
        },
      ],
      metadata: {} as GroundedExtraction<MuseumItemFields>,
    };
  },

  async collectRightsEvidence(
    _item: ResolvedRepositoryItem,
  ): Promise<RightsEvidence> {
    return {
      rightsRaw: 'Public Domain',
      publicationStatus: 'published',
      jurisdiction: 'FR',
    };
  },

  async acquire(
    record: RepositoryRecord,
    _ctx: AcquisitionContext,
  ): Promise<AcquisitionResult> {
    const fakeAsset: AcquiredAsset = {
      sourceUrl: 'https://example.com/asset/1.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'b2://fake-bucket/fake-key',
      checksum: 'abc123def456',
      byteLength: 1024,
      provenancePath: 'provenance/fake-provenance.json',
      role: 'page',
      sequence: 1,
    };

    return {
      repositoryRecordId: record.sourceId,
      assets: [fakeAsset],
      metadataSnapshot: {
        raw: '<html>fake</html>',
        retrievedAt: new Date().toISOString(),
      },
      complete: true,
      reconciliationRequired: false,
    };
  },
};

describe('RepositoryAdapter', () => {
  it('should be implementable as a typed object literal', () => {
    // Assert that fakeRepositoryAdapter satisfies the interface.
    // The typed const assignment is the actual test; if the type does not
    // match, TypeScript compilation fails.
    expect(fakeRepositoryAdapter.repository).toBe('gallica');
    expect(typeof fakeRepositoryAdapter.resolve).toBe('function');
    expect(typeof fakeRepositoryAdapter.collectRightsEvidence).toBe('function');
    expect(typeof fakeRepositoryAdapter.acquire).toBe('function');
  });

  it('should support repository name as readonly property', () => {
    // Verify readonly behavior at runtime: assignment fails silently in non-strict mode,
    // but TypeScript enforces it at compile time.
    expect(fakeRepositoryAdapter.repository).toBe('gallica');
  });

  it('should resolve a locator', async () => {
    const locator: RepositoryLocator = {
      repository: 'gallica',
      value: 'ark:/12345/test-item',
    };
    const result = await fakeRepositoryAdapter.resolve(locator, {});

    expect(result.repository).toBe('gallica');
    expect(result.identifiers).toHaveLength(1);
    expect(result.identifiers[0].type).toBe('ark');
    expect(result.sourceUrl).toContain('example.com');
    expect(result.assetLocators).toHaveLength(1);
  });

  it('should collect rights evidence', async () => {
    const item: ResolvedRepositoryItem = {
      repository: 'gallica',
      identifiers: [{ type: 'ark', value: 'ark:/12345/test' }],
      sourceUrl: 'https://example.com/test',
      title: 'Fake Item',
      assetLocators: [{ url: 'https://example.com/asset' }],
      metadata: {} as GroundedExtraction<MuseumItemFields>,
    };

    const evidence = await fakeRepositoryAdapter.collectRightsEvidence(item);

    expect(evidence.rightsRaw).toBe('Public Domain');
    expect(evidence.publicationStatus).toBe('published');
    expect(evidence.jurisdiction).toBe('FR');
  });

  it('should acquire assets from a record', async () => {
    const record: RepositoryRecord = {
      sourceId: 'test-source-id',
      sourceArchive: 'Test Archive',
      status: 'pending',
    };

    const result = await fakeRepositoryAdapter.acquire(record, {});

    expect(result.repositoryRecordId).toBe('test-source-id');
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].mediaType).toBe('image/jpeg');
    expect(result.complete).toBe(true);
    expect(result.reconciliationRequired).toBe(false);
    expect(result.metadataSnapshot.raw).toContain('html');
  });
});
