/**
 * Parsers for the corpus-coverage-audit authored fields (specs/007) added to a
 * {@link Source}: `evidenceClass`, `references[]`, `knownExtent`, and
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
import {
  isCitedKind,
  isEvidenceClass,
  isKnownExtentState,
  isLeadResolutionState,
} from '@/bibliography/vocab';
import type { EvidenceClass, KnownExtentState, LeadResolutionState } from '@/bibliography/vocab';
import type { KnownExtent, LeadResolution, Reference, SuspectedGap } from '@/model/source';

const REFERENCE_KEYS = new Set(['citedAs', 'citedKind', 'basis', 'resolvedTo', 'notes']);
const SUSPECTED_KEYS = new Set(['description', 'basis', 'evidenceClass', 'notes', 'resolution']);

/**
 * Allowed keys for one `knownExtent` object, keyed by its `state`
 * discriminant (specs/011 § KnownExtent). `state` itself is always allowed;
 * each state additionally allows exactly the fields its branch of
 * {@link KnownExtent} carries -- an extra key on ANY state (including
 * `unexamined`, which allows none) fails loud via `assertKnownKeys`, mirroring
 * `RESOLUTION_KEYS_BY_STATE` above.
 */
const KNOWN_EXTENT_KEYS_BY_STATE: Record<KnownExtentState, Set<string>> = {
  measured: new Set(['state', 'count', 'basis']),
  unexamined: new Set(['state']),
  irreducible: new Set(['state', 'basis']),
};

/**
 * Allowed keys for one `resolution` object, keyed by its `state` discriminant
 * (specs/011 § SuspectedLead.resolution). `state` itself is always allowed;
 * each state additionally allows exactly the fields its branch of
 * {@link LeadResolution} carries -- an extra key on ANY state (including
 * `unexamined`, which allows none) fails loud via `assertKnownKeys`, the same
 * "no silent drop" discipline as every other authored object in this module.
 */
const RESOLUTION_KEYS_BY_STATE: Record<LeadResolutionState, Set<string>> = {
  unexamined: new Set(['state']),
  identified: new Set(['state', 'candidate', 'resolvedAt']),
  inventoried: new Set(['state', 'sourceId', 'resolvedAt']),
  excluded: new Set(['state', 'reason', 'resolvedAt']),
  unavailable: new Set(['state', 'reason', 'resolvedAt']),
};

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
 * `description` and `basis` are required; `evidenceClass` (narrowed), `notes`,
 * and `resolution` (narrowed via {@link validateResolution}) are optional.
 * Absent optionals are omitted from the returned object.
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
  if (obj.resolution !== undefined) {
    gap.resolution = validateResolution(obj.resolution, filePath, `${where}.resolution`);
  }
  return gap;
}

/**
 * Parse one authored `suspected[].resolution` (a {@link LeadResolution}) --
 * the disposition of an inferred, uncited lead (specs/011 §
 * SuspectedLead.resolution). `state` must be a member of the closed
 * {@link isLeadResolutionState} vocabulary; each state then requires exactly
 * its own fields (`identified`: `candidate` + `resolvedAt`; `inventoried`:
 * `sourceId` + `resolvedAt`; `excluded`/`unavailable`: `reason` +
 * `resolvedAt`; `unexamined`: no extra fields). A missing/invalid `state`, a
 * state missing one of its required fields, or an extra key not belonging to
 * that state's shape all fail loud -- illegal combinations are
 * unrepresentable in the {@link LeadResolution} type, and the loader refuses
 * to construct one from malformed input rather than guessing or dropping a
 * field.
 *
 * An ABSENT `resolution` is never passed here -- the caller
 * ({@link validateSuspectedGap}) only calls this when `obj.resolution !==
 * undefined`, so an omitted resolution stays omitted on the loaded
 * `SuspectedGap` rather than being fabricated into an explicit
 * `{ state: 'unexamined' }` object (see the doc comment on
 * `SuspectedGap.resolution`).
 */
