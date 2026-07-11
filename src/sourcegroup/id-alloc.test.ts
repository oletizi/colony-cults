import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allocateMemberId } from '@/sourcegroup/id-alloc';

/**
 * Create a temp sources dir seeded with the given source-id basenames
 * (each written as an empty `.yml`), returning the dir path.
 */
async function seedSourcesDir(ids: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'id-alloc-'));
  await mkdir(dir, { recursive: true });
  for (const id of ids) {
    await writeFile(join(dir, `${id}.yml`), '', 'utf8');
  }
  return dir;
}

describe('allocateMemberId', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('allocates the next-free PB-P### after the existing max', async () => {
    dir = await seedSourcesDir([
      'PB-P001',
      'PB-P002',
      'PB-P003',
      'PB-P004',
      'PB-P005',
      'PB-P006',
      'PB-S001',
      'PB-S002',
    ]);

    const id = await allocateMemberId(dir, `sourceId: PLACEHOLDER\n`);

    expect(id).toBe('PB-P007');
  });

  it('zero-pads to three digits', async () => {
    dir = await seedSourcesDir(['PB-P001']);
    const id = await allocateMemberId(dir, '');
    expect(id).toBe('PB-P002');
    expect(id).toMatch(/^PB-P\d{3}$/);
  });

  it('allocates PB-P001 in an empty (member-free) namespace', async () => {
    dir = await seedSourcesDir(['PB-S001', 'PB-S002']);
    const id = await allocateMemberId(dir, '');
    expect(id).toBe('PB-P001');
  });

  it('writes the target file as the atomic claim, using a content callback', async () => {
    dir = await seedSourcesDir(['PB-P006']);
    const id = await allocateMemberId(dir, (allocated) => `sourceId: ${allocated}\n`);
    expect(id).toBe('PB-P007');

    const written = await readFile(join(dir, 'PB-P007.yml'), 'utf8');
    expect(written).toBe('sourceId: PB-P007\n');
  });

  it('ignores unrelated namespaces when computing the max', async () => {
    dir = await seedSourcesDir(['PB-P002', 'PB-S099', 'PB-X050']);
    const id = await allocateMemberId(dir, '');
    expect(id).toBe('PB-P003');
  });

  it('does NOT reuse an id whose file already exists (skips over occupied slots)', async () => {
    // Max is PB-P003 but PB-P002 is present too — next free is PB-P004,
    // and re-allocating must never collide with an occupied slot.
    dir = await seedSourcesDir(['PB-P001', 'PB-P002', 'PB-P003']);
    const first = await allocateMemberId(dir, '');
    expect(first).toBe('PB-P004');
    const second = await allocateMemberId(dir, '');
    expect(second).toBe('PB-P005');
  });

  it('CONCURRENCY: parallel allocations never return the same id and never share a file', async () => {
    dir = await seedSourcesDir(['PB-P006']);

    const N = 40;
    const allocations = Array.from({ length: N }, () =>
      allocateMemberId(dir, (allocated) => `sourceId: ${allocated}\n`),
    );

    const ids = await Promise.all(allocations);

    // Every allocation returned a distinct id.
    const unique = new Set(ids);
    expect(unique.size).toBe(N);

    // Each returned id is a well-formed member id and its file exists exactly once,
    // containing the id it claims.
    for (const id of ids) {
      expect(id).toMatch(/^PB-P\d{3}$/);
      const body = await readFile(join(dir, `${id}.yml`), 'utf8');
      expect(body).toBe(`sourceId: ${id}\n`);
    }

    // The on-disk set matches the allocated set (plus the seed), with no duplicates.
    const files = (await readdir(dir))
      .filter((f) => f.endsWith('.yml'))
      .map((f) => f.replace(/\.yml$/, ''));
    // seed (PB-P006) + N freshly allocated member files.
    expect(files.length).toBe(N + 1);
    for (const id of ids) {
      expect(files).toContain(id);
    }
  });

  it('fails loud when retries are exhausted', async () => {
    dir = await seedSourcesDir(['PB-P001']);
    // A content function that races: it pre-creates the very file the allocator
    // is about to claim, forcing EEXIST on every attempt until the bound is hit.
    await expect(
      allocateMemberId(
        dir,
        async (allocated: string) => {
          // Occupy the slot the allocator just picked, before it can create it.
          await writeFile(join(dir, `${allocated}.yml`), 'stolen', 'utf8').catch(() => undefined);
          return 'unused';
        },
        3,
      ),
    ).rejects.toThrow(/exhaust|retr/i);
  });
});
