import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MigratedSource } from '@/bibliography/migrate-serialize';
import { serializeSource } from '@/bibliography/migrate-serialize';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { Source } from '@/model/source';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'source-writer-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fixture(): MigratedSource {
  const source: Source = {
    sourceId: 'PB-P099',
    kind: 'monograph',
    case: 'port-breton',
    language: 'French',
    creator: 'various',
    titles: [{ text: 'A minimal test source', role: 'canonical' }],
    identifiers: [],
    notes: 'fixture for source-writer unit test',
  };
  return { source, records: [] };
}

describe('writeSourceFile', () => {
  it('writes the file to <dir>/<sourceId>.yml with contents equal to serializeSource', () => {
    const migrated = fixture();

    const filePath = writeSourceFile(dir, migrated);

    expect(filePath).toBe(path.join(dir, 'PB-P099.yml'));
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe(serializeSource(migrated));
  });

  it('is idempotent: re-writing identical input produces byte-identical output', () => {
    const migrated = fixture();

    const filePath1 = writeSourceFile(dir, migrated);
    const contents1 = readFileSync(filePath1, 'utf-8');

    const filePath2 = writeSourceFile(dir, migrated);
    const contents2 = readFileSync(filePath2, 'utf-8');

    expect(filePath2).toBe(filePath1);
    expect(contents2).toBe(contents1);
  });

  it('throws a descriptive error on an empty sourceId', () => {
    const migrated = fixture();
    migrated.source.sourceId = '';

    expect(() => writeSourceFile(dir, migrated)).toThrow(/sourceId/);
  });
});