export function validateResolution(
  value: unknown,
  filePath: string,
  where: string,
): LeadResolution {
  const obj = requireObject(value, filePath, where);
  const stateRaw = requireString(obj.state, filePath, `${where}.state`);
  if (!isLeadResolutionState(stateRaw)) {
    fail(
      filePath,
      `${where}.state "${stateRaw}" is not in the LeadResolution state vocabulary ` +
        `(unexamined / identified / inventoried / excluded / unavailable)`,
    );
  }
  assertKnownKeys(obj, RESOLUTION_KEYS_BY_STATE[stateRaw], filePath, where);

  switch (stateRaw) {
    case 'unexamined':
      return { state: 'unexamined' };
    case 'identified':
      return {
        state: 'identified',
        candidate: requireString(obj.candidate, filePath, `${where}.candidate`),
        resolvedAt: requireString(obj.resolvedAt, filePath, `${where}.resolvedAt`),
      };
    case 'inventoried':
      return {
        state: 'inventoried',
        sourceId: requireString(obj.sourceId, filePath, `${where}.sourceId`),
        resolvedAt: requireString(obj.resolvedAt, filePath, `${where}.resolvedAt`),
      };
    case 'excluded':
      return {
        state: 'excluded',
        reason: requireString(obj.reason, filePath, `${where}.reason`),
        resolvedAt: requireString(obj.resolvedAt, filePath, `${where}.resolvedAt`),
      };
    case 'unavailable':
      return {
        state: 'unavailable',
        reason: requireString(obj.reason, filePath, `${where}.reason`),
        resolvedAt: requireString(obj.resolvedAt, filePath, `${where}.resolvedAt`),
      };
  }
}

/**
 * Parse an authored `knownExtent` (a {@link KnownExtent}) -- the believed
 * extent of a source-group (specs/011 § KnownExtent). `state` must be a
 * member of the closed {@link isKnownExtentState} vocabulary; each state then
 * requires exactly its own fields (`measured`: `count` (a number) + `basis`
 * (a non-empty string); `irreducible`: `basis`; `unexamined`: no extra
 * fields). A missing/invalid `state`, a state missing one of its required
 * fields, or an extra key not belonging to that state's shape all fail loud
 * -- illegal combinations are unrepresentable in the {@link KnownExtent}
 * type, mirroring {@link validateResolution}. This is a CLEAN CUTOVER: the
 * retired bare literal `'unknown'` and the old scalar `knownMemberCount`
 * shape are REMOVED -- neither is accepted here, and the old key is rejected
 * upstream by `SOURCE_KEYS`'s `assertKnownKeys` (no back-compat alias). The
 * non-negative-integer refinement of `measured.count` is a later validation
 * task (`@/bibliography/validate-coverage-checks`), not this structural shape
 * check -- this function accepts any number, including negatives and
 * non-integers.
 */
export function validateKnownExtent(value: unknown, filePath: string, where: string): KnownExtent {
  const obj = requireObject(value, filePath, where);
  const stateRaw = requireString(obj.state, filePath, `${where}.state`);
  if (!isKnownExtentState(stateRaw)) {
    fail(
      filePath,
      `${where}.state "${stateRaw}" is not in the KnownExtent state vocabulary ` +
        `(measured / unexamined / irreducible) -- the bare literal "unknown" and the ` +
        `old scalar knownMemberCount shape are no longer accepted`,
    );
  }
  assertKnownKeys(obj, KNOWN_EXTENT_KEYS_BY_STATE[stateRaw], filePath, where);

  switch (stateRaw) {
    case 'measured': {
      const count = obj.count;
      if (typeof count !== 'number' || Number.isNaN(count)) {
        fail(filePath, `${where}.count must be a number`);
      }
      return {
        state: 'measured',
        count,
        basis: requireString(obj.basis, filePath, `${where}.basis`),
      };
    }
    case 'unexamined':
      return { state: 'unexamined' };
    case 'irreducible':
      return {
        state: 'irreducible',
        basis: requireString(obj.basis, filePath, `${where}.basis`),
      };
  }
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
