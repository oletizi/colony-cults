/**
 * Closed allowed-value vocabularies for the canonical bibliography model, plus
 * the required-field core spec (FR-019). Consumed by the T027 runtime
 * validator; this module owns the data, not the validation flow.
 *
 * See specs/004-canonical-source-metadata/data-model.md and
 * specs/005-source-groups/data-model.md § Status vocabulary.
 */

/**
 * A `Source`'s OWN discovery/acquisition-handoff lifecycle (US3,
 * specs/005-source-groups) -- e.g. `discovered` on a member stub not yet
 * reviewed for inclusion in a source group. This is a DIFFERENT state machine
 * from a `RepositoryRecord`'s acquisition `status` below: a Source's
 * lifecycle ends where a RepositoryRecord's begins --
 *
 * ```
 * discovered -> approved-for-acquisition -> (a RepositoryRecord is authored;
 *                                             see REPOSITORY_ACQUISITION_STATUS_VALUES)
 *        \-> excluded  (terminal; intentionally not promoted, reason in `notes`)
 * ```
 *
 * This tuple is used for MEMBERSHIP validation only
 * (`isSourceLifecycleStatus`); its order is NOT significant -- no consumer
 * treats the index as an ordinal. A RepositoryRecord acquisition value (e.g.
 * `archived`) is deliberately NOT a member of this vocabulary -- authoring it
 * on a `Source.status` is a cross-domain error and fails loud at load
 * (`@/bibliography/load`).
 */
export const SOURCE_LIFECYCLE_STATUS_VALUES = [
  'discovered',
  'approved-for-acquisition',
  'excluded',
] as const;
export type SourceLifecycleStatus = (typeof SOURCE_LIFECYCLE_STATUS_VALUES)[number];

/**
 * Acquisition status of a `RepositoryRecord` -- a held copy's own state
 * machine, distinct from a `Source`'s lifecycle status above. The handoff: a
 * Source's lifecycle ends at `approved-for-acquisition`; a RepositoryRecord is
 * then authored for it, beginning at `wanted`/`to-collect`. This tuple is used
 * for MEMBERSHIP validation only (`isAllowed('status', ...)`, via the
 * field-name-keyed `VOCABULARIES.status` below); its order is NOT significant
 * -- no consumer treats the index as an ordinal. A Source lifecycle value
 * (e.g. `discovered`, `excluded`) is deliberately NOT a member of this
 * vocabulary -- authoring it on a `RepositoryRecord.status` is a cross-domain
 * error and is reported as a `vocab` validation finding
 * (`@/bibliography/validate-checks`'s `validateVocab`).
 */
export const REPOSITORY_ACQUISITION_STATUS_VALUES = [
  'wanted',
  'to-collect',
  'collecting',
  'collected',
  'archived',
] as const;
export type RepositoryAcquisitionStatus = (typeof REPOSITORY_ACQUISITION_STATUS_VALUES)[number];

/** Rights determination. */
export const RIGHTS_VALUES = ['public-domain', 'other'] as const;
export type RightsStatus = (typeof RIGHTS_VALUES)[number];

/** Object-store provider. */
export const PROVIDER_VALUES = ['backblaze-b2', 'git-cache'] as const;
export type Provider = (typeof PROVIDER_VALUES)[number];

/** OCR outcome for a mirrored asset. */
export const OCR_STATUS_VALUES = ['none', 'searchable', 'failed'] as const;
export type OcrStatus = (typeof OCR_STATUS_VALUES)[number];

/**
 * Genre/evidence class of a `Source` (specs/007-corpus-coverage-audit) --
 * e.g. `pamphlet` or `trial-record` on a monograph-shaped `Source`. Orthogonal
 * to the structural `kind` field: a `monograph` may be a `pamphlet`,
 * `prospectus`, etc. Closed-but-EXTENSIBLE -- validated at runtime
 * (`isEvidenceClass`) the same as the shipped `RIGHTS_VALUES` /
 * `OCR_STATUS_VALUES`, but the initial set below is illustrative, not
 * exhaustive: adding a value is a deliberate one-line edit here, not a schema
 * migration. Absent on a `Source` means *unclassified* (not an error; the
 * coverage report counts it separately).
 */
