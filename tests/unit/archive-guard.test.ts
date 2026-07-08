import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
