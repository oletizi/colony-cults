import { describe, expect, it } from 'vitest';

import type { AcquiredAsset, AcquiredAssetRole } from '@/model/acquired-asset';
import { ACQUIRED_ASSET_ROLES, isAcquiredAssetRole } from '@/model/acquired-asset';

describe('AcquiredAsset', () => {
  it('accepts a valid shape with all optional fields set', () => {
    const asset: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
      role: 'front',
      sequence: 1,
      representationChoice: 'max-resolution',
    };

    expect(asset.role).toBe('front');
    expect(asset.sequence).toBe(1);
    expect(asset.representationChoice).toBe('max-resolution');
  });

  it('accepts the new role value "repository-source"', () => {
    const asset: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
      role: 'repository-source',
    };

    expect(asset.role).toBe('repository-source');
  });

  it('accepts the new role value "page-master"', () => {
    const asset: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
      role: 'page-master',
    };

    expect(asset.role).toBe('page-master');
  });

  it('accepts existing role value "reverse"', () => {
    const asset: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
      role: 'reverse',
    };

    expect(asset.role).toBe('reverse');
  });

  it('accepts existing role value "page"', () => {
    const asset: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
      role: 'page',
    };

    expect(asset.role).toBe('page');
  });

  it('accepts existing role value "primary" (the master role the museum adapter writes)', () => {
    const asset: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
      role: 'primary',
    };

    expect(asset.role).toBe('primary');
  });

  it('type checks AcquiredAssetRole union type from the tuple source of truth', () => {
    const roles: readonly AcquiredAssetRole[] = ACQUIRED_ASSET_ROLES;
    expect([...roles]).toEqual(['front', 'reverse', 'page', 'primary', 'repository-source', 'page-master']);
  });

  it('isAcquiredAssetRole guards known vs unknown roles (loader boundary)', () => {
    for (const r of ACQUIRED_ASSET_ROLES) {
      expect(isAcquiredAssetRole(r)).toBe(true);
    }
    expect(isAcquiredAssetRole('thumbnail')).toBe(false);
    expect(isAcquiredAssetRole('')).toBe(false);
  });

  it('accepts a minimal shape with only the required fields', () => {
    const asset: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
    };

    expect(asset.role).toBeUndefined();
    expect(asset.sequence).toBeUndefined();
    expect(asset.representationChoice).toBeUndefined();
  });

  it('rejects a shape missing a required field (type-level check)', () => {
    // @ts-expect-error -- objectStoreKey is required
    const invalid: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      byteLength: 2_048_576,
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
    };
    void invalid;
  });

  it('rejects a non-number byteLength (type-level check)', () => {
    const invalid: AcquiredAsset = {
      sourceUrl: 'https://musarch.example/items/1234/full.jpg',
      mediaType: 'image/jpeg',
      objectStoreKey: 'archive/cases/port-breton/PB-P006/f001.jpg',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      // @ts-expect-error -- byteLength must be a number
      byteLength: '2048576',
      provenancePath: 'archive/cases/port-breton/PB-P006/f001.yml',
    };
    void invalid;
  });
});
