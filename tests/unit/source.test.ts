import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverIssueArks } from '@/translate/source';

/**
 * Lays out a temp archive root the way `findIssueDir`/`sourceLayout` expect
 * for source `PB-P001` (case: port-breton, type: newspapers, slug:
 * la-nouvelle-france -- see `src/archive/location.ts`):
 *   <archiveRoot>/archive/cases/port-breton/newspapers/la-nouvelle-france/
 */
function sourceDirFor(archiveRoot: string): string {
  return path.join(
    archiveRoot,
    'archive',
    'cases',
    'port-breton',
    'newspapers',
    'la-nouvelle-france',
  );
}

describe('discoverIssueArks (T022, on-disk archived-issue discovery)', () => {
  let archiveRoot: string;

  beforeEach(async () => {
    archiveRoot = await mkdtemp(path.join(tmpdir(), 'source-translation-discover-'));
  });

  afterEach(async () => {
    await rm(archiveRoot, { recursive: true, force: true });
  });

  it('returns the bare arks of a source\'s fetched issue dirs, sorted by dir name', async () => {
    const sourceDir = sourceDirFor(archiveRoot);
    // Created out of chronological order to prove the result is sorted, not
    // insertion-ordered.
    await mkdir(path.join(sourceDir, '1879-07-15_bpt6k5603638h'), {
      recursive: true,
    });
    await mkdir(path.join(sourceDir, '1879-05-15_bpt6k5603636f'), {
      recursive: true,
    });
    await mkdir(path.join(sourceDir, '1879-06-15_bpt6k5603637g'), {
      recursive: true,
    });

    const arks = discoverIssueArks('PB-P001', archiveRoot);

    expect(arks).toEqual([
      'bpt6k5603636f',
      'bpt6k5603637g',
      'bpt6k5603638h',
    ]);
  });

  it('ignores non-directory entries and dirs with no valid _<ark> suffix', async () => {
    const sourceDir = sourceDirFor(archiveRoot);
    await mkdir(path.join(sourceDir, '1879-06-15_bpt6k5603637g'), {
      recursive: true,
    });
    // A stray file alongside the issue dirs (e.g. a source-level note).
    await writeFile(path.join(sourceDir, 'README.txt'), 'not an issue');
    // A directory with no underscore at all.
    await mkdir(path.join(sourceDir, 'stray-dir'), { recursive: true });
    // A directory whose suffix after the last underscore is not a valid bare
    // ark (contains a "." -- not alphanumeric).
    await mkdir(path.join(sourceDir, 'notes_v1.0'), { recursive: true });

    const arks = discoverIssueArks('PB-P001', archiveRoot);

    expect(arks).toEqual(['bpt6k5603637g']);
  });

  it('THROWS for an unregistered source id', () => {
    expect(() => discoverIssueArks('NOT-REGISTERED', archiveRoot)).toThrow(
      /no archive layout registered/i,
    );
  });

  it('THROWS when the source dir is absent (registered source, nothing fetched)', () => {
    // archiveRoot exists but nothing has ever been fetched for PB-P001.
    expect(() => discoverIssueArks('PB-P001', archiveRoot)).toThrow(
      /no fetched issues found/i,
    );
  });
});
