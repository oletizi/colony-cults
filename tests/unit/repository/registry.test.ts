import { describe, it, expect } from 'vitest';
import { RepositoryAdapterRegistry } from '@/repository/registry';
import type { RepositoryAdapter } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';

/** Minimal fake adapter for papers-past repository. */
const papersPastAdapter: RepositoryAdapter = {
  repository: 'papers-past',
  resolve: () => {
    throw new Error('not used in this test');
  },
  collectRightsEvidence: () => {
    throw new Error('not used in this test');
  },
  acquire: () => {
    throw new Error('not used in this test');
  },
};

/** Minimal fake adapter for new-italy-museum repository. */
const museumAdapter: RepositoryAdapter = {
  repository: 'new-italy-museum',
  resolve: () => {
    throw new Error('not used in this test');
  },
  collectRightsEvidence: () => {
    throw new Error('not used in this test');
  },
  acquire: () => {
    throw new Error('not used in this test');
  },
};

describe('RepositoryAdapterRegistry', () => {
  it('routes a papers-past copy to the papers-past adapter', () => {
    const registry = new RepositoryAdapterRegistry([papersPastAdapter, museumAdapter]);

    const record: RepositoryRecord = {
      sourceId: 'test-source',
      sourceArchive: 'Papers Past',
      identifiers: [
        {
          type: 'papers-past',
          value: 'HNS18840103.2.19.3',
        },
      ],
      status: '',
    };

    const adapter = registry.selectForRecord(record);
    expect(adapter.repository).toBe('papers-past');
  });

  it('routes an accession copy to the museum adapter, not papers-past', () => {
    const registry = new RepositoryAdapterRegistry([papersPastAdapter, museumAdapter]);

    const record: RepositoryRecord = {
      sourceId: 'test-source',
      sourceArchive: 'New Italy Museum',
      identifiers: [
        {
          type: 'accession',
          value: 'ACCESSION-12345',
        },
      ],
      status: '',
    };

    const adapter = registry.selectForRecord(record);
    expect(adapter.repository).toBe('new-italy-museum');
  });
});
