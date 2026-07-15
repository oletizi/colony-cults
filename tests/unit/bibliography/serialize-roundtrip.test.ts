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

/**
 * `centrality` (corpus-central vs corpus-adjacent) must round-trip through
 * load -> serialize, and an unrecognized value must fail loud at load rather
 * than being silently accepted.
 */
describe('Source.centrality load/serialize', () => {
  const adjacent: Source = {
    sourceId: 'PB-P901',
    kind: 'archival-item',
    partOf: 'PB-P006',
    status: 'approved-for-acquisition',
    case: 'port-breton',
    centrality: 'adjacent',
    titles: [{ text: 'New Italy settlement photograph', role: 'archive' }],
    identifiers: [],
  };

  it('round-trips centrality: adjacent through load -> serialize', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssot-centrality-'));
    try {
      const path = join(dir, 'PB-P901.yml');
      const first = serializeSource({ source: adjacent, records: [] });
      expect(first).toContain('centrality: adjacent');
      writeFileSync(path, first, 'utf-8');

      const reloaded = loadSourceFile(path).source;
      expect(reloaded.centrality).toBe('adjacent');
      // Idempotent re-serialize.
      expect(serializeSource({ source: reloaded, records: [] })).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an absent centrality loads as undefined (a central corpus work)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssot-centrality-'));
    try {
      const path = join(dir, 'PB-P902.yml');
      const { centrality: _omitted, ...central } = adjacent;
      writeFileSync(path, serializeSource({ source: { ...central, sourceId: 'PB-P902' }, records: [] }), 'utf-8');
      expect(loadSourceFile(path).source.centrality).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loud on a centrality value outside the closed vocabulary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssot-centrality-'));
    try {
      const path = join(dir, 'PB-P903.yml');
      writeFileSync(
        path,
        'sourceId: PB-P903\nkind: archival-item\ncentrality: peripheral\ntitles:\n  - text: x\n    role: archive\n',
        'utf-8',
      );
      expect(() => loadSourceFile(path)).toThrow(/centrality "peripheral" is not in the closed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
