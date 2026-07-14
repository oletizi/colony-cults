import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Source } from '@/model/source';
import { serializeSource } from '@/bibliography/migrate-serialize';
import { loadSourceFile } from '@/bibliography/load';
import { RepositoryAdapterRegistry } from '@/repository/registry';
import type {
  AcquisitionContext,
  AcquisitionResult,
  RepositoryAdapter,
  RepositoryLocator,
  ResolutionContext,
  ResolvedRepositoryItem,
  RightsEvidence,
} from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import { recordRightsAssessment, reviewRightsEvidence } from '@/rights/assess';

/**
 * Tests for `@/rights/assess` (T018, specs/011-museum-acquisition-path,
 * FR-008): `bib rights-assess`'s two operations. Every test writes a real
 * SSOT-shaped fixture to a temp `bibliography/sources`-style directory and
 * re-reads it via `loadSourceFile` after the call, so the persisted-on-disk
 * shape (or its ABSENCE on a review / a failed write) is verified, not just
 * the return value. The adapter is a hand-rolled fake -- never the real
 * engine-backed extractor -- so these tests never touch the network.
 */

const SOURCE_ID = 'PB-M001';
const PAGE_URL = 'https://newitaly.org.au/CAT/000844.htm';
const ACCESSION = 'NIMI-0844';
const ARCHIVE = 'New Italy Museum';
const FIXED_NOW = '2026-07-14T00:00:00.000Z';

function source(): Source {
  return {
    sourceId: SOURCE_ID,
    titles: [{ text: 'Pioneers group portrait', role: 'canonical' }],
    kind: 'archival-item',
    status: 'discovered',
    identifiers: [],
  };
}

function authoredRecord(
  overrides: Partial<AuthoredRepositoryRecord> = {},
): AuthoredRepositoryRecord {
  return {
    sourceArchive: ARCHIVE,
    status: 'wanted',
    identifiers: [{ type: 'accession', value: ACCESSION }],
    sourceUrl: PAGE_URL,
    ...overrides,
  };
}

