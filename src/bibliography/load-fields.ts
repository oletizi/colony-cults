import type { AuthoredRepositoryRecord, IdentifierLeak } from '@/bibliography/model';
import {
  assertKnownKeys,
  describeError,
  fail,
  optionalString,
  requireArray,
  requireNumber,
  requireObject,
  requireString,
} from '@/bibliography/load-primitives';
import type { AcquiredAsset } from '@/model/acquired-asset';
import { ACQUIRED_ASSET_ROLES, isAcquiredAssetRole } from '@/model/acquired-asset';
import type { CopyLevelIdentifierType, WorkLevelIdentifierType } from '@/model/identifiers';
import { classifyIdentifier } from '@/model/identifiers';
import type {
  CopyIdentifier,
  MetadataSnapshotRef,
  VerificationCheckResult,
  VerificationVerdict,
} from '@/model/repository-record';
import type { Rights, RightsAssessment } from '@/model/rights';
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
  'sourceUrl',
  'retrievedAt',
  'identifiers',
  'folios',
  'rights',
  'rightsAssessment',
  'assets',
  'census',
  'metadataSnapshot',
  'verification',
]);
const ACQUIRED_ASSET_KEYS = new Set([
  'sourceUrl',
  'mediaType',
  'objectStoreKey',
  'checksum',
  'byteLength',
  'provenancePath',
  'role',
  'sequence',
  'representationChoice',
]);
const TITLE_KEYS = new Set(['text', 'role', 'language']);
const IDENTIFIER_KEYS = new Set(['type', 'value']);
const RIGHTS_KEYS = new Set(['ark', 'status', 'rawResponse', 'dcRights', 'raw']);
const RIGHTS_ASSESSMENT_KEYS = new Set([
  'rightsRaw',
  'rightsStatus',
  'rightsBasis',
  'rightsJurisdiction',
  'assessedBy',
  'assessedAt',
]);
const METADATA_SNAPSHOT_KEYS = new Set(['path', 'retrievedAt', 'endpoint', 'normalizationVersion']);
const VERIFICATION_KEYS = new Set(['result', 'verifiedAt', 'checks', 'snapshotRef']);
const VERIFICATION_CHECKS_KEYS = new Set([
  'identifierResolved',
  'rights',
  'requiredMetadata',
  'hardDuplicate',
  'possibleDuplicate',
]);

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

function isRightsAssessmentStatus(value: string): value is RightsAssessment['rightsStatus'] {
  return value === 'public-domain' || value === 'restricted' || value === 'uncertain';
}

function isVerificationCheckResult(value: string): value is VerificationCheckResult {
  return value === 'passed' || value === 'failed';
}

function isPossibleDuplicateResult(
  value: string,
): value is VerificationVerdict['checks']['possibleDuplicate'] {
  return value === 'passed' || value === 'review-required';
}

function isWorkLevelType(value: string): value is WorkLevelIdentifierType {
  return value === 'isbn' || value === 'issn' || value === 'oclc';
}

