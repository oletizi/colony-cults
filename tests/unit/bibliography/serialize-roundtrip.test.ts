import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { Source } from '@/model/source';

/**
 * Regression: `serializeSource` must emit EVERY Source model field it can carry,
 * so a load -> serialize round-trip is lossless. Previously `evidenceClass`,
 * `references`, `knownMemberCount`, and `suspected` were silently dropped, which
 * would erase a source-group's believed extent + inferred-gap acquisition
 * targets (e.g. PB-P006) if it were ever re-serialized.
 */
describe('serializeSource round-trip of previously-dropped fields', () => {
  const source: Source = {
    sourceId: 'PB-P900',
    kind: 'source-group',
    case: 'test-case',
    evidenceClass: 'pamphlet',
    language: 'French',
    creator: 'various',
    knownMemberCount: 'unknown',
    references: [
      {
        citedAs: 'Some advertised journal',
        citedKind: 'journal',
        basis: 'advertised in the promotional matter',
        notes: 'referenced-but-unidentified',
      },
    ],
    suspected: [
      {
        description: 'a suspected pre-discovery gap',
        basis: 'inferred from survivor testimony',
      },
    ],
    titles: [{ text: 'Test source-group', role: 'canonical' }],
    identifiers: [],
  };

  it('preserves evidenceClass, references, knownMemberCount, and suspected through load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssot-roundtrip-'));
    try {
      const path = join(dir, 'PB-P900.yml');
      const yaml = serializeSource({ source, records: [] });
      writeFileSync(path, yaml, 'utf-8');

      const reloaded = loadSourceFile(path).source;

      expect(reloaded.evidenceClass).toBe('pamphlet');
      expect(reloaded.knownMemberCount).toBe('unknown');
      expect(reloaded.references).toHaveLength(1);
      expect(reloaded.references?.[0].citedAs).toBe('Some advertised journal');
      expect(reloaded.references?.[0].citedKind).toBe('journal');
      expect(reloaded.suspected).toHaveLength(1);
      expect(reloaded.suspected?.[0].description).toBe('a suspected pre-discovery gap');
      expect(reloaded.suspected?.[0].basis).toBe('inferred from survivor testimony');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent — re-serializing the reloaded source is byte-identical', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssot-roundtrip-'));
    try {
      const path = join(dir, 'PB-P900.yml');
      const first = serializeSource({ source, records: [] });
      writeFileSync(path, first, 'utf-8');

      const reloaded = loadSourceFile(path).source;
      const second = serializeSource({ source: reloaded, records: [] });

      expect(second).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
