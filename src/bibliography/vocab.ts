/**
 * Closed allowed-value vocabularies for the canonical bibliography model, plus
 * the required-field core spec (FR-019). Consumed by the T027 runtime
 * validator; this module owns the data, not the validation flow.
 *
 * See specs/004-canonical-source-metadata/data-model.md.
 */

/**
 * Acquisition status of a `RepositoryRecord` (and, since US3, of a `Source`
 * itself -- see `@/model/source`'s `status`). This tuple is used for
 * MEMBERSHIP validation only (`isAllowed('status', ...)`); its order is NOT
 * significant -- no consumer treats the index as an ordinal. In particular,
 * `excluded` being listed last and `approved-for-acquisition` preceding
 * `wanted` carry no lifecycle-sequencing meaning.
 */
export const STATUS_VALUES = [
  'discovered',
  'approved-for-acquisition',
  'wanted',
  'to-collect',
  'collecting',
  'collected',
  'archived',
  'excluded',
] as const;
export type Status = (typeof STATUS_VALUES)[number];

/** Rights determination. */
export const RIGHTS_VALUES = ['public-domain', 'other'] as const;
export type RightsStatus = (typeof RIGHTS_VALUES)[number];

/** Object-store provider. */
export const PROVIDER_VALUES = ['backblaze-b2', 'git-cache'] as const;
export type Provider = (typeof PROVIDER_VALUES)[number];

/** OCR outcome for a mirrored asset. */
export const OCR_STATUS_VALUES = ['none', 'searchable', 'failed'] as const;
export type OcrStatus = (typeof OCR_STATUS_VALUES)[number];

/** Closed vocab field names, mapped to their allowed-value arrays. */
const VOCABULARIES = {
  status: STATUS_VALUES,
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
