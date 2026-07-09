import type { AuthoredRepositoryRecord, IdentifierLeak } from '@/bibliography/model';
import {
  assertKnownKeys,
  describeError,
  fail,
  optionalString,
  requireArray,
  requireObject,
  requireString,
} from '@/bibliography/load-primitives';
import type { CopyLevelIdentifierType, WorkLevelIdentifierType } from '@/model/identifiers';
import { classifyIdentifier } from '@/model/identifiers';
import type { CopyIdentifier } from '@/model/repository-record';
import type { Rights } from '@/model/rights';
import type { Title, WorkIdentifier } from '@/model/source';

/**
 * The result of classifying one identifier entry against the level its
 * container expects. A misplaced-but-known type is `'leak'`, not a throw --
 * see {@link IdentifierLeak}. An UNKNOWN type (outside both vocabularies) is
 * still a load-time throw, via `classifyOrFail` below.
 */
export type IdentifierValidationResult<T> =
  | { kind: 'ok'; identifier: T }
  | { kind: 'leak'; type: string; value: string; expectedLevel: 'work' | 'copy' };

/** An {@link IdentifierLeak} found on a repository record, minus the `sourceId` (unknown at record-parse time; the caller in `load.ts` fills it in). */
export type RecordIdentifierLeak = Omit<IdentifierLeak, 'sourceId'>;

const RECORD_KEYS = new Set([
  'sourceArchive',
  'status',
  'catalogUrl',
  'originalUrl',
  'retrievedAt',
  'identifiers',
  'rights',
  'census',
]);
const TITLE_KEYS = new Set(['text', 'role', 'language']);
const IDENTIFIER_KEYS = new Set(['type', 'value']);
const RIGHTS_KEYS = new Set(['ark', 'status', 'rawResponse', 'dcRights']);

function isTitleRole(value: string): value is Title['role'] {
  return (
    value === 'canonical' ||
    value === 'archive' ||
    value === 'alternate' ||
    value === 'translated'
  );
}

function isRightsStatus(value: string): value is Rights['status'] {
  return value === 'public-domain' || value === 'other';
}

function isWorkLevelType(value: string): value is WorkLevelIdentifierType {
  return value === 'isbn' || value === 'issn' || value === 'oclc';
}

function isCopyLevelType(value: string): value is CopyLevelIdentifierType {
  return value === 'ark' || value === 'iiif-manifest' || value === 'scan-doi';
}

/** `classifyIdentifier`, with an unknown-type throw wrapped into a locating error. */
function classifyOrFail(type: string, filePath: string, where: string): 'work' | 'copy' {
  try {
    return classifyIdentifier(type);
  } catch (error) {
    fail(filePath, `${where}: ${describeError(error)}`);
  }
}

export function validateTitle(value: unknown, filePath: string, index: number): Title {
  const where = `titles[${index}]`;
  const obj = requireObject(value, filePath, where);
  if (Object.prototype.hasOwnProperty.call(obj, 'authoritative')) {
    fail(
      filePath,
      `${where} carries a forbidden "authoritative" key -- no title is authoritative (FR-003, contract rule 2)`,
    );
  }
  assertKnownKeys(obj, TITLE_KEYS, filePath, where);
  const text = requireString(obj.text, filePath, `${where}.text`);
  const roleRaw = requireString(obj.role, filePath, `${where}.role`);
  if (!isTitleRole(roleRaw)) {
    fail(
      filePath,
      `${where}.role "${roleRaw}" must be one of canonical/archive/alternate/translated`,
    );
  }
  const language = optionalString(obj.language, filePath, `${where}.language`);
  return language === undefined ? { text, role: roleRaw } : { text, role: roleRaw, language };
}

/**
 * A Source-level identifier's `type` must classify as `'work'`. A known
 * copy-level type here is a *leak* (contract rule 3) -- structurally valid
 * but on the wrong level, and must be reportable by `bib validate` as an
 * `identifier-leak` finding (exit 1), not a load-time throw (exit 2) -- see
 * contracts/source-record.md rule 3 and contracts/validation.md. An UNKNOWN
 * type (outside both the work and copy vocabularies) is still a hard error,
 * via `classifyOrFail`.
 */
