import { describe, it, expect } from 'vitest';
import { objectKeyForAsset } from '@/archive/object-key';

/**
 * objectKeyForAsset derives the B2 object key for an archived asset: the
 * POSIX-style path of targetPath relative to archiveRoot, with no leading
 * slash and stable "/" separators regardless of host OS.
 */
describe('objectKeyForAsset', () => {
  it('mirrors a nested page path into a "/"-separated key with no leading slash', () => {
    const archiveRoot = '/Users/x/colony-cults-archive';
    const targetPath =
      '/Users/x/colony-cults-archive/archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg';

    const key = objectKeyForAsset(archiveRoot, targetPath);

    expect(key).toBe(
      'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-07-15_bpt6k5603637g/f001.jpg',
    );
  });

  it('never returns a key with a leading slash', () => {
    const archiveRoot = '/Users/x/colony-cults-archive';
    const targetPath = '/Users/x/colony-cults-archive/archive/cases/foo/bar.txt';

    const key = objectKeyForAsset(archiveRoot, targetPath);

    expect(key.startsWith('/')).toBe(false);
  });

  it('throws when targetPath is not inside archiveRoot', () => {
    const archiveRoot = '/Users/x/colony-cults-archive';
    const targetPath = '/Users/x/somewhere-else/archive/cases/foo/bar.txt';

    expect(() => objectKeyForAsset(archiveRoot, targetPath)).toThrow(
      /outside|not inside/i,
    );
  });
});
