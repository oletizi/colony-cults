/**
 * Fail-loud type guards that narrow parsed JSON into a {@link CorpusSnapshot}
 * WITHOUT `any`/`as`/`@ts-ignore`. Every field the build reads is checked; a
 * missing or wrong-typed field throws naming the offending path so a corrupt
 * committed snapshot fails the build loudly rather than rendering placeholder
 * data (mirrors the archive loader's fail-loud posture).
 */

import type {
  CorpusSnapshot,
  ProvenanceRecord,
  RawIssue,
  RawPage,
  RawSource,
  SkippedIssue,
} from '@/browser/model';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`snapshot: expected an object at ${where}, got ${describe(value)}.`);
  }
  return value;
}

function requireArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`snapshot: expected an array at ${where}, got ${describe(value)}.`);
  }
  return value;
}

function requireString(record: Record<string, unknown>, field: string, where: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new Error(
      `snapshot: expected string field "${field}" at ${where}, got ${describe(value)}.`
    );
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, field: string, where: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `snapshot: expected finite number field "${field}" at ${where}, got ${describe(value)}.`
    );
  }
  return value;
}

/** A field that is either a string or explicitly `null` (never absent). */
function requireStringOrNull(
  record: Record<string, unknown>,
  field: string,
  where: string
): string | null {
  const value = record[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(
      `snapshot: expected string|null field "${field}" at ${where}, got ${describe(value)}.`
    );
  }
  return value;
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function parseProvenance(value: unknown, where: string): ProvenanceRecord {
  const record = requireRecord(value, where);
  return {
    sourceId: requireString(record, 'sourceId', where),
    ark: requireString(record, 'ark', where),
    date: requireString(record, 'date', where),
    rights: requireString(record, 'rights', where),
    page: requireString(record, 'page', where),
    sha256: requireString(record, 'sha256', where),
  };
}

function parseRawPage(value: unknown, where: string): RawPage {
  const record = requireRecord(value, where);
  return {
    pageId: requireString(record, 'pageId', where),
    folioId: requireString(record, 'folioId', where),
    ark: requireString(record, 'ark', where),
    objectStoreKey: requireStringOrNull(record, 'objectStoreKey', where),
    ocrFrench: requireString(record, 'ocrFrench', where),
    correctedFrench: requireStringOrNull(record, 'correctedFrench', where),
    english: requireString(record, 'english', where),
    ocrCondition: requireStringOrNull(record, 'ocrCondition', where),
    provenance: parseProvenance(record.provenance, `${where}.provenance`),
  };
}

function parseRawIssue(value: unknown, where: string): RawIssue {
  const record = requireRecord(value, where);
  const pages = requireArray(record.pages, `${where}.pages`).map((page, i) =>
    parseRawPage(page, `${where}.pages[${i}]`)
  );
  return {
    issueId: requireString(record, 'issueId', where),
    date: requireString(record, 'date', where),
    sequence: requireNumber(record, 'sequence', where),
    pages,
  };
}

function parseRawSource(value: unknown, where: string): RawSource {
  const record = requireRecord(value, where);
  const kind = requireString(record, 'kind', where);
  if (kind !== 'periodical') {
    throw new Error(
      `snapshot: unsupported source kind ${JSON.stringify(kind)} at ${where} ` +
        '(only "periodical" is supported in v1).'
    );
  }
  const issues = requireArray(record.issues, `${where}.issues`).map((issue, i) =>
    parseRawIssue(issue, `${where}.issues[${i}]`)
  );
  return {
    sourceId: requireString(record, 'sourceId', where),
    title: requireString(record, 'title', where),
    kind: 'periodical',
    ark: requireString(record, 'ark', where),
    rights: requireString(record, 'rights', where),
    issues,
  };
}

function parseSkipped(value: unknown, where: string): SkippedIssue {
  const record = requireRecord(value, where);
  return {
    issueId: requireString(record, 'issueId', where),
    sourceId: requireString(record, 'sourceId', where),
    reason: requireString(record, 'reason', where),
  };
}

/**
 * Narrows a parsed-JSON value into a {@link CorpusSnapshot}, throwing (naming
 * the field path) on any structural or type defect. `label` names the file the
 * value came from, so a corrupt file is identifiable in the error.
 */
export function parseCorpusSnapshot(value: unknown, label: string): CorpusSnapshot {
  const root = requireRecord(value, label);
  const sources = requireArray(root.sources, `${label}.sources`).map((source, i) =>
    parseRawSource(source, `${label}.sources[${i}]`)
  );
  const skipped = requireArray(root.skipped, `${label}.skipped`).map((skip, i) =>
    parseSkipped(skip, `${label}.skipped[${i}]`)
  );
  return { sources, skipped };
}
