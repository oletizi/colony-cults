import { stringify } from 'yaml';

import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Source } from '@/model/source';

/**
 * One migrated Source together with its authored Repository Records, ready to
 * be serialized to `bibliography/sources/<sourceId>.yml`.
 */
export interface MigratedSource {
  source: Source;
  records: AuthoredRepositoryRecord[];
}

/**
 * Build one Repository Record's on-disk object in a FIXED key order (matching
 * the SSOT contract's field order), omitting absent optional fields entirely so
 * the output is deterministic and no field is fabricated.
 */
function orderedRecord(record: AuthoredRepositoryRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sourceArchive: record.sourceArchive,
    status: record.status,
  };
  if (record.catalogUrl !== undefined) {
    out.catalogUrl = record.catalogUrl;
  }
  if (record.originalUrl !== undefined) {
    out.originalUrl = record.originalUrl;
  }
  if (record.retrievedAt !== undefined) {
    out.retrievedAt = record.retrievedAt;
  }
  if (record.identifiers !== undefined && record.identifiers.length > 0) {
    out.identifiers = record.identifiers.map((id) => ({ type: id.type, value: id.value }));
  }
  if (record.rights !== undefined) {
    out.rights = record.rights;
  }
  if (record.census !== undefined) {
    out.census = record.census;
  }
  return out;
}

/** Compare records by their `sourceArchive` key for a stable on-disk order. */
function byArchive(a: AuthoredRepositoryRecord, b: AuthoredRepositoryRecord): number {
  if (a.sourceArchive < b.sourceArchive) {
    return -1;
  }
  return a.sourceArchive > b.sourceArchive ? 1 : 0;
}

/**
 * Deterministically serialize a {@link MigratedSource} to the SSOT YAML shape.
 * Keys are emitted in a fixed order and absent optional fields are omitted, so
 * re-serializing identical input yields byte-identical output (idempotency).
 * The result is loadable by `bibliography/load.ts` (contract source-record.md).
 */
export function serializeSource(migrated: MigratedSource): string {
  const source = migrated.source;
  const out: Record<string, unknown> = {
    sourceId: source.sourceId,
    kind: source.kind,
  };
  if (source.partOf !== undefined) {
    out.partOf = source.partOf;
  }
  if (source.case !== undefined) {
    out.case = source.case;
  }
  if (source.language !== undefined) {
    out.language = source.language;
  }
  if (source.creator !== undefined) {
    out.creator = source.creator;
  }
  out.titles = source.titles.map((title) =>
    title.language !== undefined
      ? { text: title.text, role: title.role, language: title.language }
      : { text: title.text, role: title.role },
  );
  if (source.identifiers.length > 0) {
    out.identifiers = source.identifiers.map((id) => ({ type: id.type, value: id.value }));
  }
  if (source.notes !== undefined) {
    out.notes = source.notes;
  }
  const records = [...migrated.records].sort(byArchive);
  if (records.length > 0) {
    out.repositoryRecords = records.map(orderedRecord);
  }
  return stringify(out, { lineWidth: 0 });
}
