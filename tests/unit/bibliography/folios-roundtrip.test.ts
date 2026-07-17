import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Source } from '@/model/source';

/**
 * Round-trip + fail-loud coverage for `RepositoryRecord.folios` (specs/012,
 * T004-T006): present ⇒ the held copy is an EXCERPT comprising exactly these
 * folios of the document at the record's ark; absent ⇒ a whole-document
 * holding (unchanged). See specs/012-page-range-acquisition/contracts/model.md.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bibliography-folios-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSource(name: string, contents: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

describe('RepositoryRecord.folios round-trip', () => {
  it('round-trips folios: [48,49,50] through serialize -> load, losslessly and order-stable', () => {
    const source: Source = {
      sourceId: 'PB-P800',
      kind: 'monograph',
      titles: [{ text: 'Excerpt Test Title', role: 'canonical' }],
      identifiers: [],
    };
    const record: AuthoredRepositoryRecord = {
      sourceArchive: 'Gallica / BnF',
      status: 'to-collect',
      folios: [48, 49, 50],
    };

    const serialized = serializeSource({ source, records: [record] });
    const filePath = writeSource('PB-P800.yml', serialized);

    const loaded = loadSourceFile(filePath);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.records[0].folios).toEqual([48, 49, 50]);

    // Idempotent: re-serializing the loaded record yields byte-identical output.
    const reserialized = serializeSource({ source: loaded.source, records: loaded.records });
    expect(reserialized).toBe(serialized);
  });

  it('leaves a whole-document record (no folios) unchanged -- regression', () => {
    const source: Source = {
      sourceId: 'PB-P801',
      kind: 'monograph',
      titles: [{ text: 'Whole Document Title', role: 'canonical' }],
      identifiers: [],
    };
    const record: AuthoredRepositoryRecord = {
      sourceArchive: 'Gallica / BnF',
      status: 'archived',
    };

    const serialized = serializeSource({ source, records: [record] });
    expect(serialized).not.toMatch(/folios/);

    const filePath = writeSource('PB-P801.yml', serialized);
    const loaded = loadSourceFile(filePath);
    expect(loaded.records[0].folios).toBeUndefined();

    const reserialized = serializeSource({ source: loaded.source, records: loaded.records });
    expect(reserialized).toBe(serialized);
  });

  it('rejects a non-array folios value, fail-loud', () => {
    const filePath = writeSource(
      'PB-P802.yml',
      `
sourceId: PB-P802
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: to-collect
    folios: 48
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/folios.*must be an array/);
  });

  it('rejects an unsorted folios array, fail-loud', () => {
    const filePath = writeSource(
      'PB-P803.yml',
      `
sourceId: PB-P803
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: to-collect
    folios: [50, 48]
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/folios.*strictly ascending/);
  });

  it('rejects a folios array with a duplicate, fail-loud', () => {
    const filePath = writeSource(
      'PB-P804.yml',
      `
sourceId: PB-P804
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: to-collect
    folios: [48, 48]
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/folios.*duplicate value 48/);
  });

  it('rejects a folios array containing a value < 1, fail-loud', () => {
    const filePath = writeSource(
      'PB-P805.yml',
      `
sourceId: PB-P805
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: to-collect
    folios: [0, 1]
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/folios\[0\] must be >= 1, got 0/);
  });

  it('rejects a folios array with a non-integer element, fail-loud', () => {
    const filePath = writeSource(
      'PB-P806.yml',
      `
sourceId: PB-P806
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: to-collect
    folios: [48.5, 49]
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/folios\[0\] must be an integer, got 48.5/);
  });

  it('rejects an empty folios array, fail-loud', () => {
    const filePath = writeSource(
      'PB-P807.yml',
      `
sourceId: PB-P807
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
repositoryRecords:
  - sourceArchive: "Gallica / BnF"
    status: to-collect
    folios: []
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/folios must be a non-empty array/);
  });
});