export const EVIDENCE_CLASS_VALUES = [
  'book',
  'pamphlet',
  'prospectus',
  'newspaper',
  'trial-record',
  'gov-report',
  'map',
  'correspondence',
  'periodical-article',
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASS_VALUES)[number];

/**
 * Kind of work a `Reference` cites (specs/007-corpus-coverage-audit),
 * e.g. `journal` or `government-record` on an entry in `Source.references[]`.
 * Closed-but-EXTENSIBLE, same discipline as `EVIDENCE_CLASS_VALUES` above --
 * validated at runtime (`isCitedKind`) but the initial set is illustrative;
 * adding a value is a one-line edit. Optional on a `Reference`; when present
 * it MUST be a member of this vocabulary (fail loud otherwise).
 */
export const CITED_KIND_VALUES = [
  'journal',
  'book',
  'newspaper',
  'pamphlet',
  'government-record',
  'article',
] as const;
export type CitedKind = (typeof CITED_KIND_VALUES)[number];

/**
 * `SourceRights.status` controlled vocabulary (specs/008-edition-publishing) --
 * the affirmative, work-level publish-gate determination on a `Source`. MUST
 * match the `SourceRightsStatus` string union in `@/model/publication` EXACTLY
 * -- that union is the type-level SSOT this tuple mirrors at runtime; keep the
 * two in lockstep by hand (there is no codegen).
 *
 * IMPORTANT: this is the CLOSED set of RECOGNIZED status values, not the
 * publish-gate's affirmative-distributable subset. `isSourceRightsStatus`
 * below answers "is this a known status?" -- it does NOT answer "does this
 * clear the gate?". Today only `public-domain` is affirmative-distributable;
 * `openly-licensed` and `gov-reusable` are recognized-but-non-blocking
 * placeholders (extensible, not yet cleared for v1). The gate decision itself
 * is T023's rights-gate logic, not this vocabulary module -- do not fold gate
 * semantics into this predicate.
 *
 * See specs/008-edition-publishing/data-model.md § 1 SourceRights and
 * specs/008-edition-publishing/contracts/ssot-publications.md § 1.
 */
export const SOURCE_RIGHTS_STATUS_VALUES = [
  'public-domain',
  'openly-licensed',
  'gov-reusable',
] as const;
export type SourceRightsStatus = (typeof SOURCE_RIGHTS_STATUS_VALUES)[number];

/** Scope kind for a search/coverage scope (specs/010-corpus-model-coherence). */
export const SCOPE_KIND_VALUES = ['case', 'thread', 'work-bundle', 'work'] as const;
export type ScopeKind = (typeof SCOPE_KIND_VALUES)[number];

/**
 * The `state` discriminant of a `SuspectedGap.resolution`
 * (specs/011-museum-acquisition-path § SuspectedLead.resolution): the
 * disposition of an inferred, uncited lead. `unexamined` (no disposition
 * recorded yet) -> `identified` (a candidate repository reference found) ->
 * `inventoried` (resolved to a `sourceId`), or a terminal `excluded`
 * (judged not worth pursuing) / `unavailable` (pursued but not obtainable).
 * This tuple validates ONLY that `state` is a recognized member; each
 * state's own required fields (`candidate`/`sourceId`/`reason`/`resolvedAt`)
 * are checked by `@/bibliography/load-coverage-fields`'s `validateResolution`,
 * not here -- a discriminated union's per-branch shape does not fit this
 * module's flat closed-vocab tuples.
 */
export const LEAD_RESOLUTION_STATE_VALUES = [
  'unexamined',
  'identified',
  'inventoried',
  'excluded',
  'unavailable',
] as const;
export type LeadResolutionState = (typeof LEAD_RESOLUTION_STATE_VALUES)[number];

/**
 * Membership test for the `LeadResolutionState` vocabulary (specs/011):
 * `isLeadResolutionState('identified')` -> `true`;
 * `isLeadResolutionState('resolved')` -> `false`. Use wherever a
 * `SuspectedGap.resolution.state` value is checked (see
 * `@/bibliography/load-coverage-fields`).
 */
