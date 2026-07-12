import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { serializeSource } from '@/bibliography/migrate-serialize';
import type { MigratedSource } from '@/bibliography/migrate-serialize';
import type { Source } from '@/model/source';

/**
 * Unit tests for T007: `serializeSource` emitting the NEW `Source.rights` and
 * `Source.publications[]` fields (specs/008-edition-publishing) in the fixed
 * on-disk key order from contracts/ssot-publications.md, omitting absent
 * optionals so re-serialize is byte-identical (idempotency).
 *
 * A full round-trip through `loadSourceFile` is NOT exercised here: the
 * loader's sibling task (T006) has not yet added `rights`/`publications` to
 * `SOURCE_KEYS`, so `loadSourceFile` currently rejects both keys as unknown.
 * These tests instead assert the serialized YAML's shape and key order
 * directly, plus idempotency of `serializeSource` itself.
 */

function baseSource(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P001',
    kind: 'periodical',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

describe('serializeSource: rights + publications (T007)', () => {
  it('emits rights with keys in order status, basis, determinedAt', () => {
    const migrated: MigratedSource = {
      source: baseSource({
        rights: {
          status: 'public-domain',
          basis: '1881 imprint; French public domain',
          determinedAt: '2026-07-12',
        },
      }),
      records: [],
    };

    const yaml = serializeSource(migrated);
    const parsed = parseYaml(yaml) as Record<string, unknown>;

    expect(parsed.rights).toEqual({
      status: 'public-domain',
      basis: '1881 imprint; French public domain',
      determinedAt: '2026-07-12',
    });
    expect(Object.keys(parsed.rights as object)).toEqual(['status', 'basis', 'determinedAt']);
  });

  it('omits rights.determinedAt when absent', () => {
    const migrated: MigratedSource = {
      source: baseSource({
        rights: { status: 'public-domain', basis: 'pre-1900 French imprint' },
      }),
      records: [],
    };

    const yaml = serializeSource(migrated);
    const parsed = parseYaml(yaml) as Record<string, unknown>;

    expect(parsed.rights).toEqual({ status: 'public-domain', basis: 'pre-1900 French imprint' });
    expect(Object.keys(parsed.rights as object)).toEqual(['status', 'basis']);
  });

  it('omits rights entirely when absent', () => {
    const migrated: MigratedSource = { source: baseSource(), records: [] };

    const yaml = serializeSource(migrated);
    const parsed = parseYaml(yaml) as Record<string, unknown>;

    expect(parsed.rights).toBeUndefined();
    expect(yaml).not.toContain('rights:');
  });

  it('emits a publications[] entry with keys in fixed order, including machineAssist', () => {
    const migrated: MigratedSource = {
      source: baseSource({
        publications: [
          {
            variant: 'english-only',
            publishedAt: '2026-07-12',
            snapshot: '3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10',
            snapshotShort: '3b8b1fd6',
            cdnBase: 'https://colony-cults-cdn.oletizi.workers.dev',
            keyScheme: 'versioned',
            rightsBasis: '1881 imprint; French public domain',
            machineAssist: { engine: 'claude', model: null, retrieved: '2026-07-12' },
            manifest: {
              manifestPath: 'bibliography/publications/PB-P001-english-only-3b8b1fd6.yml',
              issueCount: 71,
            },
          },
        ],
      }),
      records: [],
    };

    const yaml = serializeSource(migrated);
    const parsed = parseYaml(yaml) as { publications: Array<Record<string, unknown>> };

    expect(parsed.publications).toHaveLength(1);
    const entry = parsed.publications[0];
    expect(Object.keys(entry)).toEqual([
      'variant',
      'publishedAt',
      'snapshot',
      'snapshotShort',
      'cdnBase',
      'keyScheme',
      'rightsBasis',
      'machineAssist',
      'manifest',
    ]);
    expect(entry).toEqual({
      variant: 'english-only',
      publishedAt: '2026-07-12',
      snapshot: '3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10',
      snapshotShort: '3b8b1fd6',
      cdnBase: 'https://colony-cults-cdn.oletizi.workers.dev',
      keyScheme: 'versioned',
      rightsBasis: '1881 imprint; French public domain',
      machineAssist: { engine: 'claude', model: null, retrieved: '2026-07-12' },
      manifest: {
        manifestPath: 'bibliography/publications/PB-P001-english-only-3b8b1fd6.yml',
        issueCount: 71,
      },
    });
  });

  it('omits machineAssist when absent from a publications[] entry', () => {
    const migrated: MigratedSource = {
      source: baseSource({
        publications: [
          {
            variant: 'english-only',
            publishedAt: '2026-07-12',
            snapshot: '3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10',
            snapshotShort: '3b8b1fd6',
            cdnBase: 'https://colony-cults-cdn.oletizi.workers.dev',
            keyScheme: 'legacy-flat',
            rightsBasis: '1881 imprint; French public domain',
            manifest: {
              manifestPath: 'bibliography/publications/PB-P001-english-only-legacy.yml',
              issueCount: 72,
            },
          },
        ],
      }),
      records: [],
    };

    const yaml = serializeSource(migrated);
    const parsed = parseYaml(yaml) as { publications: Array<Record<string, unknown>> };

    expect(Object.keys(parsed.publications[0])).toEqual([
      'variant',
      'publishedAt',
      'snapshot',
      'snapshotShort',
      'cdnBase',
      'keyScheme',
      'rightsBasis',
      'manifest',
    ]);
  });

  it('omits publications entirely when absent or empty', () => {
    const migratedAbsent: MigratedSource = { source: baseSource(), records: [] };
    const migratedEmpty: MigratedSource = {
      source: baseSource({ publications: [] }),
      records: [],
    };

    expect(serializeSource(migratedAbsent)).not.toContain('publications:');
    expect(serializeSource(migratedEmpty)).not.toContain('publications:');
  });

  it('sorts publications[] deterministically by snapshotShort then variant', () => {
    const migrated: MigratedSource = {
      source: baseSource({
        publications: [
          {
            variant: 'parallel',
            publishedAt: '2026-07-12',
            snapshot: 'bbbbbbbb1234567890',
            snapshotShort: 'bbbbbbbb',
            cdnBase: 'https://cdn.example.org',
            keyScheme: 'versioned',
            rightsBasis: 'basis',
            manifest: { manifestPath: 'a.yml', issueCount: 1 },
          },
          {
            variant: 'english-only',
            publishedAt: '2026-07-12',
            snapshot: 'aaaaaaaa1234567890',
            snapshotShort: 'aaaaaaaa',
            cdnBase: 'https://cdn.example.org',
            keyScheme: 'versioned',
            rightsBasis: 'basis',
            manifest: { manifestPath: 'b.yml', issueCount: 1 },
          },
          {
            variant: 'english-only',
            publishedAt: '2026-07-12',
            snapshot: 'aaaaaaaa1234567890',
            snapshotShort: 'aaaaaaaa',
            cdnBase: 'https://cdn.example.org',
            keyScheme: 'versioned',
            rightsBasis: 'basis',
            manifest: { manifestPath: 'c.yml', issueCount: 2 },
          },
        ],
      }),
      records: [],
    };

    const yaml = serializeSource(migrated);
    const parsed = parseYaml(yaml) as { publications: Array<{ snapshotShort: string; variant: string }> };

    expect(parsed.publications.map((p) => `${p.snapshotShort}/${p.variant}`)).toEqual([
      'aaaaaaaa/english-only',
      'aaaaaaaa/english-only',
      'bbbbbbbb/parallel',
    ]);
  });

  it('places rights and publications in a fixed top-level key order', () => {
    const migrated: MigratedSource = {
      source: baseSource({
        creator: 'Marquis de Rays',
        rights: { status: 'public-domain', basis: 'pre-1900 imprint' },
        notes: 'Some notes',
        publications: [
          {
            variant: 'english-only',
            publishedAt: '2026-07-12',
            snapshot: 'abcd1234',
            snapshotShort: 'abcd1234',
            cdnBase: 'https://cdn.example.org',
            keyScheme: 'versioned',
            rightsBasis: 'pre-1900 imprint',
            manifest: { manifestPath: 'p.yml', issueCount: 1 },
          },
        ],
      }),
      records: [],
    };

    const yaml = serializeSource(migrated);
    const parsed = parseYaml(yaml) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      'sourceId',
      'kind',
      'creator',
      'rights',
      'titles',
      'notes',
      'publications',
    ]);
  });

  it('is idempotent: serializing an identical MigratedSource twice is byte-identical', () => {
    const migrated: MigratedSource = {
      source: baseSource({
        rights: {
          status: 'public-domain',
          basis: '1881 imprint; French public domain',
          determinedAt: '2026-07-12',
        },
        publications: [
          {
            variant: 'english-only',
            publishedAt: '2026-07-12',
            snapshot: '3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10',
            snapshotShort: '3b8b1fd6',
            cdnBase: 'https://colony-cults-cdn.oletizi.workers.dev',
            keyScheme: 'versioned',
            rightsBasis: '1881 imprint; French public domain',
            machineAssist: { engine: 'claude', model: null, retrieved: '2026-07-12' },
            manifest: {
              manifestPath: 'bibliography/publications/PB-P001-english-only-3b8b1fd6.yml',
              issueCount: 71,
            },
          },
        ],
      }),
      records: [],
    };

    const first = serializeSource(migrated);
    const second = serializeSource(migrated);

    expect(second).toBe(first);
  });
});
