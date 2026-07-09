import path from 'node:path';

/**
 * Derive the object-store key for a preservation asset: the path of
 * targetPath relative to archiveRoot, expressed with "/" separators and no
 * leading slash, stable across host OSes (Windows path.sep is normalized to
 * "/" the same as POSIX hosts).
 *
 * Throws if targetPath does not resolve to a location strictly inside
 * archiveRoot (i.e. the relative path starts with "..", or targetPath equals
 * archiveRoot itself).
 */
export function objectKeyForAsset(archiveRoot: string, targetPath: string): string {
  const relative = path.relative(archiveRoot, targetPath);

  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(
      `objectKeyForAsset: targetPath "${targetPath}" is outside archiveRoot "${archiveRoot}"`,
    );
  }

  return relative.split(path.sep).join('/');
}