export function isLeadResolutionState(value: string): value is LeadResolutionState {
  return includesValue(LEAD_RESOLUTION_STATE_VALUES, value);
}

/**
 * The `state` discriminant of a `Source.knownExtent`
 * (specs/011-museum-acquisition-path § KnownExtent): the believed extent of a
 * source-group. `measured` (a finite hand-authored belief) / `unexamined`
 * (not yet assessed) / `irreducible` (fundamentally unbounded/unknowable).
 * This tuple validates ONLY that `state` is a recognized member; each
 * state's own required fields (`count`/`basis`) are checked by
 * `@/bibliography/load-coverage-fields`'s `validateKnownExtent`, not here --
 * same split as `LEAD_RESOLUTION_STATE_VALUES` above.
 */
export const KNOWN_EXTENT_STATE_VALUES = ['measured', 'unexamined', 'irreducible'] as const;
export type KnownExtentState = (typeof KNOWN_EXTENT_STATE_VALUES)[number];

/**
 * Membership test for the `KnownExtentState` vocabulary (specs/011):
 * `isKnownExtentState('measured')` -> `true`;
 * `isKnownExtentState('unknown')` -> `false` (the retired bare literal). Use
 * wherever a `Source.knownExtent.state` value is checked (see
 * `@/bibliography/load-coverage-fields`).
 */
export function isKnownExtentState(value: string): value is KnownExtentState {
  return includesValue(KNOWN_EXTENT_STATE_VALUES, value);
}

/**
 * Structural kind of a `Source` -- the role this work plays in the corpus:
 * `periodical` (serial, multiple dated issues), `monograph` (monographic textual
 * work, single dated/undated document), `archival-item` (discrete non-serial
 * archival work like a photograph, letter, postcard, certificate), or
 * `source-group` (non-fetchable research-defined container of member Sources).
 * Orthogonal to `evidenceClass`, which classifies the EVIDENCE TYPE the work IS
 * (not its structural role). A member's kind may be `periodical`/`monograph`/
 * `archival-item` (never `source-group` -- groups do not nest); group membership
 * does not change a member's own kind.
 */
export const SOURCE_STRUCTURAL_KIND_VALUES = [
  'periodical',
  'monograph',
  'archival-item',
  'source-group',
] as const;
export type SourceStructuralKind = (typeof SOURCE_STRUCTURAL_KIND_VALUES)[number];

/**
 * Membership test for the `SourceStructuralKind` vocabulary:
 * `isSourceStructuralKind('monograph')` -> `true`;
 * `isSourceStructuralKind('scroll')` -> `false`. Use wherever a `Source.kind`
 * value is checked (see `@/bibliography/load`).
 */
export function isSourceStructuralKind(value: string): value is SourceStructuralKind {
  return includesValue(SOURCE_STRUCTURAL_KIND_VALUES, value);
}

/**
 * Closed vocab field names, mapped to their allowed-value arrays. The
 * field-name-keyed `status` entry has always meant a `RepositoryRecord`'s
 * acquisition status (`validateVocab` in `@/bibliography/validate-checks`
 * checks `record.status` against it) -- it is now narrowed to
 * `REPOSITORY_ACQUISITION_STATUS_VALUES` so a Source-lifecycle value
 * (`discovered`/`excluded`) authored on a RepositoryRecord is correctly
 * rejected as cross-domain, rather than silently accepted. A `Source`'s OWN
 * lifecycle status is a SEPARATE vocabulary/predicate
 * (`SOURCE_LIFECYCLE_STATUS_VALUES` / `isSourceLifecycleStatus` above) --
 * deliberately NOT routed through this field-name-keyed path.
 */
const VOCABULARIES = {
  status: REPOSITORY_ACQUISITION_STATUS_VALUES,
  rights: RIGHTS_VALUES,
  provider: PROVIDER_VALUES,
  ocr_status: OCR_STATUS_VALUES,
} as const satisfies Record<string, readonly string[]>;

