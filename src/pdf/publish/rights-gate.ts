import type { Source } from '@/model/source';
import type { SourceRightsStatus } from '@/model/publication';

/**
 * The affirmative, distributable subset of `SourceRightsStatus` that CLEARS the
 * publish gate (FR-002, SC-003, Constitution IV fail-closed).
 *
 * This is deliberately NARROWER than the RECOGNIZED vocabulary
 * (`SOURCE_RIGHTS_STATUS_VALUES` in `@/bibliography/vocab`, which also lists
 * `openly-licensed` and `gov-reusable`). Those other values are recognized as
 * valid statuses at load time, but are NOT yet cleared for distribution in v1 --
 * they fail closed here exactly as an absent determination does. Widening the
 * cleared set is a deliberate, reviewable one-line edit to this constant, never
 * an implicit consequence of extending the recognized vocab.
 *
 * v1: only `public-domain` is affirmative-distributable.
 */
const AFFIRMATIVE_DISTRIBUTABLE_STATUSES: ReadonlySet<SourceRightsStatus> = new Set([
  'public-domain',
]);

/** True when `status` is a member of the affirmative-distributable set. */
function isAffirmativeDistributable(status: SourceRightsStatus): boolean {
  return AFFIRMATIVE_DISTRIBUTABLE_STATUSES.has(status);
}

/**
 * The source-level publish rights gate (FR-002/FR-005, SC-003, Constitution IV).
 *
 * Fail-closed and AFFIRMATIVE: a publish is permitted ONLY when the `Source`
 * carries a `rights` determination whose `status` is in the
 * affirmative-distributable set (v1: `public-domain`) AND records a non-empty
 * `basis`. Every other state -- absent `rights`, a recognized-but-not-cleared
 * status (`openly-licensed`/`gov-reusable`), or a cleared status with no basis
 * -- THROWS a descriptive Error naming the `sourceId` and the specific gap, and
 * clears nothing.
 *
 * Unlike the copy-level fetch-time gate (`assertPublicDomain` in
 * `@/rights/gate`, which resolves per-ark `dc:rights` via an `OaiRecordClient`),
 * this reads the hand-authored, work-level `Source.rights` and needs no client.
 *
 * @returns the `rights.basis` to record as `Publication.rightsBasis` on the
 *   cleared publication.
 */
export function assertPublishable(source: Source): string {
  const { sourceId, rights } = source;

  if (rights === undefined) {
    throw new Error(
      `publish rights gate: source ${sourceId} carries no affirmative ` +
        `distributable-rights determination (Source.rights is absent); ` +
        `refusing to publish anything`,
    );
  }

  if (!isAffirmativeDistributable(rights.status)) {
    const cleared = [...AFFIRMATIVE_DISTRIBUTABLE_STATUSES].join(', ');
    throw new Error(
      `publish rights gate: source ${sourceId} has rights.status ` +
        `"${rights.status}", which is recognized but NOT ` +
        `affirmative-distributable (cleared: ${cleared}); ` +
        `refusing to publish anything`,
    );
  }

  const basis = rights.basis.trim();
  if (basis === '') {
    throw new Error(
      `publish rights gate: source ${sourceId} has an affirmative ` +
        `rights.status "${rights.status}" but an empty rights.basis; a ` +
        `cleared publication MUST record its basis; refusing to publish`,
    );
  }

  return rights.basis;
}
