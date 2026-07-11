import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Source } from '@/model/source';

/**
 * Round-trip coverage for the additive optional RepositoryRecord fields
 * (T007/T008, specs/006-source-group-acquisition/data-model.md):
 * `metadataSnapshot`, `verification`, and `Rights.raw`. None of these are
 * required -- absent stays absent, no field is fabricated, and their
 * presence/absence must not disturb serialization of an ordinary record.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bibliography-extras-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSource(name: string, contents: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

describe('RepositoryRecord additive optional fields: metadataSnapshot, verification, rights.raw', () => {
  it('round-trips metadataSnapshot + verification + rights.raw through serialize -> load, stably', () => {
    const source: Source = {
      sourceId: 'PB-P099',
      kind: 'monograph',
      titles: [{ text: 'Test Title', role: 'canonical' }],
      identifiers: [],
    };
    const record: AuthoredRepositoryRecord = {
      sourceArchive: 'Gallica / BnF',
      status: 'to-collect',
      rights: {
        ark: 'ark:/12148/test',
        status: 'public-domain',
        rawResponse: '<xml/>',
        dcRights: ['domaine public'],
        raw: 'Domaine public',
      },
      metadataSnapshot: {
        path: 'bibliography/snapshots/PB-P099/gallica-2026-07-10.json',
        retrievedAt: '2026-07-10T00:00:00Z',
        endpoint: 'https://gallica.bnf.fr/services/OAIRecord',
        normalizationVersion: 1,
      },
      verification: {
        result: 'passed',
        verifiedAt: '2026-07-10T00:05:00Z',
        checks: {
          identifierResolved: 'passed',
          rights: 'passed',
          requiredMetadata: 'passed',
          hardDuplicate: 'passed',
          possibleDuplicate: 'passed',
        },
        snapshotRef: 'bibliography/snapshots/PB-P099/gallica-2026-07-10.json',
      },
    };

    const serialized = serializeSource({ source, records: [record] });
    const filePath = writeSource('PB-P099.yml', serialized);

    const loaded = loadSourceFile(filePath);
    expect(loaded.records).toHaveLength(1);
    const loadedRecord = loaded.records[0];

    expect(loadedRecord.metadataSnapshot).toEqual(record.metadataSnapshot);
    expect(loadedRecord.verification).toEqual(record.verification);
    expect(loadedRecord.rights?.raw).toBe('Domaine public');
    expect(loadedRecord.rights?.status).toBe('public-domain');

    // Idempotent: re-serializing the loaded record yields byte-identical output.
    const reserialized = serializeSource({ source: loaded.source, records: loaded.records });
    expect(reserialized).toBe(serialized);
  });

  it('rejects an invalid verification.checks.possibleDuplicate value (closed vocab, no silent drop)', () => {
    const filePath = writeSource(
      'PB-P097.yml',
      `
sourceId: PB-P097
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: wanted
    verification:
      result: passed
      verifiedAt: "2026-07-10T00:05:00Z"
      checks:
        identifierResolved: passed
        rights: passed
        requiredMetadata: passed
        hardDuplicate: passed
        possibleDuplicate: maybe
      snapshotRef: "bibliography/snapshots/PB-P097/x.json"
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/possibleDuplicate must be "passed" or "review-required"/);
  });

  it('rejects an unknown key on metadataSnapshot (rule 8, no silent drop)', () => {
    const filePath = writeSource(
      'PB-P096.yml',
      `
sourceId: PB-P096
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: wanted
    metadataSnapshot:
      path: "bibliography/snapshots/PB-P096/x.json"
      retrievedAt: "2026-07-10T00:00:00Z"
      endpoint: "https://gallica.bnf.fr/services/OAIRecord"
      normalizationVersion: 1
      bogusField: nope
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/unknown key "bogusField"/);
  });

  it('omits metadataSnapshot/verification/rights.raw when absent -- no field is fabricated', () => {
    const source: Source = {
      sourceId: 'PB-P098',
      kind: 'monograph',
      titles: [{ text: 'Test Title 2', role: 'canonical' }],
      identifiers: [],
    };
    const record: AuthoredRepositoryRecord = {
      sourceArchive: 'Gallica / BnF',
      status: 'wanted',
    };

    const serialized = serializeSource({ source, records: [record] });
    expect(serialized).not.toMatch(/metadataSnapshot/);
    expect(serialized).not.toMatch(/verification/);

    const filePath = writeSource('PB-P098.yml', serialized);
    const loaded = loadSourceFile(filePath);
    expect(loaded.records[0].metadataSnapshot).toBeUndefined();
    expect(loaded.records[0].verification).toBeUndefined();
    expect(loaded.records[0].rights).toBeUndefined();
  });

  it('leaves an existing rights determination with no raw field untouched (backward compatible)', () => {
    const filePath = writeSource(
      'PB-P095.yml',
      `
sourceId: PB-P095
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: collected
    rights:
      ark: "ark:/12148/legacy"
      status: public-domain
      rawResponse: "<xml/>"
      dcRights:
        - "domaine public"
`,
    );
    const loaded = loadSourceFile(filePath);
    expect(loaded.records[0].rights?.raw).toBeUndefined();
    expect(loaded.records[0].rights?.status).toBe('public-domain');

    const reserialized = serializeSource({ source: loaded.source, records: loaded.records });
    expect(reserialized).not.toMatch(/raw:/);
  });
});
