import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { QualityAssessment, ExcludedLeaf } from '@/model/quality-assessment';
import type { Source } from '@/model/source';

/**
 * Real disk round-trip coverage for the Internet Archive acquisition provenance
 * (spec 013, FR-008 / FR-011 / SC-003): `RepositoryRecord.qualityAssessment` and
 * `.excludedLeaves`. These were added to the model in T009 but their SSOT
 * loader/serializer threading was missing, so the live acquire silently dropped
 * them on write. This asserts the FULL serialize -> load -> serialize round trip
 * (not an in-memory construction) so that regression cannot recur.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bibliography-ia-prov-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
function writeSource(name: string, contents: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

const SOURCE: Source = {
  sourceId: 'PB-P900',
  kind: 'monograph',
  titles: [{ text: 'IA Provenance Round-trip', role: 'canonical' }],
  identifiers: [],
};

describe('RepositoryRecord.qualityAssessment / excludedLeaves round-trip', () => {
  it('round-trips a full qualityAssessment + excludedLeaves through serialize -> load, losslessly', () => {
    const qualityAssessment: QualityAssessment = {
      status: 'sound',
      assessedBy: 'operator',
      assessedAt: '2026-07-17T02:58:15.222Z',
      sourceFileChecksum: '04fb97af96f5549b8483f5fb9ca17b22506c8cd3e6a16802f88d2e753664aea9',
      expectedPageCount: 421,
      observedPageCount: 421,
      approvedLeafRange: { start: 3, end: 421 },
      notes: 'Leaves 1-2 = Google digitization preamble, excluded; retained in the source PDF.',
    };
    const excludedLeaves: ExcludedLeaf[] = [
      { leaf: 1, classification: 'scanner-notice', reason: 'Google preamble (EN); retained in source PDF' },
      { leaf: 2, classification: 'other', reason: 'Google preamble (FR); retained in source PDF' },
    ];
    const record: AuthoredRepositoryRecord = {
      sourceArchive: 'Internet Archive',
      status: 'archived',
      identifiers: [{ type: 'ia-item', value: 'nouvellefrancec00groogoog' }],
      qualityAssessment,
      excludedLeaves,
    };

    const serialized = serializeSource({ source: SOURCE, records: [record] });
    const loaded = loadSourceFile(writeSource('PB-P900.yml', serialized));

    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0].qualityAssessment).toEqual(qualityAssessment);
    expect(loaded.records[0].excludedLeaves).toEqual(excludedLeaves);

    // Idempotent: re-serializing the loaded record is byte-identical.
    const reserialized = serializeSource({ source: loaded.source, records: loaded.records });
    expect(reserialized).toBe(serialized);
  });

  it('leaves a record without them unchanged -- regression', () => {
    const record: AuthoredRepositoryRecord = { sourceArchive: 'Gallica / BnF', status: 'archived' };
    const serialized = serializeSource({ source: { ...SOURCE, sourceId: 'PB-P901' }, records: [record] });
    expect(serialized).not.toMatch(/qualityAssessment|excludedLeaves/);
    const loaded = loadSourceFile(writeSource('PB-P901.yml', serialized));
    expect(loaded.records[0].qualityAssessment).toBeUndefined();
    expect(loaded.records[0].excludedLeaves).toBeUndefined();
  });

  it('fails loud on an invalid qualityAssessment.status', () => {
    const filePath = writeSource(
      'PB-P902.yml',
      `
sourceId: PB-P902
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Internet Archive"
    status: to-collect
    qualityAssessment:
      status: maybe
      assessedBy: operator
      assessedAt: "2026-07-17T00:00:00.000Z"
      sourceFileChecksum: deadbeef
      expectedPageCount: 5
      observedPageCount: 5
      approvedLeafRange:
        start: 1
        end: 5
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/status "maybe" must be "sound" or "unsound"/);
  });

  it('fails loud on an unknown excludedLeaves classification', () => {
    const filePath = writeSource(
      'PB-P903.yml',
      `
sourceId: PB-P903
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Internet Archive"
    status: to-collect
    excludedLeaves:
      - leaf: 1
        classification: bogus
        reason: "x"
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/classification "bogus" must be one of/);
  });
});
