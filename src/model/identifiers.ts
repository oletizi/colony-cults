/**
 * Identifier taxonomy shared by {@link Source} (work-level) and
 * `RepositoryRecord` (copy-level).
 *
 * See specs/004-canonical-source-metadata/data-model.md.
 */

/** Identifies a *work*, independent of any particular held copy. */
export type WorkLevelIdentifierType = 'isbn' | 'issn' | 'oclc';

/** Identifies a specific *held copy* of a work at an archive. */
export type CopyLevelIdentifierType = 'ark' | 'iiif-manifest' | 'scan-doi';

const WORK_LEVEL_TYPES: readonly WorkLevelIdentifierType[] = [
  'isbn',
  'issn',
  'oclc',
];

const COPY_LEVEL_TYPES: readonly CopyLevelIdentifierType[] = [
  'ark',
  'iiif-manifest',
  'scan-doi',
];

/** Membership over a readonly string list (widens the tuple without a cast). */
function includesType(types: readonly string[], type: string): boolean {
  return types.includes(type);
}

/**
 * Classify an identifier type as `'work'` or `'copy'`. Throws for any type
 * outside the closed work/copy vocabularies -- an unknown identifier type
 * must be surfaced, never silently accepted.
 */
export function classifyIdentifier(type: string): 'work' | 'copy' {
  if (includesType(WORK_LEVEL_TYPES, type)) {
    return 'work';
  }
  if (includesType(COPY_LEVEL_TYPES, type)) {
    return 'copy';
  }
  throw new Error(
    `classifyIdentifier: unknown identifier type "${type}" (expected one of ` +
      `${[...WORK_LEVEL_TYPES, ...COPY_LEVEL_TYPES].join(', ')})`,
  );
}
