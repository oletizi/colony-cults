/**
 * Tests for RepositoryAdapterRegistry -- deterministic dispatch by
 * copy-identifier type and explicit-by-name selection (INV-D).
 *
 * Uses fake adapters with no real behavior; the registry is a pure
 * selection layer and must not depend on any concrete adapter
 * implementation.
 */

import { describe, it, expect } from 'vitest';
import { RepositoryAdapterRegistry } from '@/repository/registry';
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
import type { RepositoryRecord } from '@/model/repository-record';

/** A fake adapter with no real behavior -- exercises only `repository`. */
function fakeAdapter(repository: RepositoryName): RepositoryAdapter {
  return {
    repository,
    async resolve(
      _locator: RepositoryLocator,
      _ctx: ResolutionContext,
    ): Promise<ResolvedRepositoryItem> {
      throw new Error(`fakeAdapter(${repository}): resolve not implemented`);
    },
    async collectRightsEvidence(
      _item: ResolvedRepositoryItem,
    ): Promise<RightsEvidence> {
      throw new Error(`fakeAdapter(${repository}): collectRightsEvidence not implemented`);
    },
    async acquire(
      _record: RepositoryRecord,
      _ctx: AcquisitionContext,
    ): Promise<AcquisitionResult> {
      throw new Error(`fakeAdapter(${repository}): acquire not implemented`);
    },
  };
}

function baseRecord(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'src-1',
    sourceArchive: 'Test Archive',
    status: 'pending',
    ...overrides,
  };
}

describe('RepositoryAdapterRegistry', () => {
  describe('selectForRecord', () => {
    it('dispatches a record with an ark identifier to the gallica adapter', () => {
      const gallica = fakeAdapter('gallica');
      const museum = fakeAdapter('new-italy-museum');
      const registry = new RepositoryAdapterRegistry([gallica, museum]);

      const record = baseRecord({
        identifiers: [{ type: 'ark', value: 'ark:/12345/x' }],
      });

      expect(registry.selectForRecord(record)).toBe(gallica);
    });

    it('dispatches a record with an accession identifier to the new-italy-museum adapter', () => {
      const gallica = fakeAdapter('gallica');
      const museum = fakeAdapter('new-italy-museum');
      const registry = new RepositoryAdapterRegistry([gallica, museum]);

      const record = baseRecord({
        identifiers: [{ type: 'accession', value: 'MU.2024.001' }],
      });

      expect(registry.selectForRecord(record)).toBe(museum);
    });

    it('dispatches a record with an ia-item identifier to the internet-archive adapter', () => {
      const gallica = fakeAdapter('gallica');
      const museum = fakeAdapter('new-italy-museum');
      const internetArchive = fakeAdapter('internet-archive');
      const registry = new RepositoryAdapterRegistry([gallica, museum, internetArchive]);

      const record = baseRecord({
        identifiers: [{ type: 'ia-item', value: 'nouvellefrancec00groogoog' }],
      });

      expect(registry.selectForRecord(record)).toBe(internetArchive);
    });

    it('preserves existing ark and accession dispatch when internet-archive adapter is registered', () => {
      const gallica = fakeAdapter('gallica');
      const museum = fakeAdapter('new-italy-museum');
      const internetArchive = fakeAdapter('internet-archive');
      const registry = new RepositoryAdapterRegistry([gallica, museum, internetArchive]);

      const arkRecord = baseRecord({
        identifiers: [{ type: 'ark', value: 'ark:/12345/x' }],
      });
      expect(registry.selectForRecord(arkRecord)).toBe(gallica);

      const accessionRecord = baseRecord({
        identifiers: [{ type: 'accession', value: 'MU.2024.001' }],
      });
      expect(registry.selectForRecord(accessionRecord)).toBe(museum);
    });

    it('throws when the record has no identifiers at all', () => {
      const registry = new RepositoryAdapterRegistry([
        fakeAdapter('gallica'),
        fakeAdapter('new-italy-museum'),
      ]);

      const record = baseRecord();

      expect(() => registry.selectForRecord(record)).toThrow(
        /no supported copy identifier/,
      );
      expect(() => registry.selectForRecord(record)).toThrow(/src-1/);
    });

    it('throws when the record has identifiers but none is a supported (dispatchable) type', () => {
      const registry = new RepositoryAdapterRegistry([
        fakeAdapter('gallica'),
        fakeAdapter('new-italy-museum'),
      ]);

      const record = baseRecord({
        identifiers: [{ type: 'iiif-manifest', value: 'https://example.com/manifest.json' }],
      });

      expect(() => registry.selectForRecord(record)).toThrow(
        /no supported copy identifier/,
      );
    });

    it('throws on ambiguous identifiers mapping to more than one adapter', () => {
      const registry = new RepositoryAdapterRegistry([
        fakeAdapter('gallica'),
        fakeAdapter('new-italy-museum'),
      ]);

      const record = baseRecord({
        identifiers: [
          { type: 'ark', value: 'ark:/12345/x' },
          { type: 'accession', value: 'MU.2024.001' },
        ],
      });

      expect(() => registry.selectForRecord(record)).toThrow(/ambiguous/);
      expect(() => registry.selectForRecord(record)).toThrow(/gallica/);
      expect(() => registry.selectForRecord(record)).toThrow(/new-italy-museum/);
    });

    it('does not throw on ambiguity when two identifiers of the same type map to one adapter', () => {
      const gallica = fakeAdapter('gallica');
      const registry = new RepositoryAdapterRegistry([gallica]);

      const record = baseRecord({
        identifiers: [
          { type: 'ark', value: 'ark:/12345/x' },
          { type: 'ark', value: 'ark:/12345/y' },
        ],
      });

      expect(registry.selectForRecord(record)).toBe(gallica);
    });

    it('throws when the single eligible repository has no registered adapter', () => {
      const registry = new RepositoryAdapterRegistry([fakeAdapter('gallica')]);

      const record = baseRecord({
        identifiers: [{ type: 'accession', value: 'MU.2024.001' }],
      });

      expect(() => registry.selectForRecord(record)).toThrow(
        /no adapter registered for repository "new-italy-museum"/,
      );
    });
  });

  describe('selectByName', () => {
    it('returns the adapter registered under an explicit name', () => {
      const museum = fakeAdapter('new-italy-museum');
      const registry = new RepositoryAdapterRegistry([fakeAdapter('gallica'), museum]);

      expect(registry.selectByName('new-italy-museum')).toBe(museum);
    });

    it('throws when no adapter is registered under the requested name', () => {
      const registry = new RepositoryAdapterRegistry([fakeAdapter('gallica')]);

      expect(() => registry.selectByName('new-italy-museum')).toThrow(
        /no adapter registered for repository "new-italy-museum"/,
      );
    });
  });

  describe('construction', () => {
    it('throws on duplicate registration of the same repository name', () => {
      expect(
        () => new RepositoryAdapterRegistry([fakeAdapter('gallica'), fakeAdapter('gallica')]),
      ).toThrow(/duplicate adapter registered for repository "gallica"/);
    });

    it('accepts an empty adapter list (no dispatch is possible, but construction succeeds)', () => {
      expect(() => new RepositoryAdapterRegistry([])).not.toThrow();
    });
  });
});