async function seed(records: AuthoredRepositoryRecord[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rights-assess-'));
  await writeFile(
    join(dir, `${SOURCE_ID}.yml`),
    serializeSource({ source: source(), records }),
    'utf-8',
  );
  return dir;
}

function fixturePath(dir: string): string {
  return join(dir, `${SOURCE_ID}.yml`);
}

/** A fake RepositoryAdapter that PROPOSES canned rights evidence -- never authors a judgment. */
function fakeMuseumAdapter(): {
  adapter: RepositoryAdapter;
  resolvedLocators: RepositoryLocator[];
} {
  const resolvedLocators: RepositoryLocator[] = [];
  const adapter: RepositoryAdapter = {
    repository: 'new-italy-museum',
    async resolve(
      locator: RepositoryLocator,
      _ctx: ResolutionContext,
    ): Promise<ResolvedRepositoryItem> {
      resolvedLocators.push(locator);
      return {
        repository: 'new-italy-museum',
        identifiers: [{ type: 'accession', value: ACCESSION }],
        sourceUrl: locator.value,
        assetLocators: [],
        metadata: {
          date: {
            value: 'circa 1890',
            evidence: { excerpt: 'Photograph taken circa 1890 at New Italy.' },
            interpretation: 'item creation date',
            provenance: {
              modelAssisted: true,
              engine: 'fake-engine',
              model: 'fake-model',
              promptVersion: 'v1',
              at: '2026-07-01T00:00:00.000Z',
            },
          },
        },
      };
    },
    async collectRightsEvidence(item: ResolvedRepositoryItem): Promise<RightsEvidence> {
      return {
        date: item.metadata.date,
        rightsRaw: '© New Italy Museum. No known copyright restrictions.',
      };
    },
    async acquire(_record: RepositoryRecord, _ctx: AcquisitionContext): Promise<AcquisitionResult> {
      throw new Error('fakeMuseumAdapter.acquire: not implemented -- rights-assess never acquires.');
    },
  };
  return { adapter, resolvedLocators };
}

describe('reviewRightsEvidence', () => {
  it('surfaces the grounded date/interpretation/excerpt (and rightsRaw) and writes nothing', async () => {
    const dir = await seed([authoredRecord()]);
    try {
      const before = await readFile(fixturePath(dir), 'utf-8');
      const { adapter, resolvedLocators } = fakeMuseumAdapter();
      const registry = new RepositoryAdapterRegistry([adapter]);

      const result = await reviewRightsEvidence({ sourcesDir: dir, sourceId: SOURCE_ID, registry });

      expect(result.sourceId).toBe(SOURCE_ID);
      expect(result.sourceArchive).toBe(ARCHIVE);
      expect(result.evidence.date?.value).toBe('circa 1890');
      expect(result.evidence.date?.interpretation).toBe('item creation date');
      expect(result.evidence.date?.evidence.excerpt).toBe(
        'Photograph taken circa 1890 at New Italy.',
      );
      expect(result.evidence.rightsRaw).toBe(
        '© New Italy Museum. No known copyright restrictions.',
      );
      expect(resolvedLocators).toEqual([{ repository: 'new-italy-museum', value: PAGE_URL }]);

      const after = await readFile(fixturePath(dir), 'utf-8');
      expect(after).toBe(before);

      const reloaded = loadSourceFile(fixturePath(dir));
      expect(reloaded.records[0].rightsAssessment).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails loud when the selected record carries no sourceUrl', async () => {
    const dir = await seed([authoredRecord({ sourceUrl: undefined })]);
    try {
      const { adapter } = fakeMuseumAdapter();
      const registry = new RepositoryAdapterRegistry([adapter]);
      await expect(
        reviewRightsEvidence({ sourcesDir: dir, sourceId: SOURCE_ID, registry }),
      ).rejects.toThrow(/carries no sourceUrl/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('recordRightsAssessment', () => {
  it('writes a RightsAssessment with assessedBy operator + basis + timestamp, persisted and reloadable', async () => {
    const dir = await seed([authoredRecord()]);
    try {
      const result = await recordRightsAssessment({
        sourcesDir: dir,
        sourceId: SOURCE_ID,
        status: 'public-domain',
        basis: 'Photograph created before 1955; Australian pre-1969 term',
        jurisdiction: 'AU',
        rightsRaw: '© New Italy Museum. No known copyright restrictions.',
        now: () => FIXED_NOW,
      });

      expect(result.assessment).toEqual({
        rightsStatus: 'public-domain',
        rightsBasis: 'Photograph created before 1955; Australian pre-1969 term',
        rightsJurisdiction: 'AU',
        rightsRaw: '© New Italy Museum. No known copyright restrictions.',
        assessedBy: 'operator',
        assessedAt: FIXED_NOW,
      });

      const reloaded = loadSourceFile(fixturePath(dir));
      expect(reloaded.records).toHaveLength(1);
      expect(reloaded.records[0].rightsAssessment).toEqual(result.assessment);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails loud and writes nothing when --basis is missing/empty', async () => {
    const dir = await seed([authoredRecord()]);
    try {
      const before = await readFile(fixturePath(dir), 'utf-8');
      await expect(
        recordRightsAssessment({
          sourcesDir: dir,
          sourceId: SOURCE_ID,
          status: 'public-domain',
          basis: '',
          now: () => FIXED_NOW,
        }),
      ).rejects.toThrow(/--basis is required/);
      const after = await readFile(fixturePath(dir), 'utf-8');
      expect(after).toBe(before);

      const reloaded = loadSourceFile(fixturePath(dir));
      expect(reloaded.records[0].rightsAssessment).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records restricted (blocks later mirroring) and keeps the catalog entry intact', async () => {
    const dir = await seed([authoredRecord()]);
    try {
      const result = await recordRightsAssessment({
        sourcesDir: dir,
        sourceId: SOURCE_ID,
        status: 'restricted',
        basis: 'Photographer death date unknown; term cannot be established',
        now: () => FIXED_NOW,
      });

      expect(result.assessment.rightsStatus).toBe('restricted');

      const reloaded = loadSourceFile(fixturePath(dir));
      const record = reloaded.records[0];
      expect(record.rightsAssessment?.rightsStatus).toBe('restricted');
      // The catalog entry (identifiers/sourceUrl/status) survives the write untouched.
      expect(record.identifiers).toEqual([{ type: 'accession', value: ACCESSION }]);
      expect(record.sourceUrl).toBe(PAGE_URL);
      expect(record.status).toBe('wanted');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes exactly the operator-supplied status -- the tool never derives/overrides it', async () => {
    const dir = await seed([authoredRecord()]);
    try {
      for (const status of ['public-domain', 'restricted', 'uncertain'] as const) {
        const result = await recordRightsAssessment({
          sourcesDir: dir,
          sourceId: SOURCE_ID,
          status,
          basis: `basis for ${status}`,
          now: () => FIXED_NOW,
        });
        expect(result.assessment.rightsStatus).toBe(status);

        const reloaded = loadSourceFile(fixturePath(dir));
        expect(reloaded.records[0].rightsAssessment?.rightsStatus).toBe(status);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a status outside the closed vocab and writes nothing', async () => {
    const dir = await seed([authoredRecord()]);
    try {
      const before = await readFile(fixturePath(dir), 'utf-8');
      await expect(
        recordRightsAssessment({
          sourcesDir: dir,
          sourceId: SOURCE_ID,
          status: 'not-a-real-status',
          basis: 'basis',
          now: () => FIXED_NOW,
        }),
      ).rejects.toThrow(/--status must be/);
      const after = await readFile(fixturePath(dir), 'utf-8');
      expect(after).toBe(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
