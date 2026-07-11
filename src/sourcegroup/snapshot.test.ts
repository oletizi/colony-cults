import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSnapshot, readSnapshot } from '@/sourcegroup/snapshot';
import type { MetadataSnapshotInput } from '@/sourcegroup/snapshot';

/**
 * Tests for the immutable metadata-snapshot store (T014, FR-004, D-07): a
 * raw repository response is preserved as a write-once snapshot referenced
 * (by a parallel task) from `RepositoryRecord.metadataSnapshot`. Re-inventory
 * must append a NEW snapshot -- it must never overwrite an existing one.
 */

function input(overrides: Partial<MetadataSnapshotInput> = {}): MetadataSnapshotInput {
  return {
    sourceId: 'PB-P007',
    ark: 'ark:/12148/bpt6k1234567',
    raw: '<record><title>Le Petit Journal</title></record>',
    retrievedAt: '2026-07-10T00:00:00.000Z',
    endpoint: 'https://gallica.bnf.fr/services/OAIRecord',
    normalizationVersion: 1,
    stamp: '20260710T000000Z',
    ...overrides,
  };
}

describe('writeSnapshot / readSnapshot', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a snapshot file under bibliography/ carrying the raw body + metadata', async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-'));

    const ref = await writeSnapshot(dir, input());

    expect(ref.path.split('/')).toEqual(
      expect.arrayContaining(['bibliography', 'repository-responses', 'PB-P007']),
    );
    expect(ref.path.startsWith('bibliography')).toBe(true);
    expect(ref.retrievedAt).toBe('2026-07-10T00:00:00.000Z');
    expect(ref.endpoint).toBe('https://gallica.bnf.fr/services/OAIRecord');
    expect(ref.normalizationVersion).toBe(1);

    const onDisk = await readFile(join(dir, ref.path), 'utf8');
    const parsed: unknown = JSON.parse(onDisk);
    expect(parsed).toMatchObject({
      raw: '<record><title>Le Petit Journal</title></record>',
      retrievedAt: '2026-07-10T00:00:00.000Z',
      endpoint: 'https://gallica.bnf.fr/services/OAIRecord',
      normalizationVersion: 1,
    });
  });

  it('WRITE-ONCE: refuses to write to an existing snapshot path and never overwrites it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-'));

    const first = await writeSnapshot(dir, input({ raw: 'original body' }));

    await expect(
      writeSnapshot(dir, input({ raw: 'a DIFFERENT body -- must not land' })),
    ).rejects.toThrow(/write-once|already exists/i);

    // The original snapshot on disk is untouched.
    const onDisk = await readFile(join(dir, first.path), 'utf8');
    const parsed: unknown = JSON.parse(onDisk);
    expect(parsed).toMatchObject({ raw: 'original body' });
  });

  it('RE-INVENTORY: a second snapshot for the same member/ark gets a NEW distinct path, leaving the original intact', async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-'));

    const first = await writeSnapshot(
      dir,
      input({ raw: 'first retrieval', stamp: '20260710T000000Z' }),
    );
    const second = await writeSnapshot(
      dir,
      input({ raw: 'second retrieval', stamp: '20260711T000000Z' }),
    );

    expect(second.path).not.toBe(first.path);

    const firstOnDisk = await readFile(join(dir, first.path), 'utf8');
    const secondOnDisk = await readFile(join(dir, second.path), 'utf8');
    expect(JSON.parse(firstOnDisk)).toMatchObject({ raw: 'first retrieval' });
    expect(JSON.parse(secondOnDisk)).toMatchObject({ raw: 'second retrieval' });
  });

  it('round-trips a written snapshot through the reader', async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-'));

    const ref = await writeSnapshot(dir, input());
    const record = await readSnapshot(dir, ref.path);

    expect(record).toEqual({
      raw: '<record><title>Le Petit Journal</title></record>',
      retrievedAt: '2026-07-10T00:00:00.000Z',
      endpoint: 'https://gallica.bnf.fr/services/OAIRecord',
      normalizationVersion: 1,
    });
  });

  it('the ark is slugified into a filesystem-safe filename component', async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-'));

    const ref = await writeSnapshot(dir, input({ ark: 'ark:/12148/bpt6k1234567' }));
    const fileName = ref.path.split('/').pop() ?? '';

    expect(fileName).not.toContain(':');
    expect(fileName).not.toContain('/');
    expect(fileName.endsWith('.json')).toBe(true);
  });

  it('readSnapshot fails loud on a missing snapshot file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-'));

    await expect(
      readSnapshot(dir, 'bibliography/repository-responses/PB-P999/missing.json'),
    ).rejects.toThrow(/readSnapshot/);
  });

  it('readSnapshot fails loud on a malformed snapshot file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'snapshot-'));
    const ref = await writeSnapshot(dir, input());
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, ref.path), '{ not valid json', 'utf8');

    await expect(readSnapshot(dir, ref.path)).rejects.toThrow(/readSnapshot/);
  });
});
