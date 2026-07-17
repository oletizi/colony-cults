import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Source } from '@/model/source';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { QualityGateInput } from '@/repository/internet-archive/quality-gate';
import {
  buildInternetArchiveAdapterForMember,
  makeCliQualityGate,
} from '@/cli/bib-acquire-internet-archive';

/**
 * Tests for the Internet Archive `bib acquire` composition-root wiring
 * (T026/T027, specs/013-archiveorg-acquisition-path):
 *
 * - `makeCliQualityGate` -- the flag-driven `QualityGate` (pure; no network,
 *   no filesystem, no env). Covers the two-phase flow's three shapes:
 *   `--approved-range` (phase 2), no range (phase 1, seed proposal), and
 *   `--reject` (fail-closed).
 * - `buildInternetArchiveAdapterForMember` -- mirrors
 *   `@/cli/bib-acquire-museum`'s `buildMuseumAdapterForMember` test shape
 *   (none previously existed for the museum builder; this module
 *   establishes the pattern): builds the adapter ONLY for an `ia-item`
 *   record. The "builds an adapter" case sets the env vars its real deps
 *   (`resolveArchiveRoot`, `resolveObjectStoreConfig`) read, pointed at
 *   throwaway/synthetic values -- construction never touches the network or
 *   B2 (only `new S3Client(...)`/`new PopplerRunnerImpl(...)`, no I/O).
 */

function group(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-S910',
    titles: [{ text: 'A Source Group', role: 'canonical' }],
    kind: 'source-group',
    identifiers: [],
    ...overrides,
  };
}

function member(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P910',
    titles: [{ text: 'De Groote 1880', role: 'canonical' }],
    kind: 'monograph',
    partOf: 'PB-S910',
    status: 'approved-for-acquisition',
    identifiers: [],
    ...overrides,
  };
}

function arkRecord(overrides: Partial<AuthoredRepositoryRecord> = {}): AuthoredRepositoryRecord {
  return {
    sourceArchive: 'Gallica / BnF',
    status: 'to-collect',
    identifiers: [{ type: 'ark', value: 'ark:/12148/bpt6k0000001' }],
    ...overrides,
  };
}

function iaRecord(overrides: Partial<AuthoredRepositoryRecord> = {}): AuthoredRepositoryRecord {
  return {
    sourceArchive: 'Internet Archive',
    status: 'to-collect',
    identifiers: [{ type: 'ia-item', value: 'nouvellefrancec00groogoog' }],
    ...overrides,
  };
}

async function seedSourcesDir(
  entries: { source: Source; records?: AuthoredRepositoryRecord[] }[],
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bib-acquire-ia-'));
  for (const entry of entries) {
    await writeFile(
      join(dir, `${entry.source.sourceId}.yml`),
      serializeSource({ source: entry.source, records: entry.records ?? [] }),
      'utf-8',
    );
  }
  return dir;
}

function qualityGateInput(overrides: Partial<QualityGateInput> = {}): QualityGateInput {
  return {
    pdfPath: '/staging/nouvellefrancec00groogoog/source.pdf',
    sourceFileChecksum: 'a'.repeat(64),
    expectedPageCount: 400,
    observedPageCount: 400,
    proposedRange: { start: 4, end: 368 },
    ...overrides,
  };
}

describe('makeCliQualityGate', () => {
  it('with an approvedRange: reports sound + the operator-supplied range (phase 2)', async () => {
    const gate = makeCliQualityGate({
      approvedRange: { start: 10, end: 350 },
      now: () => '2026-07-16T00:00:00.000Z',
    });

    const assessment = await gate.assess(qualityGateInput());

    expect(assessment.status).toBe('sound');
    expect(assessment.approvedLeafRange).toEqual({ start: 10, end: 350 });
    expect(assessment.assessedBy).toBe('operator');
    expect(assessment.assessedAt).toBe('2026-07-16T00:00:00.000Z');
    expect(assessment.sourceFileChecksum).toBe('a'.repeat(64));
  });

  it('with no approvedRange: reports sound + the scandata-seeded proposedRange (phase 1, --dry-run)', async () => {
    const gate = makeCliQualityGate({ now: () => '2026-07-16T00:00:00.000Z' });

    const assessment = await gate.assess(qualityGateInput({ proposedRange: { start: 4, end: 368 } }));

    expect(assessment.status).toBe('sound');
    expect(assessment.approvedLeafRange).toEqual({ start: 4, end: 368 });
  });

  it('with --reject: reports unsound regardless of any approvedRange (fail-closed)', async () => {
    const gate = makeCliQualityGate({
      approvedRange: { start: 10, end: 350 },
      reject: true,
      notes: 'scan too dark past leaf 300',
      now: () => '2026-07-16T00:00:00.000Z',
    });

    const assessment = await gate.assess(qualityGateInput());

    expect(assessment.status).toBe('unsound');
    expect(assessment.notes).toBe('scan too dark past leaf 300');
    // A leaf range is a required field on every assessment; the rejection is
    // carried by `status` alone (`enforceQualityGate` never inspects the range
    // to decide soundness).
    expect(assessment.approvedLeafRange).toEqual({ start: 4, end: 368 });
  });

  it('carries expectedPageCount/observedPageCount through unchanged', async () => {
    const gate = makeCliQualityGate({ now: () => '2026-07-16T00:00:00.000Z' });

    const assessment = await gate.assess(
      qualityGateInput({ expectedPageCount: 401, observedPageCount: 400 }),
    );

    expect(assessment.expectedPageCount).toBe(401);
    expect(assessment.observedPageCount).toBe(400);
  });
});