function isCopyLevelType(value: string): value is CopyLevelIdentifierType {
  return (
    value === 'accession' ||
    value === 'ark' ||
    value === 'iiif-manifest' ||
    value === 'scan-doi' ||
    value === 'ia-item'
  );
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

/**
 * Parse an authored `folios` array (specs/012) -- the folio numbers of the
 * document at this record's ark that the held copy comprises. Present ⇒ the
 * copy is an EXCERPT of exactly these folios; the field is entirely optional
 * (absent ⇒ whole-document holding, today's unchanged behavior), so this is
 * only called when `obj.folios !== undefined`. Fails loud (rule 8, no silent
 * drop/coercion) on: not an array, a non-integer element, an element `< 1`,
 * or the array not being strictly ascending (which also catches duplicates,
 * since a repeated value cannot be `>` its predecessor).
 */
export function validateFolios(value: unknown, filePath: string, where: string): number[] {
  const raw = requireArray(value, filePath, where);
  if (raw.length === 0) {
    fail(filePath, `${where} must be a non-empty array when present`);
  }
  const folios = raw.map((v, i) => {
    const n = requireNumber(v, filePath, `${where}[${i}]`);
    if (!Number.isInteger(n)) {
      fail(filePath, `${where}[${i}] must be an integer, got ${n}`);
    }
    if (n < 1) {
      fail(filePath, `${where}[${i}] must be >= 1, got ${n}`);
    }
    return n;
  });
  for (let i = 1; i < folios.length; i += 1) {
    if (folios[i] === folios[i - 1]) {
      fail(filePath, `${where} contains duplicate value ${folios[i]} at index ${i}`);
    }
    if (folios[i] < folios[i - 1]) {
      fail(
        filePath,
        `${where} must be strictly ascending -- ${folios[i]} at index ${i} follows ${folios[i - 1]}`,
      );
    }
  }
  return folios;
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
  // Additive optional field (D-07): the archive's verbatim rights statement.
  const raw = optionalString(obj.raw, filePath, `${where}.raw`);
  return raw === undefined
    ? { ark, status: statusRaw, rawResponse, dcRights }
    : { ark, status: statusRaw, rawResponse, dcRights, raw };
}

/**
 * Parse an authored `rightsAssessment` (T018, `bib rights-assess`) -- the
 * authoritative, operator-authored copy-level rights judgment. `rightsStatus`
 * is narrowed against the closed `public-domain | restricted | uncertain`
 * vocab; `rightsBasis` is required and non-empty (an assessment can never
 * exist without a basis, mirroring `bib rights-assess`'s own fail-loud rule);
 * `assessedBy` is validated as the literal `"operator"` -- a model/automated
 * value on disk is a load-time error, not silently accepted.
 */
export function validateRightsAssessment(
  value: unknown,
  filePath: string,
  where: string,
): RightsAssessment {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, RIGHTS_ASSESSMENT_KEYS, filePath, where);
  const rightsStatusRaw = requireString(obj.rightsStatus, filePath, `${where}.rightsStatus`);
  if (!isRightsAssessmentStatus(rightsStatusRaw)) {
    fail(
      filePath,
      `${where}.rightsStatus "${rightsStatusRaw}" must be "public-domain", "restricted", or "uncertain"`,
    );
  }
  const rightsBasis = requireString(obj.rightsBasis, filePath, `${where}.rightsBasis`);
  const assessedByRaw = requireString(obj.assessedBy, filePath, `${where}.assessedBy`);
  if (assessedByRaw !== 'operator') {
    fail(filePath, `${where}.assessedBy "${assessedByRaw}" must be "operator"`);
  }
  const assessedAt = requireString(obj.assessedAt, filePath, `${where}.assessedAt`);
  const rightsRaw = optionalString(obj.rightsRaw, filePath, `${where}.rightsRaw`);
  const rightsJurisdiction = optionalString(
    obj.rightsJurisdiction,
    filePath,
    `${where}.rightsJurisdiction`,
  );

  const assessment: RightsAssessment = {
    rightsStatus: rightsStatusRaw,
    rightsBasis,
    assessedBy: assessedByRaw,
    assessedAt,
  };
  if (rightsRaw !== undefined) {
    assessment.rightsRaw = rightsRaw;
  }
  if (rightsJurisdiction !== undefined) {
    assessment.rightsJurisdiction = rightsJurisdiction;
  }
  return assessment;
}

/**
 * Parse an authored `metadataSnapshot` reference (additive optional field,
 * D-07) -- the immutable raw-response snapshot a record's normalized fields
 * were derived from.
 */
export function validateMetadataSnapshot(
  value: unknown,
  filePath: string,
  where: string,
): MetadataSnapshotRef {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, METADATA_SNAPSHOT_KEYS, filePath, where);
  const snapshotPath = requireString(obj.path, filePath, `${where}.path`);
  const retrievedAt = requireString(obj.retrievedAt, filePath, `${where}.retrievedAt`);
  const endpoint = requireString(obj.endpoint, filePath, `${where}.endpoint`);
  const normalizationVersion = requireNumber(
    obj.normalizationVersion,
    filePath,
    `${where}.normalizationVersion`,
  );
  return { path: snapshotPath, retrievedAt, endpoint, normalizationVersion };
}

function validateVerificationChecks(
  value: unknown,
  filePath: string,
  where: string,
): VerificationVerdict['checks'] {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, VERIFICATION_CHECKS_KEYS, filePath, where);

  const identifierResolvedRaw = requireString(
    obj.identifierResolved,
    filePath,
    `${where}.identifierResolved`,
  );
  if (!isVerificationCheckResult(identifierResolvedRaw)) {
    fail(filePath, `${where}.identifierResolved must be "passed" or "failed"`);
  }
  const rightsRaw = requireString(obj.rights, filePath, `${where}.rights`);
  if (!isVerificationCheckResult(rightsRaw)) {
    fail(filePath, `${where}.rights must be "passed" or "failed"`);
  }
  const requiredMetadataRaw = requireString(
    obj.requiredMetadata,
    filePath,
    `${where}.requiredMetadata`,
  );
  if (!isVerificationCheckResult(requiredMetadataRaw)) {
    fail(filePath, `${where}.requiredMetadata must be "passed" or "failed"`);
  }
  const hardDuplicateRaw = requireString(obj.hardDuplicate, filePath, `${where}.hardDuplicate`);
  if (!isVerificationCheckResult(hardDuplicateRaw)) {
    fail(filePath, `${where}.hardDuplicate must be "passed" or "failed"`);
  }
  const possibleDuplicateRaw = requireString(
    obj.possibleDuplicate,
    filePath,
    `${where}.possibleDuplicate`,
  );
  if (!isPossibleDuplicateResult(possibleDuplicateRaw)) {
    fail(filePath, `${where}.possibleDuplicate must be "passed" or "review-required"`);
  }

  return {
    identifierResolved: identifierResolvedRaw,
    rights: rightsRaw,
    requiredMetadata: requiredMetadataRaw,
    hardDuplicate: hardDuplicateRaw,
    possibleDuplicate: possibleDuplicateRaw,
  };
}

