import {
  REPOSITORY_RECORD_REQUIRED_FIELDS,
  SOURCE_REQUIRED_FIELDS,
  type RequiredFieldSpec,
} from '@/bibliography/vocab';
import type { RepositoryRecord, VerificationVerdict } from '@/model/repository-record';
import type { Source } from '@/model/source';

/**
 * The shared DETERMINISTIC repository-verification function (T016/T017,
 * FR-006-008, D-03/D-04). A PURE function producing a verdict from a member
 * `Source`, its ALREADY-SELECTED `RepositoryRecord` (see
 * `@/sourcegroup/record-select`), an injected ark resolver, and an injected
 * set of existing members. It makes NO research/relevance judgment -- there
 * is deliberately no `relevance` field on the verdict.
 *
 * This same function is reused by both the `verify-member` command (T022) and
 * `promote`'s rerun verification (T025), so the two can never diverge.
 *
 * All I/O is injected (the ark resolver, the existing-member set) so the
 * function stays pure and testable without touching the network or the
 * filesystem.
 *
 * ADAPTER-AWARENESS (TASK-28): the two repository-specific checks
 * (`identifierResolved`, `rights`) DISPATCH by the record's copy-identifier
 * type (ark->Gallica, accession->museum; see `repositorySpecificChecks`), so
 * this one function verifies both a Gallica member and a museum member. The
 * injected `ArkResolver` is simply unused for an accession record.
 *
 * FLOW-ORDER NOTE: a museum member's `rights` check reads the
 * operator-recorded `record.rightsAssessment`, NOT an OAIRecord. Gallica gets
 * its rights from the OAIRecord at INVENTORY time, so a Gallica member's flow
 * is inventory -> verify-member -> promote. A museum member has no OAIRecord,
 * so its authoritative rights are authored by a SEPARATE `rights-assess` step
 * that MUST precede promote: the museum flow is
 * inventory -> rights-assess -> verify-member -> promote. Without the
 * intervening `rights-assess`, a museum member's `rights` check fails closed
 * (an absent `rightsAssessment` is a fail), so promote correctly aborts.
 */

/**
 * A resolved copy-level identifier. The verification function only cares
 * whether the ark resolves to SOMETHING (non-null) at the holding archive;
 * the resolved body itself is opaque here and left to callers.
 */
export interface ResolvedIdentifier {
  /** The ark that was resolved. */
  ark: string;
}

/**
 * Injected ark resolver: resolves a record's ark against the holding archive,
 * returning the resolved identifier or `null` when the ark does not resolve
 * (a dead ark). Injected -- rather than reaching out to the network directly
 * -- so this module stays a pure function and tests never hit the network
 * (FR-006, D-04).
 */
export type ArkResolver = (ark: string) => Promise<ResolvedIdentifier | null>;

/**
 * One existing member's dedup-relevant projection, injected as the
 * duplicate-lookup set. Carries only what the duplicate checks compare
 * against -- the owning member's `sourceId` (to exclude the member being
 * verified from colliding with its own record), the copy's `ark` +
 * `sourceArchive`, and the normalized `title`/`creator`/`date` used for the
 * soft (possible) duplicate signal.
 */
export interface ExistingMemberRecord {
  /** The owning member's Source id -- used to exclude self from the hard-duplicate check. */
  sourceId: string;
  /** The copy's ark. */
  ark: string;
  /** The copy's holding archive. */
  sourceArchive: string;
  /** The member's title, for the possible-duplicate signal. */
  title?: string;
  /** The member's creator, for the possible-duplicate signal. */
  creator?: string;
  /** The member's normalized publication date, for the possible-duplicate signal. */
  date?: string;
}

/**
 * Input to {@link verifyMember}. Carries the member, its already-selected
 * record, the injected ark resolver, and the injected existing-member set the
 * duplicate checks run against.
 */
export interface VerifyMemberInput {
  /** The member `Source` being verified. */
  member: Source;
  /** The ALREADY-SELECTED `RepositoryRecord` (selection happens upstream). */
  record: RepositoryRecord;
  /** Injected ark resolver (no direct network access from this module). */
  resolveArk: ArkResolver;
  /** The injected set of existing members to check duplicates against. */
  existingMembers: readonly ExistingMemberRecord[];
  /**
   * The member's normalized publication date, passed explicitly because a
   * `Source` carries no date field. Absent when the member has no known date;
   * the possible-duplicate check then compares title/creator only.
   */
  candidateDate?: string;
}

/**
 * The verdict returned by {@link verifyMember}: the per-check outcomes
 * (structurally identical to the model's `VerificationVerdict['checks']`)
 * plus the overall hard-gate `result`.
 *
 * `result` is `'passed'` only when EVERY hard check passes. A
 * `possibleDuplicate` of `'review-required'` is a SOFT signal that is
 * surfaced but does NOT by itself fail the hard gate -- the caller decides
 * what to do with it (D-03). `verifyMember` may therefore return
 * `result: 'passed'` with `possibleDuplicate: 'review-required'`.
 */
