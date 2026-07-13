/**
 * Parsers for the corpus-coverage-audit authored fields (specs/007) added to a
 * {@link Source}: `evidenceClass`, `references[]`, `knownMemberCount`, and
 * `suspected[]`. Split out of `load-fields.ts` to keep each loader module small
 * (repo ~300-500-line guidance). Same fail-loud, no-fallback discipline as the
 * shipped loader helpers.
 *
 * Scope note: these parsers do the loader's NORMAL shape/required-field checks
 * (an object, required subfields present) and narrow each closed-vocab field
 * with its `is*` predicate -- exactly as `load.ts` already narrows `kind` and
 * `status` (a strongly-typed field cannot hold a non-member without a
 * forbidden cast). The RICHER graceful `bib validate` findings (citedKind
 * cross-referencing, `resolvedTo` referential integrity, group-only
 * enforcement, non-negative-integer) belong to the later validation tasks, not
 * here.
 */

import {
  assertKnownKeys,
  fail,
  optionalString,
  requireObject,
  requireString,
} from '@/bibliography/load-primitives';
import { isCitedKind, isEvidenceClass } from '@/bibliography/vocab';
import type { EvidenceClass } from '@/bibliography/vocab';
import type { Reference, SuspectedGap } from '@/model/source';

const REFERENCE_KEYS = new Set(['citedAs', 'citedKind', 'basis', 'resolvedTo', 'notes']);
const SUSPECTED_KEYS = new Set(['description', 'basis', 'evidenceClass', 'notes']);

/**
 * Narrow an authored `evidenceClass` string to the closed-but-extensible
 * {@link EvidenceClass} vocabulary. Mirrors how `load.ts` narrows `kind` /
 * `status`: a value outside the vocabulary fails loud rather than being cast
 * onto the strongly-typed field. Absent stays `undefined` (unclassified).
 */
export function optionalEvidenceClass(
  value: unknown,
  filePath: string,
  where: string,
): EvidenceClass | undefined {
  const raw = optionalString(value, filePath, where);
  if (raw === undefined) {
    return undefined;
  }
  if (!isEvidenceClass(raw)) {
    fail(filePath, `${where} "${raw}" is not in the EvidenceClass vocabulary`);
  }
  return raw;
}

/**
 * Parse one authored `references[]` entry. `citedAs` is required; `citedKind`
 * (narrowed to the {@link isCitedKind} vocabulary), `basis` (free-form),
 * `resolvedTo`, and `notes` are optional. Absent optionals are omitted from
 * the returned object rather than set to `undefined`.
 */
export function validateReference(value: unknown, filePath: string, index: number): Reference {
  const where = `references[${index}]`;
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, REFERENCE_KEYS, filePath, where);

  const citedAs = requireString(obj.citedAs, filePath, `${where}.citedAs`);
  const reference: Reference = { citedAs };

  const citedKindRaw = optionalString(obj.citedKind, filePath, `${where}.citedKind`);
  if (citedKindRaw !== undefined) {
    if (!isCitedKind(citedKindRaw)) {
      fail(filePath, `${where}.citedKind "${citedKindRaw}" is not in the CitedKind vocabulary`);
    }
    reference.citedKind = citedKindRaw;
  }

  const basis = optionalString(obj.basis, filePath, `${where}.basis`);
  if (basis !== undefined) {
    reference.basis = basis;
  }
  const resolvedTo = optionalString(obj.resolvedTo, filePath, `${where}.resolvedTo`);
  if (resolvedTo !== undefined) {
    reference.resolvedTo = resolvedTo;
  }
  const notes = optionalString(obj.notes, filePath, `${where}.notes`);
  if (notes !== undefined) {
    reference.notes = notes;
  }
  return reference;
}

/**
 * Parse one authored `suspected[]` entry (a {@link SuspectedGap}).
 * `description` and `basis` are required; `evidenceClass` (narrowed) and
 * `notes` are optional. Absent optionals are omitted from the returned object.
 */
export function validateSuspectedGap(value: unknown, filePath: string, index: number): SuspectedGap {
  const where = `suspected[${index}]`;
  const obj = requireObject(value, filePath, where);
  assertKnownKeys(obj, SUSPECTED_KEYS, filePath, where);

  const description = requireString(obj.description, filePath, `${where}.description`);
  const basis = requireString(obj.basis, filePath, `${where}.basis`);
  const gap: SuspectedGap = { description, basis };

  const evidenceClass = optionalEvidenceClass(obj.evidenceClass, filePath, `${where}.evidenceClass`);
  if (evidenceClass !== undefined) {
    gap.evidenceClass = evidenceClass;
  }
  const notes = optionalString(obj.notes, filePath, `${where}.notes`);
  if (notes !== undefined) {
    gap.notes = notes;
  }
  return gap;
}

/**
 * Parse an authored `knownMemberCount`: a number OR the literal string
 * `'unknown'` (first-class, distinct from `0` and from absent). Any other
 * shape fails loud. The non-negative-integer refinement is a later validation
 * task, not this structural shape check.
 */
export function validateKnownMemberCount(
  value: unknown,
  filePath: string,
  where: string,
): number | 'unknown' {
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value;
  }
  if (value === 'unknown') {
    return 'unknown';
  }
  fail(filePath, `${where} must be a number or the literal string "unknown"`);
}

/**
 * Parse an authored `threads[]` (spec 010, FR-010/FR-011): an array of
 * strings naming thread ids this Source belongs to. This is the loader's
 * NORMAL shape check only -- an array of non-strings fails loud here, but
 * whether each id actually resolves against `bibliography/scopes.yml` is a
 * whole-registry referential check, done at `bib validate` time
 * (`@/bibliography/validate-checks`'s `validateSourceThreads`), the same
 * split as `references[].resolvedTo` (V3, checked in
 * `@/bibliography/validate-coverage-checks`) rather than here. Absent stays
 * `undefined`, matching every other optional field on `Source`.
 */
export function validateThreads(value: unknown, filePath: string, where: string): string[] {
  if (!Array.isArray(value)) {
    fail(filePath, `${where} must be an array of thread id strings`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      fail(filePath, `${where}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}
