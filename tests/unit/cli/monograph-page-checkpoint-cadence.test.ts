import { describe, it, expect } from 'vitest';
import {
  buildMonographPageCheckpointHook,
  type CommitCheckpointFn,
} from '@/cli/fetch-shared';
import type { IssueCheckpoint, PageStored } from '@/cli/archive-checkpoint';

/**
 * Unit-tests the page-cadence logic in isolation from real git: a fake
 * `CommitCheckpointFn` records every call `buildMonographPageCheckpointHook`'s
 * returned hook makes, so the N-page cadence (and the running written/skipped
 * counters reset between checkpoints) can be asserted without touching a real
 * repository. The real adapter's own behavior (staging, no-op re-runs,
 * message shape) is already covered by `tests/unit/cli/archive-checkpoint.test.ts`.
 */

const ARCHIVE_ROOT = '/archive-root';
const SOURCE_ID = 'PB-P002';
const ARK = 'bpt6kFAKE00001';
const DIR = '/archive-root/archive/cases/port-breton/books/some-monograph';
const PAGE_COUNT = 5;

function page(pageNumber: number, skipped = false): PageStored {
  return {
    sourceId: SOURCE_ID,
    ark: ARK,
    dir: DIR,
    page: pageNumber,
    pageCount: PAGE_COUNT,
    skipped,
  };
}

function fakeCommit(): {
  commit: CommitCheckpointFn;
  calls: Array<{ archiveRoot: string; checkpoint: IssueCheckpoint; push: boolean }>;
} {
  const calls: Array<{ archiveRoot: string; checkpoint: IssueCheckpoint; push: boolean }> = [];
  const commit: CommitCheckpointFn = async (archiveRoot, checkpoint, opts) => {
    calls.push({ archiveRoot, checkpoint, push: opts.push });
  };
  return { commit, calls };
}

describe('buildMonographPageCheckpointHook', () => {
  it('with N=2 over 5 pages, commits at pages 2 and 4 only (2 calls)', async () => {
    const { commit, calls } = fakeCommit();
    const hook = buildMonographPageCheckpointHook(ARCHIVE_ROOT, 2, commit);

    for (let p = 1; p <= PAGE_COUNT; p += 1) {
      await hook(page(p));
    }

    expect(calls).toHaveLength(2);
    expect(calls[0].checkpoint.page).toBe(2);
    expect(calls[1].checkpoint.page).toBe(4);
    expect(calls.every((c) => c.archiveRoot === ARCHIVE_ROOT && c.push === true)).toBe(
      true,
    );
  });

  it('with N=1, commits on every page (5 calls)', async () => {
    const { commit, calls } = fakeCommit();
    const hook = buildMonographPageCheckpointHook(ARCHIVE_ROOT, 1, commit);

    for (let p = 1; p <= PAGE_COUNT; p += 1) {
      await hook(page(p));
    }

    expect(calls).toHaveLength(PAGE_COUNT);
    expect(calls.map((c) => c.checkpoint.page)).toEqual([1, 2, 3, 4, 5]);
  });

  it('resets written/skipped counters between checkpoints', async () => {
    const { commit, calls } = fakeCommit();
    const hook = buildMonographPageCheckpointHook(ARCHIVE_ROOT, 2, commit);

    // Pages 1-2: both written -> checkpoint written=2, skipped=0.
    await hook(page(1, false));
    await hook(page(2, false));
    // Pages 3-4: one written, one skipped -> checkpoint written=1, skipped=1.
    await hook(page(3, false));
    await hook(page(4, true));

    expect(calls).toHaveLength(2);
    expect(calls[0].checkpoint).toMatchObject({
      sourceId: SOURCE_ID,
      ark: ARK,
      dir: DIR,
      pageCount: PAGE_COUNT,
      written: 2,
      skipped: 0,
      page: 2,
    });
    expect(calls[1].checkpoint).toMatchObject({
      written: 1,
      skipped: 1,
      page: 4,
    });
  });

  it('never commits when checkpointEvery is larger than the pages seen', async () => {
    const { commit, calls } = fakeCommit();
    const hook = buildMonographPageCheckpointHook(ARCHIVE_ROOT, 10, commit);

    for (let p = 1; p <= PAGE_COUNT; p += 1) {
      await hook(page(p));
    }

    expect(calls).toHaveLength(0);
  });

  it('throws a descriptive error for a non-positive checkpointEvery', () => {
    const { commit } = fakeCommit();
    expect(() => buildMonographPageCheckpointHook(ARCHIVE_ROOT, 0, commit)).toThrow(
      /checkpointEvery must be a positive integer/,
    );
    expect(() => buildMonographPageCheckpointHook(ARCHIVE_ROOT, -1, commit)).toThrow(
      /checkpointEvery must be a positive integer/,
    );
  });

  it('throws a descriptive error for a non-integer checkpointEvery', () => {
    const { commit } = fakeCommit();
    expect(() => buildMonographPageCheckpointHook(ARCHIVE_ROOT, 1.5, commit)).toThrow(
      /checkpointEvery must be a positive integer/,
    );
  });
});
