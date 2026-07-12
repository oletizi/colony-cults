import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import { describeError } from '@/bibliography/load-primitives';

/**
 * One recorded repository search over a campaign (source-group), authored by
 * hand into `bibliography/search-log.yml`. Append-only: existing entries and
 * `id`s are stable and never mutated once committed -- new searches are
 * recorded by adding a new entry, not editing an old one.
 *
 * See specs/007-corpus-coverage-audit/data-model.md § SearchLogEntry and
 * contracts/authored-fields.md.
 */
export interface SearchLogEntry {
  /** Stable, flat-opaque, e.g. `SRCH-0001`. UNIQUE across the file (V6). */
  id: string;
  /** ISO date (`YYYY-MM-DD`) the search was performed. */
  date: string;
  /** The repository/archive searched, e.g. `"State Library of Queensland"`. */
  repository: string;
  /**
   * The campaign this search targeted -- a source-group `sourceId`
   * (e.g. `PB-P004`), not an arbitrary label.
   */
  campaign: string;
  /** What was searched: the query, collection, or coverage scope. */
  scope: string;
  /** What the search covered and/or found. */
  coverage: string;
  /** Open questions remaining after this search, if any. */
  remainingQuestions?: string[];
  /** Free-text notes. */
  notes?: string;
}

const ENTRY_KEYS = new Set([
  'id',
  'date',
  'repository',
  'campaign',
  'scope',
  'coverage',
  'remainingQuestions',
  'notes',
]);

const REQUIRED_STRING_FIELDS = [
  'id',
  'date',
  'repository',
  'campaign',
  'scope',
  'coverage',
] as const;

/** Throw a locating, descriptive error naming the file and the offending entry/field. */
function fail(filePath: string, message: string): never {
  throw new Error(`loadSearchLog(${filePath}): ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFileText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`loadSearchLog(${filePath}): cannot read file: ${describeError(error)}`);
  }
}

function parseYamlOrFail(text: string, filePath: string): unknown {
  try {
    return parseYaml(text);
  } catch (error) {
    throw new Error(`loadSearchLog(${filePath}): malformed YAML: ${describeError(error)}`);
  }
}

/**
 * A human-readable handle for one entry in error messages: the entry's own
 * `id` when it is present and well-formed, falling back to its list index
 * when `id` itself is the missing/malformed field (so the error still names
 * *something* locating the offending entry -- see V7).
 */
function entryLabel(obj: Record<string, unknown>, index: number): string {
  const id = obj.id;
  return typeof id === 'string' && id.trim().length > 0 ? `entry "${id}"` : `entries[${index}]`;
}

function requireEntryString(
  obj: Record<string, unknown>,
  field: (typeof REQUIRED_STRING_FIELDS)[number],
  filePath: string,
  label: string,
): string {
  const value = obj[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(filePath, `${label} is missing required field "${field}" (V7)`);
  }
  return value;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Require `date` to be a well-formed ISO `YYYY-MM-DD` AND a real calendar date
 * (V10). Fail-loud at load rather than as a `bib validate` finding: the
 * search-history projection (`@/bibliography/coverage/coverage-history`)
 * determines `lastSearched` by comparing these strings lexicographically,
 * which is only correct for zero-padded ISO dates -- a malformed date (e.g.
 * `2026-7-1`, `2026-02-30`, `yesterday`) would silently corrupt the "last
 * searched" ordering, so it must never reach a projection. Rejects a bad
 * format (regex) and an impossible calendar date (round-trip through UTC).
 */
function requireIsoDate(obj: Record<string, unknown>, filePath: string, label: string): string {
  const raw = requireEntryString(obj, 'date', filePath, label);
  const match = ISO_DATE_RE.exec(raw);
  if (match === null) {
    fail(filePath, `${label} date "${raw}" is not ISO YYYY-MM-DD (V10)`);
  }
  const [, yearStr, monthStr, dayStr] = match;
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    fail(filePath, `${label} date "${raw}" is not ISO YYYY-MM-DD (V10)`);
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    fail(filePath, `${label} date "${raw}" is not a real calendar date (V10)`);
  }
  return raw;
}

function validateRemainingQuestions(
  value: unknown,
  filePath: string,
  label: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    fail(filePath, `${label}.remainingQuestions must be a list of strings`);
  }
  return value.map((question, i) => {
    if (typeof question !== 'string' || question.trim().length === 0) {
      fail(filePath, `${label}.remainingQuestions[${i}] must be a non-empty string`);
    }
    return question;
  });
}

function validateNotes(value: unknown, filePath: string, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(filePath, `${label}.notes must be a non-empty string when present`);
  }
  return value;
}

function validateEntry(value: unknown, filePath: string, index: number): SearchLogEntry {
  if (!isPlainObject(value)) {
    fail(filePath, `entries[${index}] must be an object`);
  }
  const label = entryLabel(value, index);

  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.has(key)) {
      fail(filePath, `${label} has unknown key "${key}" (no silent drop)`);
    }
  }

  const id = requireEntryString(value, 'id', filePath, label);
  const date = requireIsoDate(value, filePath, label);
  const repository = requireEntryString(value, 'repository', filePath, label);
  const campaign = requireEntryString(value, 'campaign', filePath, label);
  const scope = requireEntryString(value, 'scope', filePath, label);
  const coverage = requireEntryString(value, 'coverage', filePath, label);
  const remainingQuestions = validateRemainingQuestions(value.remainingQuestions, filePath, label);
  const notes = validateNotes(value.notes, filePath, label);

  const entry: SearchLogEntry = { id, date, repository, campaign, scope, coverage };
  if (remainingQuestions !== undefined) {
    entry.remainingQuestions = remainingQuestions;
  }
  if (notes !== undefined) {
    entry.notes = notes;
  }
  return entry;
}

/**
 * Read and structurally validate `bibliography/search-log.yml` (append-only
 * authored search history) into a typed {@link SearchLogEntry} list.
 *
 * Fails loud (throws, with a locating message) on:
 * - unreadable/malformed YAML,
 * - a document that isn't a list,
 * - any entry missing a required field (`id`/`date`/`repository`/`campaign`/
 *   `scope`/`coverage` -- V7) or carrying an unrecognized key,
 * - two entries sharing the same `id` (V6).
 *
 * `search-log.yml` is not required to exist yet (no searches logged): a
 * missing file returns `[]`, the same "absent optional data" treatment
 * `@/bibliography/load`'s `sourceKind` gives a missing SSOT directory. Once
 * the file exists, its contents must be well-formed -- there is no fallback.
 */
export function loadSearchLog(filePath: string): SearchLogEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const text = readFileText(filePath);
  const parsed: unknown = parseYamlOrFail(text, filePath);

  if (parsed === undefined || parsed === null) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    fail(filePath, 'document must be a list of search-log entries');
  }

  const entries = parsed.map((value, index) => validateEntry(value, filePath, index));

  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      fail(filePath, `duplicate search-log id "${entry.id}" (V6)`);
    }
    seenIds.add(entry.id);
  }

  return entries;
}
