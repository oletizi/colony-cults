import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Widen an {@link AuthoredRepositoryRecord} (the SSOT-authored, per-source
 * shape) into the full {@link RepositoryRecord} shape consumed by
 * `@/sourcegroup/record-select`, `@/sourcegroup/verify-member`, and (its base
 * fields) `@/bibliography/derive`, by attaching the owning `sourceId` -- the
 * SSOT's one-file-per-source layout implies it rather than repeating it on
 * every record (contracts/source-record.md). Every optional acquisition
 * field present on `authored` is carried across; a field absent on
 * `authored` stays absent on the result -- nothing is fabricated.
 *
 * `sourceArchive` is read off `authored` itself (part of the
 * `(sourceId, sourceArchive)` key) rather than taken as a separate
 * parameter, so the two can never be passed out of sync.
 *
 * Deliberately excludes `manifest` (the derived storage-location field) and
 * `issues` (the derived per-issue breakdown) -- both are caller-specific,
 * built from provenance/census data this function never sees
 * (`@/bibliography/derive`), not from the authored record.
 *
 * Pure function -- no I/O.
 */
export function authoredToRepositoryRecord(
  sourceId: string,
  authored: AuthoredRepositoryRecord,
): RepositoryRecord {
  const record: RepositoryRecord = {
    sourceId,
    sourceArchive: authored.sourceArchive,
    status: authored.status,
  };
  if (authored.catalogUrl !== undefined) {
    record.catalogUrl = authored.catalogUrl;
  }
  if (authored.originalUrl !== undefined) {
    record.originalUrl = authored.originalUrl;
  }
  if (authored.sourceUrl !== undefined) {
    record.sourceUrl = authored.sourceUrl;
  }
  if (authored.retrievedAt !== undefined) {
    record.retrievedAt = authored.retrievedAt;
  }
  if (authored.identifiers !== undefined) {
    record.identifiers = authored.identifiers;
  }
  if (authored.rights !== undefined) {
    record.rights = authored.rights;
  }
  if (authored.metadataSnapshot !== undefined) {
    record.metadataSnapshot = authored.metadataSnapshot;
  }
  if (authored.verification !== undefined) {
    record.verification = authored.verification;
  }
  return record;
}
