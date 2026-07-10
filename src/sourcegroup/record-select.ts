import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Select one {@link RepositoryRecord} for a member by `--archive
 * <sourceArchive>`, reusing the shipped `(sourceId, sourceArchive)` key
 * (spec FR-009a; research D-05).
 *
 * - Zero records: fails loud (nothing to select).
 * - Exactly one record: inferred regardless of `archive`.
 * - More than one record: `archive` is required and must match exactly one
 *   record's `sourceArchive`; ambiguity (missing/non-matching selector)
 *   fails loud, naming the available archives.
 *
 * Pure function -- no I/O.
 */
export function selectRepositoryRecord(
  records: readonly RepositoryRecord[],
  archive?: string,
): RepositoryRecord {
  if (records.length === 0) {
    throw new Error(
      'No RepositoryRecord found for this member -- nothing to select.',
    );
  }

  if (records.length === 1) {
    return records[0];
  }

  const availableArchives = records.map((r) => r.sourceArchive).join(', ');

  if (archive === undefined) {
    throw new Error(
      `Ambiguous copy: this member has ${records.length} RepositoryRecords. ` +
        `Pass --archive <sourceArchive> to select one. ` +
        `Available archives: ${availableArchives}.`,
    );
  }

  const matches = records.filter((r) => r.sourceArchive === archive);

  if (matches.length === 0) {
    throw new Error(
      `No RepositoryRecord found for --archive "${archive}". ` +
        `Available archives: ${availableArchives}.`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous copy: ${matches.length} RepositoryRecords match --archive "${archive}". ` +
        `Available archives: ${availableArchives}.`,
    );
  }

  return matches[0];
}