/** A field name governed by one of the closed vocabularies above. */
export type VocabField = keyof typeof VOCABULARIES;

/** True if `field` is a recognized closed-vocab field. */
export function isVocabField(field: string): field is VocabField {
  return Object.prototype.hasOwnProperty.call(VOCABULARIES, field);
}

/** Membership over a readonly string list (widens the tuple without a cast). */
function includesValue(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

/**
 * Membership test for a closed vocabulary: `isAllowed('status', 'collected')`
 * -> `true`; `isAllowed('status', 'acquired')` -> `false`. Throws for an
 * unrecognized `field` -- there is no vocab to check membership against.
 */
export function isAllowed(field: string, value: string): boolean {
  if (!isVocabField(field)) {
    throw new Error(
      `isAllowed: unknown vocab field "${field}" (expected one of ` +
        `${Object.keys(VOCABULARIES).join(', ')})`,
    );
  }
  return includesValue(VOCABULARIES[field], value);
}

/**
 * Membership test for the Source lifecycle vocabulary (US3):
 * `isSourceLifecycleStatus('discovered')` -> `true`;
 * `isSourceLifecycleStatus('archived')` -> `false` (that value belongs to the
 * separate RepositoryRecord acquisition vocabulary). Deliberately NOT routed
 * through the field-name-keyed `isAllowed('status', ...)` path -- that path
 * validates a RepositoryRecord's acquisition `status`, a distinct state
 * machine. Use this predicate wherever a `Source.status` value is checked
 * (see `@/bibliography/load`).
 */
export function isSourceLifecycleStatus(value: string): value is SourceLifecycleStatus {
  return includesValue(SOURCE_LIFECYCLE_STATUS_VALUES, value);
}

/**
 * Membership test for the `EvidenceClass` vocabulary (specs/007):
 * `isEvidenceClass('pamphlet')` -> `true`; `isEvidenceClass('scroll')` ->
 * `false`. Use wherever a `Source.evidenceClass` or `SuspectedGap.evidenceClass`
 * value is checked (see `@/bibliography/load`).
 */
export function isEvidenceClass(value: string): value is EvidenceClass {
  return includesValue(EVIDENCE_CLASS_VALUES, value);
}

/**
 * Membership test for the `CitedKind` vocabulary (specs/007):
 * `isCitedKind('journal')` -> `true`; `isCitedKind('scroll')` -> `false`. Use
 * wherever a `Reference.citedKind` value is checked (see
 * `@/bibliography/load`).
 */
export function isCitedKind(value: string): value is CitedKind {
  return includesValue(CITED_KIND_VALUES, value);
}

/**
 * Membership test for the `SourceRightsStatus` vocabulary (specs/008):
 * `isSourceRightsStatus('public-domain')` -> `true`;
 * `isSourceRightsStatus('all-rights-reserved')` -> `false`. Answers ONLY
 * "is this a recognized status?" -- it is NOT the publish-gate's
 * affirmative-distributable check (that's T023's rights-gate). Use this
 * wherever a `Source.rights.status` value is loaded/validated (see
 * `@/bibliography/load`).
 */
export function isSourceRightsStatus(value: string): value is SourceRightsStatus {
  return includesValue(SOURCE_RIGHTS_STATUS_VALUES, value);
}

/** One required-field entry in a required-field core spec (FR-019). */
export interface RequiredFieldSpec {
  /** The required field's name on the owning type. */
  field: string;
  /** True when the field is an array that must additionally be non-empty. */
  nonEmptyArray?: boolean;
}

/** `Source` requires `sourceId`, a non-empty `titles`, and `kind` (FR-019). */
export const SOURCE_REQUIRED_FIELDS: readonly RequiredFieldSpec[] = [
  { field: 'sourceId' },
  { field: 'titles', nonEmptyArray: true },
  { field: 'kind' },
];

/**
 * A `RepositoryRecord`, if it exists for a `Source`, requires `sourceArchive`
 * and `status` (FR-019).
 */
export const REPOSITORY_RECORD_REQUIRED_FIELDS: readonly RequiredFieldSpec[] = [
  { field: 'sourceArchive' },
  { field: 'status' },
];
