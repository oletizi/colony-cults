import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertInsideArchive } from '@/archive/location';

/**
 * The write-guard (FR-006) is the safety-critical, NON-OVERRIDABLE check that
 * no preservation asset is ever written outside the private archive. These
 * tests pin both directions: legit in-archive paths pass, escapes throw.
 */
describe('assertInsideArchive', () => {
  let archiveRoot: string;

  beforeAll(() => {
    archiveRoot = mkdtempSync(path.join(tmpdir(), 'cc-archive-'));
  });

  afterAll(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('passes for a legit path nested inside the archive root', () => {
    const target = path.join(
      archiveRoot,
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
    expect(() => assertInsideArchive(target, archiveRoot)).not.toThrow();
  });

  it('throws for a relative "../" escape that resolves outside the root', () => {
    const escaping = path.join(archiveRoot, '..', '..', 'etc', 'x');
    expect(() => assertInsideArchive(escaping, archiveRoot)).toThrow(
      /outside the private archive|no override/i,
    );
  });

  it('throws for an absolute path outside the archive root', () => {
    expect(() => assertInsideArchive('/etc/passwd', archiveRoot)).toThrow(
      /outside the private archive|no override/i,
    );
  });

  it('throws for the archive root itself (an asset must be strictly inside)', () => {
    expect(() => assertInsideArchive(archiveRoot, archiveRoot)).toThrow(
      /outside the private archive|no override/i,
    );
  });
});

/**
 * AUDIT-31: `..` MUST NOT BE COLLAPSED LEXICALLY BEFORE THE FILESYSTEM IS
 * CONSULTED.
 *
 * `realResolve` began with `path.resolve(target)`, which folds `a/link/../b`
 * to `a/b` PURELY TEXTUALLY -- before any `realpathSync`. When `link` is a
 * symlink pointing outside the archive, the real kernel resolution of
 * `a/link/../b` is `<link-target>/../b`, which is somewhere else entirely. So
 * the guard measured a path the OS would never produce, reported "inside", and
 * a subsequent write with the SAME string landed bytes outside the root.
 *
 * No production caller reaches this today -- every one builds its path with
 * `path.join` (which normalizes) and `validateSummaryRef` rejects `..` before
 * it even calls the guard -- so this is defense-in-depth in a check that is
 * deliberately non-bypassable, not a live escape. It is fixed by refusing a
 * `..` segment outright: the guard cannot decide safety for a path whose
 * meaning depends on symlinks it has not yet followed, so it declines to try.
 */
describe('assertInsideArchive vs symlink + ".." (AUDIT-31)', () => {
  let sandbox: string;
  let archiveRoot: string;
  let outside: string;

  beforeAll(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), 'cc-guard-symlink-'));
    archiveRoot = path.join(sandbox, 'archive-root');
    outside = path.join(sandbox, 'outside');
    mkdirSync(archiveRoot);
    mkdirSync(outside);
    // A symlink INSIDE the root that points OUT of it.
    symlinkSync(outside, path.join(archiveRoot, 'link'), 'dir');
  });

  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('throws for "<root>/link/../evil.txt", which really resolves outside the root', () => {
    // Lexically this is "<root>/evil.txt" (inside). Through the symlink the
    // kernel resolves it to "<sandbox>/evil.txt" (outside).
    const escaping = `${path.join(archiveRoot, 'link')}${path.sep}..${path.sep}evil.txt`;
    expect(() => assertInsideArchive(escaping, archiveRoot)).toThrow(
      /outside the private archive|parent-directory|no override/i,
    );
  });

  it('control: a symlinked path with NO ".." is still caught by the realpath check', () => {
    const throughLink = path.join(archiveRoot, 'link', 'ok.txt');
    expect(() => assertInsideArchive(throughLink, archiveRoot)).toThrow(
      /outside the private archive|no override/i,
    );
  });

  it('control: a plain "<root>/../evil2.txt" still throws', () => {
    const escaping = `${archiveRoot}${path.sep}..${path.sep}evil2.txt`;
    expect(() => assertInsideArchive(escaping, archiveRoot)).toThrow(
      /outside the private archive|parent-directory|no override/i,
    );
  });

  it('control: a normal nested path under the real root still passes', () => {
    const target = path.join(archiveRoot, 'archive', 'cases', 'x', 'books', 'y', 'f001.jpg');
    expect(() => assertInsideArchive(target, archiveRoot)).not.toThrow();
  });
});