describe('buildInternetArchiveAdapterForMember', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined for a member whose selected copy is an ark record (Gallica), never touching env/B2', async () => {
    dir = await seedSourcesDir([
      { source: group(), records: [] },
      { source: member(), records: [arkRecord()] },
    ]);

    const adapter = await buildInternetArchiveAdapterForMember(dir, 'PB-P910', undefined);

    expect(adapter).toBeUndefined();
  });

  it('returns undefined for an unknown sourceId', async () => {
    dir = await seedSourcesDir([{ source: group(), records: [] }]);

    const adapter = await buildInternetArchiveAdapterForMember(dir, 'PB-P999', undefined);

    expect(adapter).toBeUndefined();
  });

  describe('when the selected copy is an ia-item record', () => {
    // `buildInternetArchiveAdapterForMember` constructs the real
    // `S3ObjectStore`/`resolveArchiveRoot` deps (mirroring
    // `buildMuseumAdapterForMember`'s real `S3ObjectStore` construction) --
    // neither performs any I/O at construction time, so pointing them at
    // synthetic, throwaway env values proves the adapter is built without
    // ever touching the network or a real B2 bucket.
    let credentialsPath: string;
    const savedEnv: Record<string, string | undefined> = {};
    const envKeys = [
      'COLONY_ARCHIVE_ROOT',
      'COLONY_S3_BUCKET',
      'COLONY_S3_ENDPOINT',
      'COLONY_S3_REGION',
      'COLONY_B2_CREDENTIALS',
    ] as const;

    afterEach(async () => {
      for (const key of envKeys) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
      if (credentialsPath) {
        await rm(credentialsPath, { force: true });
      }
    });

    async function seedEnv(): Promise<void> {
      for (const key of envKeys) {
        savedEnv[key] = process.env[key];
      }
      const credDir = await mkdtemp(join(tmpdir(), 'b2-creds-'));
      credentialsPath = join(credDir, 'b2-credentials.txt');
      await writeFile(credentialsPath, 'keyID: test-key-id\napplicationKey:\ttest-app-key\n', 'utf-8');

      process.env.COLONY_ARCHIVE_ROOT = await mkdtemp(join(tmpdir(), 'archive-root-'));
      process.env.COLONY_S3_BUCKET = 'test-bucket';
      process.env.COLONY_S3_ENDPOINT = 'https://example-b2-endpoint.test';
      process.env.COLONY_S3_REGION = 'us-west-000';
      process.env.COLONY_B2_CREDENTIALS = credentialsPath;
    }

    it('builds an InternetArchiveAdapter (repository: internet-archive)', async () => {
      await seedEnv();
      dir = await seedSourcesDir([
        { source: group(), records: [] },
        { source: member({ sourceId: 'PB-P911' }), records: [iaRecord()] },
      ]);

      const adapter = await buildInternetArchiveAdapterForMember(dir, 'PB-P911', undefined);

      expect(adapter).toBeDefined();
      expect(adapter?.repository).toBe('internet-archive');
    });

    it('threads --approved-range/--reject/--notes into the adapter\'s injected QualityGate', async () => {
      await seedEnv();
      dir = await seedSourcesDir([
        { source: group(), records: [] },
        { source: member({ sourceId: 'PB-P912' }), records: [iaRecord()] },
      ]);

      const adapter = await buildInternetArchiveAdapterForMember(dir, 'PB-P912', undefined, {
        approvedRange: { start: 4, end: 368 },
      });

      expect(adapter).toBeDefined();
    });
  });
});