export interface MemberVerdict {
  /** `'passed'` only when every HARD check passes; `possibleDuplicate` is not a hard check. */
  result: 'passed' | 'failed';
  /** Per-check outcomes, matching `VerificationVerdict['checks']`. */
  checks: VerificationVerdict['checks'];
}

/** Widen an object to a string-keyed record without a cast, for field lookup. */
function toRecord(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = val;
  }
  return out;
}

/** True when a required field is present (and, for arrays/strings, non-empty). */
function fieldPresent(view: Record<string, unknown>, spec: RequiredFieldSpec): boolean {
  const value = view[spec.field];
  if (value === undefined || value === null) {
    return false;
  }
  if (spec.nonEmptyArray) {
    return Array.isArray(value) && value.length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

/** True when every required field in `specs` is present on `subject`. */
function allRequiredPresent(subject: object, specs: readonly RequiredFieldSpec[]): boolean {
  const view = toRecord(subject);
  return specs.every((spec) => fieldPresent(view, spec));
}

/** Normalize free text for comparison; `undefined`/blank collapse to `undefined`. */
function normalizeText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normalized.length === 0 ? undefined : normalized;
}

/** Normalize an ark for comparison (trim only; arks are otherwise significant). */
function normalizeArk(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Two optional fields "match" when both are absent, or both are present and
 * normalize equal. Used for the creator/date arms of the possible-duplicate
 * signal, where an absent-on-both field should not veto an otherwise-matching
 * title.
 */
function optionalMatch(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === undefined && nb === undefined) {
    return true;
  }
  return na !== undefined && nb !== undefined && na === nb;
}

/** The record's ark value (the first `ark`-typed copy identifier), if any. */
function arkOf(record: RepositoryRecord): string | undefined {
  const identifier = (record.identifiers ?? []).find((id) => id.type === 'ark');
  return identifier?.value;
}

/** The record's accession value (the first `accession`-typed copy identifier), if any. */
function accessionOf(record: RepositoryRecord): string | undefined {
  const identifier = (record.identifiers ?? []).find((id) => id.type === 'accession');
  return identifier?.value;
}

/** A trimmed non-empty string, or `undefined` when absent/blank. */
function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The pass/fail outcomes of the two repository-specific checks. */
interface RepositoryChecks {
  identifierResolved: 'passed' | 'failed';
  rights: 'passed' | 'failed';
}

/**
 * Dispatch the TWO repository-specific checks -- `identifierResolved` and
 * `rights` -- by the record's copy-identifier type (composition, not an
 * inheritance hierarchy: a small branch keyed on identifier type, mirroring
 * how the acquire registry dispatches ark->gallica / accession->museum). The
 * other three checks (`requiredMetadata`, `hardDuplicate`, `possibleDuplicate`)
 * are repository-agnostic and are NOT dispatched here.
 *
 * - `ark` copy identifier (Gallica): UNCHANGED. `identifierResolved` runs the
 *   injected {@link ArkResolver} against the ark (a dead ark fails); `rights`
 *   passes when the OAIRecord `record.rights?.status === 'public-domain'`.
 * - `accession` copy identifier (museum): a verify check must be CHEAP and
 *   DETERMINISTIC, so `identifierResolved` does NOT re-fetch/re-run the museum
 *   engine -- it passes when the record carries a non-empty `accession` value
 *   AND a non-empty `sourceUrl` (both set + confirmed at inventory time by the
 *   museum adapter's resolve). `rights` reads the operator-authored
 *   `record.rightsAssessment?.rightsStatus === 'public-domain'`; it fails
 *   CLOSED otherwise (restricted / uncertain / absent all fail).
 * - NEITHER supported identifier: both checks fail (never silently pass) --
 *   an unsupported record cannot be verified.
 */
async function repositorySpecificChecks(
  record: RepositoryRecord,
  resolveArk: ArkResolver,
): Promise<RepositoryChecks> {
  const ark = normalizeArk(arkOf(record));
  if (ark !== undefined) {
    // Gallica (ark) path -- UNCHANGED from the original Gallica-hardwired logic.
    return {
      identifierResolved: (await resolveArk(ark)) !== null ? 'passed' : 'failed',
      rights: record.rights?.status === 'public-domain' ? 'passed' : 'failed',
    };
  }

  const accession = nonEmpty(accessionOf(record));
  if (accession !== undefined) {
    // Museum (accession) path. identifierResolved is a cheap, deterministic
    // check on already-inventoried state -- accession value + sourceUrl both
    // present -- never a re-fetch. rights fails closed unless the
    // operator-authored assessment says public-domain.
    return {
      identifierResolved: nonEmpty(record.sourceUrl) !== undefined ? 'passed' : 'failed',
      rights: record.rightsAssessment?.rightsStatus === 'public-domain' ? 'passed' : 'failed',
    };
  }

  // Neither a supported ark nor accession copy identifier -> fail both checks
  // (fail-closed; an unsupported record is never silently passed).
  return { identifierResolved: 'failed', rights: 'failed' };
}

/**
 * hardDuplicate: the same ark held at the same `sourceArchive` by ANOTHER
 * member is a hard duplicate (FR-008). The member's own record (matched by
 * `sourceId`) is excluded so it never collides with itself. A record with no
 * ark cannot hard-collide, so it passes.
 */
function checkHardDuplicate(
  candidateArk: string | undefined,
  record: RepositoryRecord,
  member: Source,
  existing: readonly ExistingMemberRecord[],
): 'passed' | 'failed' {
  if (candidateArk === undefined) {
    return 'passed';
  }
  const collides = existing.some(
    (e) =>
      e.sourceId !== member.sourceId &&
      normalizeArk(e.ark) === candidateArk &&
      e.sourceArchive === record.sourceArchive,
  );
  return collides ? 'failed' : 'passed';
}

/**
 * possibleDuplicate: a DIFFERENT ark whose normalized title (and, when
 * present, creator/date) matches the candidate is a SOFT duplicate flagged
 * for human review, NOT a hard failure (FR-008, D-03). Requires a candidate
 * title to signal at all (an untitled candidate produces no soft signal).
 */
function checkPossibleDuplicate(
  candidateArk: string | undefined,
  candidateTitle: string | undefined,
  candidateCreator: string | undefined,
  candidateDate: string | undefined,
  existing: readonly ExistingMemberRecord[],
): 'passed' | 'review-required' {
  if (candidateTitle === undefined) {
    return 'passed';
  }
  const flagged = existing.some((e) => {
    if (normalizeArk(e.ark) === candidateArk) {
      // Same ark -> a hard duplicate concern, not a soft one.
      return false;
    }
    return (
      normalizeText(e.title) === candidateTitle &&
      optionalMatch(candidateCreator, e.creator) &&
      optionalMatch(candidateDate, e.date)
    );
  });
  return flagged ? 'review-required' : 'passed';
}

/** Fail loud on structurally malformed input before running any check. */
function assertWellFormed(input: VerifyMemberInput): void {
  if (input === null || typeof input !== 'object') {
    throw new Error('verifyMember: input is required.');
  }
  if (input.member === undefined || input.member === null) {
    throw new Error('verifyMember: input.member is required.');
  }
  if (input.record === undefined || input.record === null) {
    throw new Error('verifyMember: input.record is required.');
  }
  if (typeof input.resolveArk !== 'function') {
    throw new Error('verifyMember: input.resolveArk must be an injected resolver function.');
  }
  if (!Array.isArray(input.existingMembers)) {
    throw new Error('verifyMember: input.existingMembers must be an array.');
  }
}

/**
 * Run the deterministic repository-verification checks and produce a
 * {@link MemberVerdict}. Pure and async only because the ark resolver is
 * async; no direct I/O.
 *
 * Checks (all deterministic):
 * - `identifierResolved`: dispatched by copy-identifier type -- an `ark`
 *   record resolves via the injected resolver (Gallica, UNCHANGED); an
 *   `accession` record passes when it carries a non-empty accession value AND
 *   a non-empty `sourceUrl` (museum; no re-fetch). See
 *   `repositorySpecificChecks`.
 * - `rights`: dispatched by copy-identifier type -- an `ark` record's
 *   `rights.status` (Gallica OAIRecord, UNCHANGED); an `accession` record's
 *   operator-authored `rightsAssessment.rightsStatus` (museum, fail-closed).
 * - `requiredMetadata`: required member/record fields are present.
 * - `hardDuplicate`: same ark at same archive as another member -> `failed`.
 * - `possibleDuplicate`: matching title/creator/date, DIFFERENT ark ->
 *   `review-required` (a soft signal that does NOT fail the hard gate).
 */
export async function verifyMember(input: VerifyMemberInput): Promise<MemberVerdict> {
  assertWellFormed(input);

  const { member, record, existingMembers } = input;
  const candidateArk = normalizeArk(arkOf(record));

  // The two repository-specific checks dispatch by copy-identifier type
  // (ark->Gallica, accession->museum); see `repositorySpecificChecks`. The
  // remaining three checks below are repository-agnostic.
  const { identifierResolved, rights } = await repositorySpecificChecks(
    record,
    input.resolveArk,
  );

  const requiredMetadata =
    allRequiredPresent(member, SOURCE_REQUIRED_FIELDS) &&
    allRequiredPresent(record, REPOSITORY_RECORD_REQUIRED_FIELDS)
      ? 'passed'
      : 'failed';

  const hardDuplicate = checkHardDuplicate(candidateArk, record, member, existingMembers);

  const possibleDuplicate = checkPossibleDuplicate(
    candidateArk,
    normalizeText(member.titles[0]?.text),
    member.creator,
    input.candidateDate,
    existingMembers,
  );

  const checks: VerificationVerdict['checks'] = {
    identifierResolved,
    rights,
    requiredMetadata,
    hardDuplicate,
    possibleDuplicate,
  };

  // The hard gate: possibleDuplicate is surfaced but NEVER fails the gate.
  const result =
    identifierResolved === 'passed' &&
    rights === 'passed' &&
    requiredMetadata === 'passed' &&
    hardDuplicate === 'passed'
      ? 'passed'
      : 'failed';

  return { result, checks };
}