/**
 * Parse an authored `verification` verdict (additive optional field, D-03)
 * -- the recorded outcome of `promote`'s rerun verification. `promote` only
 * ever records a passing verdict, so `result` is validated as the literal
 * `"passed"`.
 */
export function validateVerification(
  value: unknown,
  filePath: string,
  where: string,
): VerificationVerdict {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, VERIFICATION_KEYS, filePath, where);
  const resultRaw = requireString(obj.result, filePath, `${where}.result`);
  if (resultRaw !== 'passed') {
    fail(filePath, `${where}.result "${resultRaw}" must be "passed"`);
  }
  const verifiedAt = requireString(obj.verifiedAt, filePath, `${where}.verifiedAt`);
  const checks = validateVerificationChecks(obj.checks, filePath, `${where}.checks`);
  const snapshotRef = requireString(obj.snapshotRef, filePath, `${where}.snapshotRef`);
  return { result: resultRaw, verifiedAt, checks, snapshotRef };
}

/**
 * Parse one authored `assets[]` entry (spec 011, T005/T030) -- an
 * {@link AcquiredAsset} an adapter `acquire` mirrored directly to the object
 * store. Every non-optional field is required and fails loud when absent or
 * mistyped (no silent drop, no fabrication); `role`/`representationChoice` are
 * optional strings and `sequence` an optional number, omitted from the result
 * when absent so a load -> serialize round-trip is lossless.
 */
export function validateAcquiredAsset(
  value: unknown,
  filePath: string,
  where: string,
): AcquiredAsset {
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, ACQUIRED_ASSET_KEYS, filePath, where);
  const sourceUrl = requireString(obj.sourceUrl, filePath, `${where}.sourceUrl`);
  const mediaType = requireString(obj.mediaType, filePath, `${where}.mediaType`);
  const objectStoreKey = requireString(obj.objectStoreKey, filePath, `${where}.objectStoreKey`);
  const checksum = requireString(obj.checksum, filePath, `${where}.checksum`);
  const byteLength = requireNumber(obj.byteLength, filePath, `${where}.byteLength`);
  const provenancePath = requireString(obj.provenancePath, filePath, `${where}.provenancePath`);

  const asset: AcquiredAsset = {
    sourceUrl,
    mediaType,
    objectStoreKey,
    checksum,
    byteLength,
    provenancePath,
  };
  const role = optionalString(obj.role, filePath, `${where}.role`);
  if (role !== undefined) {
    if (!isAcquiredAssetRole(role)) {
      fail(
        filePath,
        `${where}.role: unknown asset role "${role}" (expected one of ${ACQUIRED_ASSET_ROLES.join(', ')})`,
      );
    }
    asset.role = role;
  }
  if (obj.sequence !== undefined) {
    asset.sequence = requireNumber(obj.sequence, filePath, `${where}.sequence`);
  }
  const representationChoice = optionalString(
    obj.representationChoice,
    filePath,
    `${where}.representationChoice`,
  );
  if (representationChoice !== undefined) {
    asset.representationChoice = representationChoice;
  }
  return asset;
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
  const sourceUrl = optionalString(obj.sourceUrl, filePath, `${where}.sourceUrl`);
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

  const folios =
    obj.folios === undefined ? undefined : validateFolios(obj.folios, filePath, `${where}.folios`);

  const rights =
    obj.rights === undefined ? undefined : validateRights(obj.rights, filePath, `${where}.rights`);

  const rightsAssessment =
    obj.rightsAssessment === undefined
      ? undefined
      : validateRightsAssessment(obj.rightsAssessment, filePath, `${where}.rightsAssessment`);

  const assets: AcquiredAsset[] | undefined =
    obj.assets === undefined
      ? undefined
      : requireArray(obj.assets, filePath, `${where}.assets`).map((a, i) =>
          validateAcquiredAsset(a, filePath, `${where}.assets[${i}]`),
        );

  const metadataSnapshot =
    obj.metadataSnapshot === undefined
      ? undefined
      : validateMetadataSnapshot(obj.metadataSnapshot, filePath, `${where}.metadataSnapshot`);

  const verification =
    obj.verification === undefined
      ? undefined
      : validateVerification(obj.verification, filePath, `${where}.verification`);

  const record: AuthoredRepositoryRecord = {
    sourceArchive,
    status,
    catalogUrl,
    originalUrl,
    sourceUrl,
    retrievedAt,
    identifiers: obj.identifiers === undefined ? undefined : identifiers,
    folios,
    rights,
    rightsAssessment,
    assets,
    census,
    metadataSnapshot,
    verification,
  };

  return { record, identifierLeaks };
}
