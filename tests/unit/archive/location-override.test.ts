import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveArchiveRoot } from '@/archive/location';

/**
 * resolveArchiveRoot (FR-014): dev/test must be able to target a dedicated
 * worktree instead of the fixed sibling clone. Precedence:
 *   1. explicit override argument
 *   2. COLONY_ARCHIVE_ROOT env var
 *   3. fixed sibling `../colony-cults-archive`
 */
describe('resolveArchiveRoot override precedence', () => {
  const repoRoot = '/Users/example/work/archive-object-store';

  it('uses the explicit override argument when provided, even if the env var is also set', () => {
    const env: NodeJS.ProcessEnv = {
      COLONY_ARCHIVE_ROOT: '/Users/example/work/env-archive',
    };

    const result = resolveArchiveRoot(
      repoRoot,
      '/Users/example/work/override-archive',
      env,
    );

    expect(result).toBe(path.resolve('/Users/example/work/override-archive'));
  });

  it('falls back to COLONY_ARCHIVE_ROOT when no override is given', () => {
    const env: NodeJS.ProcessEnv = {
      COLONY_ARCHIVE_ROOT: '/Users/example/work/env-archive',
    };

    const result = resolveArchiveRoot(repoRoot, undefined, env);

    expect(result).toBe(path.resolve('/Users/example/work/env-archive'));
  });

  it('falls back to the fixed sibling ../colony-cults-archive when neither override nor env is set', () => {
    const result = resolveArchiveRoot(repoRoot, undefined, {});

    expect(result).toBe(path.resolve(repoRoot, '..', 'colony-cults-archive'));
  });

  it('still throws on an empty repoRoot regardless of override/env', () => {
    expect(() => resolveArchiveRoot('', undefined, {})).toThrow(
      /repoRoot is required/,
    );
    expect(() =>
      resolveArchiveRoot('   ', '/Users/example/work/override-archive', {
        COLONY_ARCHIVE_ROOT: '/Users/example/work/env-archive',
      }),
    ).toThrow(/repoRoot is required/);
  });
});
