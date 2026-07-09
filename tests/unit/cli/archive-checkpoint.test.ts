import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  commitAndPushIssueCheckpoint,
  type IssueCheckpoint,
} from '@/cli/archive-checkpoint';

/**
 * Exercises the ONLY module that invokes real `git` (`src/cli/archive-checkpoint.ts`)
 * against real temp git repos -- fine for test code (see the design doc). No
 * network; the "remote" is a local bare repo.
 */

const ISSUE_SUBDIR = path.join(
  'archive',
  'cases',
  'test-case',
  'newspapers',
  'test-slug',
  '1879-07-15_bpt6k123',
);

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function currentBranch(cwd: string): string {
  return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

function headSha(cwd: string): string {
  return git(cwd, ['rev-parse', 'HEAD']).trim();
}

function commitCount(cwd: string): number {
  return Number(git(cwd, ['rev-list', '--count', 'HEAD']).trim());
}

function bareRefSha(bareDir: string, branch: string): string {
  return execFileSync('git', ['--git-dir', bareDir, 'rev-parse', branch], {
    encoding: 'utf-8',
  }).trim();
}

/** Write (or add to) the issue's `.yml` sidecars + integrity manifest. */
function writeIssueFiles(archiveRoot: string, suffix: string): void {
  const dir = path.join(archiveRoot, ISSUE_SUBDIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `f001-${suffix}.yml`), `id: "TEST-${suffix}"\n`);
  writeFileSync(path.join(dir, `f002-${suffix}.yml`), `id: "TEST-${suffix}"\n`);
  mkdirSync(path.join(archiveRoot, 'manifests'), { recursive: true });
  writeFileSync(
    path.join(archiveRoot, 'manifests', 'MANIFEST.sha256'),
    `${suffix}  ${path.join(ISSUE_SUBDIR, 'f001.jpg')}\n`,
  );
}

function baseCheckpoint(archiveRoot: string): IssueCheckpoint {
  return {
    sourceId: 'PB-P001',
    ark: 'bpt6k123',
    date: '1879-07-15',
    dir: path.join(archiveRoot, ISSUE_SUBDIR),
    pageCount: 2,
    written: 2,
    skipped: 0,
  };
}

describe('commitAndPushIssueCheckpoint', () => {
  let archiveRoot: string;

  beforeEach(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-checkpoint-'));
    git(archiveRoot, ['init']);
    git(archiveRoot, ['config', 'user.email', 'test@example.com']);
    git(archiveRoot, ['config', 'user.name', 'Checkpoint Test']);
    // Initial commit so HEAD exists before the checkpoint's own first commit.
    writeFileSync(path.join(archiveRoot, '.gitignore'), '*.jpg\n');
    git(archiveRoot, ['add', '.gitignore']);
    git(archiveRoot, ['commit', '-m', 'initial']);
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('commits the issue .yml sidecars + manifest with a matching message', async () => {
    writeIssueFiles(archiveRoot, 'a');
    const before = commitCount(archiveRoot);

    await commitAndPushIssueCheckpoint(archiveRoot, baseCheckpoint(archiveRoot), {
      push: false,
    });

    expect(commitCount(archiveRoot)).toBe(before + 1);

    const message = git(archiveRoot, ['log', '-1', '--pretty=%s']).trim();
    expect(message).toBe('archive(PB-P001): 1879-07-15 bpt6k123 — 2 new, 0 skipped');

    const filesInCommit = git(archiveRoot, [
      'show',
      '--name-only',
      '--pretty=format:',
      'HEAD',
    ])
      .trim()
      .split('\n')
      .filter((line) => line.length > 0);
    expect(filesInCommit).toContain(path.join(ISSUE_SUBDIR, 'f001-a.yml'));
    expect(filesInCommit).toContain(path.join(ISSUE_SUBDIR, 'f002-a.yml'));
    expect(filesInCommit).toContain(path.join('manifests', 'MANIFEST.sha256'));
  });

  it('is a clean no-op re-run when nothing changed (no empty commit)', async () => {
    writeIssueFiles(archiveRoot, 'a');
    await commitAndPushIssueCheckpoint(archiveRoot, baseCheckpoint(archiveRoot), {
      push: false,
    });
    const shaAfterFirst = headSha(archiveRoot);
    const countAfterFirst = commitCount(archiveRoot);

    await commitAndPushIssueCheckpoint(archiveRoot, baseCheckpoint(archiveRoot), {
      push: false,
    });

    expect(headSha(archiveRoot)).toBe(shaAfterFirst);
    expect(commitCount(archiveRoot)).toBe(countAfterFirst);
  });

  it('pushes and sets upstream on first push; a second push works plainly', async () => {
    const bareRemote = mkdtempSync(path.join(tmpdir(), 'cc-checkpoint-remote-'));
    git(bareRemote, ['init', '--bare']);
    git(archiveRoot, ['remote', 'add', 'origin', bareRemote]);

    try {
      writeIssueFiles(archiveRoot, 'a');
      await commitAndPushIssueCheckpoint(archiveRoot, baseCheckpoint(archiveRoot), {
        push: true,
      });

      const branch = currentBranch(archiveRoot);
      expect(
        git(archiveRoot, [
          'rev-parse',
          '--abbrev-ref',
          '--symbolic-full-name',
          '@{u}',
        ]).trim(),
      ).toBe(`origin/${branch}`);
      expect(bareRefSha(bareRemote, branch)).toBe(headSha(archiveRoot));

      // Second checkpoint: upstream already configured, so this must succeed
      // via a plain `git push` (no `-u`).
      writeIssueFiles(archiveRoot, 'b');
      await commitAndPushIssueCheckpoint(archiveRoot, baseCheckpoint(archiveRoot), {
        push: true,
      });
      expect(bareRefSha(bareRemote, branch)).toBe(headSha(archiveRoot));
    } finally {
      rmSync(bareRemote, { recursive: true, force: true });
    }
  });

  it('commits a dateless (monograph) checkpoint with the dateless message shape', async () => {
    writeIssueFiles(archiveRoot, 'a');
    const before = commitCount(archiveRoot);

    const checkpoint: IssueCheckpoint = {
      sourceId: 'PB-P002',
      ark: 'bpt6kFAKE00001',
      dir: path.join(archiveRoot, ISSUE_SUBDIR),
      pageCount: 2,
      written: 2,
      skipped: 0,
    };

    await commitAndPushIssueCheckpoint(archiveRoot, checkpoint, { push: false });

    expect(commitCount(archiveRoot)).toBe(before + 1);

    const message = git(archiveRoot, ['log', '-1', '--pretty=%s']).trim();
    expect(message).toBe('archive(PB-P002): bpt6kFAKE00001 — 2 new, 0 skipped');
  });

  it('throws a descriptive error when the issue dir is outside archiveRoot', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'cc-checkpoint-outside-'));
    try {
      const checkpoint: IssueCheckpoint = {
        ...baseCheckpoint(archiveRoot),
        dir: outside,
      };
      await expect(
        commitAndPushIssueCheckpoint(archiveRoot, checkpoint, { push: false }),
      ).rejects.toThrow(/not inside archive root/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
