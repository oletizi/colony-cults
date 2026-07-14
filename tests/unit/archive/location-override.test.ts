import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveArchiveRoot } from '@/archive/location';

/**
 * resolveArchiveRoot (FR-014, TASK-19): the archive root comes from an EXPLICIT
 * source only -- never a silent shared default. Precedence:
 *   1. explicit override argument
 *   2. COLONY_ARCHIVE_ROOT env var
 *   3. neither set -> FAIL LOUD (no fallback to a shared sibling clone)
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

  it('fails loud (no shared-sibling fallback) when neither override nor env is set (TASK-19)', () => {
    expect(() => resolveArchiveRoot(repoRoot, undefined, {})).toThrow(
      /no archive root configured/,
    );
    // The refusal names both explicit ways to supply a root.
    expect(() => resolveArchiveRoot(repoRoot, undefined, {})).toThrow(
      /--archive-root|COLONY_ARCHIVE_ROOT/,
    );
    // An empty/whitespace override or env value is treated as "not set" -> also fails loud.
    expect(() =>
      resolveArchiveRoot(repoRoot, '   ', { COLONY_ARCHIVE_ROOT: '  ' }),
    ).toThrow(/no archive root configured/);
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
