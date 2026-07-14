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
 * `references`, `knownMemberCount` (now `knownExtent`, T025), and `suspected`
 * were silently dropped, which would erase a source-group's believed extent +
 * inferred-gap acquisition targets (e.g. PB-P006) if it were ever
 * re-serialized.
 */
describe('serializeSource round-trip of previously-dropped fields', () => {
  const source: Source = {
    sourceId: 'PB-P900',
    kind: 'source-group',
    case: 'test-case',
    evidenceClass: 'pamphlet',
    language: 'French',
    creator: 'various',
    knownExtent: { state: 'irreducible', basis: 'an unbounded, changing holding' },
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
      {
        description: 'a suspected work with a recorded resolution',
        basis: 'trial testimony references an appeal not yet located',
        resolution: {
          state: 'identified',
          candidate: 'Trove: The Vagabond, 3 May 1883',
          resolvedAt: '2026-07-01',
        },
      },
    ],
    titles: [{ text: 'Test source-group', role: 'canonical' }],
    identifiers: [],
  };

  it('preserves evidenceClass, references, knownExtent, and suspected through load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssot-roundtrip-'));
    try {
      const path = join(dir, 'PB-P900.yml');
      const yaml = serializeSource({ source, records: [] });
      writeFileSync(path, yaml, 'utf-8');

      const reloaded = loadSourceFile(path).source;

      expect(reloaded.evidenceClass).toBe('pamphlet');
      expect(reloaded.knownExtent).toEqual({
        state: 'irreducible',
        basis: 'an unbounded, changing holding',
      });
      expect(reloaded.references).toHaveLength(1);
      expect(reloaded.references?.[0].citedAs).toBe('Some advertised journal');
      expect(reloaded.references?.[0].citedKind).toBe('journal');
      expect(reloaded.suspected).toHaveLength(2);
      expect(reloaded.suspected?.[0].description).toBe('a suspected pre-discovery gap');
      expect(reloaded.suspected?.[0].basis).toBe('inferred from survivor testimony');
      expect(reloaded.suspected?.[0].resolution).toBeUndefined();
      expect(reloaded.suspected?.[1].resolution).toEqual({
        state: 'identified',
        candidate: 'Trove: The Vagabond, 3 May 1883',
        resolvedAt: '2026-07-01',
      });
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