export function validateWorkIdentifier(
  value: unknown,
  filePath: string,
  where: string,
): IdentifierValidationResult<WorkIdentifier> {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, IDENTIFIER_KEYS, filePath, where);
  const type = requireString(obj.type, filePath, `${where}.type`);
  const val = requireString(obj.value, filePath, `${where}.value`);
  const level = classifyOrFail(type, filePath, where);
  if (level !== 'work') {
    return { kind: 'leak', type, value: val, expectedLevel: 'copy' };
  }
  if (!isWorkLevelType(type)) {
    fail(filePath, `${where}.type "${type}" did not narrow to a work-level type`);
  }
  return { kind: 'ok', identifier: { type, value: val } };
}

/** Mirror of {@link validateWorkIdentifier} for Repository-Record-level identifiers. */
export function validateCopyIdentifier(
  value: unknown,
  filePath: string,
  where: string,
): IdentifierValidationResult<CopyIdentifier> {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, IDENTIFIER_KEYS, filePath, where);
  const type = requireString(obj.type, filePath, `${where}.type`);
  const val = requireString(obj.value, filePath, `${where}.value`);
  const level = classifyOrFail(type, filePath, where);
  if (level !== 'copy') {
    return { kind: 'leak', type, value: val, expectedLevel: 'work' };
  }
  if (!isCopyLevelType(type)) {
    fail(filePath, `${where}.type "${type}" did not narrow to a copy-level type`);
  }
  return { kind: 'ok', identifier: { type, value: val } };
}

export function validateRights(value: unknown, filePath: string, where: string): Rights {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, RIGHTS_KEYS, filePath, where);
  const ark = requireString(obj.ark, filePath, `${where}.ark`);
  const statusRaw = requireString(obj.status, filePath, `${where}.status`);
  if (!isRightsStatus(statusRaw)) {
    fail(filePath, `${where}.status "${statusRaw}" must be "public-domain" or "other"`);
  }
  const rawResponse = requireString(obj.rawResponse, filePath, `${where}.rawResponse`);
  const dcRightsArr = requireArray(obj.dcRights, filePath, `${where}.dcRights`);
  const dcRights = dcRightsArr.map((v, i) =>
    requireString(v, filePath, `${where}.dcRights[${i}]`),
  );
  return { ark, status: statusRaw, rawResponse, dcRights };
}

/** {@link validateRecord}'s result: the authored record plus any identifier leaks found on it. */
export interface ValidatedRecord {
  record: AuthoredRepositoryRecord;
  identifierLeaks: RecordIdentifierLeak[];
}

export function validateRecord(value: unknown, filePath: string, index: number): ValidatedRecord {
  const where = `repositoryRecords[${index}]`;
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, RECORD_KEYS, filePath, where);

  const sourceArchive = requireString(obj.sourceArchive, filePath, `${where}.sourceArchive`);
  const status = requireString(obj.status, filePath, `${where}.status`);
  const catalogUrl = optionalString(obj.catalogUrl, filePath, `${where}.catalogUrl`);
  const originalUrl = optionalString(obj.originalUrl, filePath, `${where}.originalUrl`);
  const retrievedAt = optionalString(obj.retrievedAt, filePath, `${where}.retrievedAt`);
  const census = optionalString(obj.census, filePath, `${where}.census`);

  const identifiers: CopyIdentifier[] = [];
  const identifierLeaks: RecordIdentifierLeak[] = [];
  if (obj.identifiers !== undefined) {
    const results = requireArray(obj.identifiers, filePath, `${where}.identifiers`).map((v, i) =>
      validateCopyIdentifier(v, filePath, `${where}.identifiers[${i}]`),
    );
    for (const result of results) {
      if (result.kind === 'ok') {
        identifiers.push(result.identifier);
      } else {
        identifierLeaks.push({
          onLevel: 'record',
          sourceArchive,
          type: result.type,
          value: result.value,
          expectedLevel: result.expectedLevel,
        });
      }
    }
  }

  const rights =
    obj.rights === undefined ? undefined : validateRights(obj.rights, filePath, `${where}.rights`);

  const record: AuthoredRepositoryRecord = {
    sourceArchive,
    status,
    catalogUrl,
    originalUrl,
    retrievedAt,
    identifiers: obj.identifiers === undefined ? undefined : identifiers,
    rights,
    census,
  };

  return { record, identifierLeaks };
}
