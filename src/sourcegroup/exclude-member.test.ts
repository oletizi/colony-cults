import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Source } from '@/model/source';
import { serializeSource } from '@/bibliography/migrate-serialize';
import { loadSourceFile } from '@/bibliography/load';
import { runExcludeMember } from '@/sourcegroup/exclude-member';

/**
 * Tests for `runExcludeMember` (T026/T027, FR-013): the terminal path for a
 * discovered candidate that will not be acquired -- `discovered -> excluded`,
 * reason recorded. Every test writes real SSOT-shaped fixtures to a temp
 * `bibliography/sources`-style directory and re-reads them via
 * `loadSourceFile` after the call, so the persisted-on-disk shape is verified,
 * not just the in-memory return value.
 */

function member(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P100',
    titles: [{ text: 'Le Petit Journal', role: 'canonical' }],
    kind: 'monograph',
    partOf: 'PB-G001',
    status: 'discovered',
    creator: 'Anonyme',
    identifiers: [],
    ...overrides,
  };
}

async function seedSourcesDir(sources: Source[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'exclude-member-'));
  for (const source of sources) {
    await writeFile(
      join(dir, `${source.sourceId}.yml`),
      serializeSource({ source, records: [] }),
      'utf-8',
    );
  }
  return dir;
}

describe('runExcludeMember', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('advances discovered -> excluded and records the reason in notes', async () => {
    dir = await seedSourcesDir([member()]);

    const result = await runExcludeMember({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      reason: 'Not relevant to the Port Breton corpus',
    });

    expect(result.status).toBe('excluded');
    expect(result.sourceId).toBe('PB-P100');

    const { source } = loadSourceFile(join(dir, 'PB-P100.yml'));
    expect(source.status).toBe('excluded');
    expect(source.notes).toContain('excluded: Not relevant to the Port Breton corpus');
  });

  it('appends the exclusion line to existing notes rather than clobbering them', async () => {
    dir = await seedSourcesDir([member({ notes: 'Pre-existing research note.' })]);

    await runExcludeMember({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      reason: 'Duplicate of PB-P050',
    });

    const { source } = loadSourceFile(join(dir, 'PB-P100.yml'));
    expect(source.notes).toContain('Pre-existing research note.');
    expect(source.notes).toContain('excluded: Duplicate of PB-P050');
  });

  it('persists the write -- a fresh load after the call reflects the change', async () => {
    dir = await seedSourcesDir([member()]);

    await runExcludeMember({
      sourcesDir: dir,
      sourceId: 'PB-P100',
      reason: 'Out of scope',
    });

    const reloaded = loadSourceFile(join(dir, 'PB-P100.yml'));
    expect(reloaded.source.status).toBe('excluded');
  });

  it('fails loud on an empty reason', async () => {
    dir = await seedSourcesDir([member()]);

    await expect(
      runExcludeMember({ sourcesDir: dir, sourceId: 'PB-P100', reason: '' }),
    ).rejects.toThrow(/reason/i);

    // No write occurred: status is unchanged.
    const { source } = loadSourceFile(join(dir, 'PB-P100.yml'));
    expect(source.status).toBe('discovered');
  });

  it('fails loud on a whitespace-only reason', async () => {
    dir = await seedSourcesDir([member()]);

    await expect(
      runExcludeMember({ sourcesDir: dir, sourceId: 'PB-P100', reason: '   ' }),
    ).rejects.toThrow(/reason/i);
  });

  it('fails loud when the member is not in discovered status', async () => {
    dir = await seedSourcesDir([member({ status: 'approved-for-acquisition' })]);

    await expect(
      runExcludeMember({ sourcesDir: dir, sourceId: 'PB-P100', reason: 'too late' }),
    ).rejects.toThrow(/discovered/i);

    const { source } = loadSourceFile(join(dir, 'PB-P100.yml'));
    expect(source.status).toBe('approved-for-acquisition');
  });

  it('fails loud when the member has no status at all', async () => {
    dir = await seedSourcesDir([member({ status: undefined })]);

    await expect(
      runExcludeMember({ sourcesDir: dir, sourceId: 'PB-P100', reason: 'n/a' }),
    ).rejects.toThrow(/discovered/i);
  });

  it('fails loud when the member does not exist', async () => {
    dir = await seedSourcesDir([]);

    await expect(
      runExcludeMember({ sourcesDir: dir, sourceId: 'PB-P999', reason: 'n/a' }),
    ).rejects.toThrow();
  });

  it('fails loud on malformed input (missing sourceId)', async () => {
    dir = await seedSourcesDir([member()]);
    const bad = { sourcesDir: dir, sourceId: 'PB-P100', reason: 'n/a' };
    Reflect.deleteProperty(bad, 'sourceId');

    await expect(runExcludeMember(bad)).rejects.toThrow(/sourceId/i);
  });
});
