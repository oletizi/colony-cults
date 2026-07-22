/**
 * Fail-loud type guards that narrow parsed JSON into a {@link CorpusSnapshot}
 * WITHOUT `any`/`as`/`@ts-ignore`. Every field the build reads is checked; a
 * missing or wrong-typed field throws naming the offending path so a corrupt
 * committed snapshot fails the build loudly rather than rendering placeholder
 * data (mirrors the archive loader's fail-loud posture).
 */

import type {
  CorpusSnapshot,
  LoadedSummary,
  MachineAssistLabel,
  ProvenanceRecord,
  RawIssue,
  RawPage,
  RawSource,
  SkippedIssue,
  SourceLanguage,
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

/**
 * Parses the OPTIONAL machine-assist label. Absent (`undefined`) or explicit
 * `null` -> `null` (no label). Present -> a well-typed {@link MachineAssistLabel}
 * (`engine` + `retrieved` required strings, `model` string|null), else throws.
 * This is additive: snapshots predating the extension simply lack the field.
 */
function parseMachineAssist(value: unknown, where: string): MachineAssistLabel | null {
  if (value === undefined || value === null) {
    return null;
  }
  const record = requireRecord(value, where);
  return {
    engine: requireString(record, 'engine', where),
    model: requireStringOrNull(record, 'model', where),
    retrieved: requireString(record, 'retrieved', where),
  };
}

/** A REQUIRED {@link MachineAssistLabel} (`engine`/`retrieved` strings, `model` string|null). */
function requireMachineAssistLabel(value: unknown, where: string): MachineAssistLabel {
  const record = requireRecord(value, where);
  return {
    engine: requireString(record, 'engine', where),
    model: requireStringOrNull(record, 'model', where),
    retrieved: requireString(record, 'retrieved', where),
  };
}

/**
 * Parses a unit's `conciseSummary` (US2, FR-006). Unlike {@link parseMachineAssist},
 * `label` is REQUIRED once a `LoadedSummary` is present -- there is no honest
 * partial state, so a present-but-incomplete `label` throws (mirrors
 * `loadIssueSummary`'s fail-loud-on-corrupt posture). Absence is handled by
 * the caller (the key is simply omitted for a snapshot predating this field).
 */
function parseLoadedSummary(value: unknown, where: string): LoadedSummary {
  const record = requireRecord(value, where);
  return {
    concise: requireString(record, 'concise', where),
    label: requireMachineAssistLabel(record.label, `${where}.label`),
  };
}

function parseProvenance(value: unknown, where: string): ProvenanceRecord {
  const record = requireRecord(value, where);
  const base: ProvenanceRecord = {
    sourceId: requireString(record, 'sourceId', where),
    ark: requireString(record, 'ark', where),
    date: requireString(record, 'date', where),
    rights: requireString(record, 'rights', where),
    page: requireString(record, 'page', where),
    sha256: requireString(record, 'sha256', where),
  };
  // Additive optional field: only attach the key when a real label is present,
  // so provenance without a label re-serializes/round-trips unchanged.
  const machineAssist = parseMachineAssist(record.machineAssist, `${where}.machineAssist`);
  return machineAssist === null ? base : { ...base, machineAssist };
}

/**
 * Parses the OPTIONAL clipping `strips` handles. `null` -> `null` (an explicit
 * "no strips"); an array -> a validated list of `{folioId, objectStoreKey}`
 * (each `objectStoreKey` a string|null). Absent is handled by the caller
 * (omitted, for back-compat with snapshots predating strips).
 */
function parseStrips(
  value: unknown,
  where: string
): { folioId: string; objectStoreKey: string | null }[] | null {
  if (value === null) {
    return null;
  }
  return requireArray(value, where).map((item, i) => {
    const record = requireRecord(item, `${where}[${i}]`);
    return {
      folioId: requireString(record, 'folioId', `${where}[${i}]`),
      objectStoreKey: requireStringOrNull(record, 'objectStoreKey', `${where}[${i}]`),
    };
  });
}

function parseRawPage(value: unknown, where: string): RawPage {
  const record = requireRecord(value, where);
  const base: RawPage = {
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
  // Additive optional field (the image-master sha256): only attach the key when
  // present, so snapshots predating the extension round-trip unchanged. Present
  // -> string|null (validated); absent -> omitted.
  const withSha =
    record.imageSha256 === undefined
      ? base
      : { ...base, imageSha256: requireStringOrNull(record, 'imageSha256', where) };
  // Additive optional field (a clipping's image strips): only attach the key
  // when present, so normal single-image pages (and older snapshots) round-trip
  // unchanged. Present -> array|null (validated); absent -> omitted.
  if (record.strips === undefined) {
    return withSha;
  }
  return { ...withSha, strips: parseStrips(record.strips, `${where}.strips`) };
}

function parseRawIssue(value: unknown, where: string): RawIssue {
  const record = requireRecord(value, where);
  const pages = requireArray(record.pages, `${where}.pages`).map((page, i) =>
    parseRawPage(page, `${where}.pages[${i}]`)
  );
  const base: RawIssue = {
    issueId: requireString(record, 'issueId', where),
    date: requireString(record, 'date', where),
    sequence: requireNumber(record, 'sequence', where),
    pages,
  };
  // Additive optional field (US2): only attach when present, so snapshots
  // predating the concise-summary extension round-trip unchanged.
  if (record.conciseSummary === undefined) {
    return base;
  }
  return {
    ...base,
    conciseSummary: parseLoadedSummary(record.conciseSummary, `${where}.conciseSummary`),
  };
}

/**
 * Parses the source `language` with back-compat: an ABSENT field defaults to
 * `'French'` (older committed snapshots predate the field and carry no
 * language). A PRESENT field must be exactly `'French'` or `'English'`, else
 * throws. Never fabricates otherwise.
 */
function parseSourceLanguage(value: unknown, where: string): SourceLanguage {
  if (value === undefined) {
    return 'French';
  }
  if (value === 'French' || value === 'English') {
    return value;
  }
  throw new Error(
    `snapshot: unsupported source language ${JSON.stringify(value)} at ${where}.language ` +
      '(expected "French" or "English").'
  );
}

function parseRawSource(value: unknown, where: string): RawSource {
  const record = requireRecord(value, where);
  const kind = requireString(record, 'kind', where);
  if (kind !== 'periodical' && kind !== 'monograph') {
    throw new Error(
      `snapshot: unsupported source kind ${JSON.stringify(kind)} at ${where} ` +
        '(expected "periodical" or "monograph").'
    );
  }
  const language = parseSourceLanguage(record.language, where);
  const issues = requireArray(record.issues, `${where}.issues`).map((issue, i) =>
    parseRawIssue(issue, `${where}.issues[${i}]`)
  );
  const base: RawSource = {
    sourceId: requireString(record, 'sourceId', where),
    title: requireString(record, 'title', where),
    kind,
    language,
    ark: requireString(record, 'ark', where),
    rights: requireString(record, 'rights', where),
    issues,
  };
  // Additive optional field (US2): only attach when present, so snapshots
  // predating the concise-summary extension round-trip unchanged.
  if (record.conciseSummary === undefined) {
    return base;
  }
  return {
    ...base,
    conciseSummary: parseLoadedSummary(record.conciseSummary, `${where}.conciseSummary`),
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
