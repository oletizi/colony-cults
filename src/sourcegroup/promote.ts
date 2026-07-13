import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { authoredToRepositoryRecord } from '@/bibliography/authored-record';
import { loadSourceFile, sourceKind } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import { isFetchableWork } from '@/bibliography/scope';
import type { VerificationVerdict } from '@/model/repository-record';
import type { Source } from '@/model/source';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import {
  verifyMember,
  type ArkResolver,
  type ExistingMemberRecord,
  type MemberVerdict,
} from '@/sourcegroup/verify-member';

/**
 * `promote` (T024/T025, US3): research approval of a discovered source-group
 * member. It RE-RUNS the shared deterministic verification (`verifyMember` --
 * the single verification code path, never re-implemented here), RECORDS the
 * verdict on the selected copy, and advances the lifecycle:
 *
 * ```
 * Source:            discovered -> approved-for-acquisition
 * RepositoryRecord:  wanted     -> to-collect
 * ```
 *
 * Authority + atomicity contract:
 * - Membership (`partOf`) is AUTHORITATIVE and is NEVER set or altered here
 *   (FR-011). A `--group` flag is assertion-only: it may equal the existing
 *   `partOf` (proceed) or fail loud on mismatch -- it can never write it.
 * - The write is ATOMIC-on-success: every precondition, the copy selection,
 *   and the full rerun verification happen IN MEMORY first; the single
 *   `writeFileSync` runs only after a passing verdict. Any failing hard check
 *   (or any precondition failure) throws BEFORE that write, so an abort
 *   records nothing and changes no status -- there is no partial-write path.
 *
 * All verification I/O is injected (`resolveArk`, `existingMembers`) and the
 * recorded verdict's timestamp is injected (`verifiedAt`) -- no `Date.now()`
 * -- so callers and tests stay deterministic and never touch the network.
 *
 * See specs/006-source-group-acquisition/contracts/cli-commands.md
 * (`bib promote`) and data-model.md § VerificationVerdict (D-03).
 */

/** Input to {@link runPromote}. */
export interface PromoteInput {
  /** Directory holding the one-file-per-source SSOT (`bibliography/sources`). */
  sourcesDir: string;
  /** The member's `sourceId` (e.g. `PB-P100`). */
  sourceId: string;
  /** `--archive`: selects one copy when the member has more than one record (infer-one otherwise). */
  archive?: string;
  /**
   * `--group`: ASSERTION-ONLY. When present it must equal the member's
   * existing `partOf` or the call fails loud -- it never sets/alters
   * membership (FR-011).
   */
  group?: string;
  /** Injected ark resolver for the rerun verification (no direct network access). */
  resolveArk: ArkResolver;
  /** Injected duplicate-lookup set the rerun verification's duplicate checks run against. */
  existingMembers: readonly ExistingMemberRecord[];
  /** Injected ISO timestamp recorded as the verdict's `verifiedAt` (deterministic; no `Date.now()`). */
  verifiedAt: string;
  /** The member's normalized publication date for the possible-duplicate check, when known. */
  candidateDate?: string;
}

/** Result of a successful promotion. */
export interface PromoteResult {
  /** The promoted member's `sourceId`. */
  sourceId: string;
  /** The `sourceArchive` of the selected (and now `to-collect`) copy. */
  sourceArchive: string;
  /** Always `'approved-for-acquisition'` -- returned only on success. */
  status: 'approved-for-acquisition';
  /** Always `'to-collect'` -- the selected RepositoryRecord's advanced status. */
  recordStatus: 'to-collect';
  /** The passing verdict from the rerun verification (recorded on the copy). */
  verdict: MemberVerdict;
}

/** Fail loud on structurally malformed input before touching the filesystem. */
function assertWellFormed(input: PromoteInput): void {
  if (input === null || typeof input !== 'object') {
    throw new Error('runPromote: input is required.');
  }
  if (typeof input.sourcesDir !== 'string' || input.sourcesDir.trim().length === 0) {
    throw new Error('runPromote: input.sourcesDir is required.');
  }
  if (typeof input.sourceId !== 'string' || input.sourceId.trim().length === 0) {
    throw new Error('runPromote: input.sourceId is required.');
  }
  if (typeof input.resolveArk !== 'function') {
    throw new Error('runPromote: input.resolveArk must be an injected resolver function.');
  }
  if (!Array.isArray(input.existingMembers)) {
    throw new Error('runPromote: input.existingMembers must be an array.');
  }
  if (typeof input.verifiedAt !== 'string' || input.verifiedAt.trim().length === 0) {
    throw new Error('runPromote: input.verifiedAt (injected timestamp) is required.');
  }
}

/** The names of the HARD checks that failed, for a loud, specific abort message. */
function failedCheckNames(verdict: MemberVerdict): string[] {
  const failed: string[] = [];
  for (const [name, outcome] of Object.entries(verdict.checks)) {
    // `possibleDuplicate: 'review-required'` is a SOFT signal, not a hard
    // failure -- only `'failed'` outcomes abort the promotion.
    if (outcome === 'failed') {
      failed.push(name);
    }
  }
  return failed;
}

/**
 * Confirm the member's existing `partOf` resolves to a valid `source-group`
 * (FR-011). `partOf` is authoritative -- this only READS it. A `--group` flag,
 * when present, is asserted equal to it and never written.
 */
function resolvePartOfGroup(source: Source, input: PromoteInput): string {
  const partOf = source.partOf;
  if (partOf === undefined) {
    throw new Error(
      `runPromote(${input.sourceId}): member has no partOf -- promotion requires ` +
        `membership in a source-group (FR-011).`,
    );
  }

  // `--group` is assertion-only: it may confirm the existing partOf, never change it.
  if (input.group !== undefined && input.group !== partOf) {
    throw new Error(
      `runPromote(${input.sourceId}): --group "${input.group}" does not match the member's ` +
        `existing partOf "${partOf}". promote never sets or alters membership (FR-011) -- ` +
        `--group is an assertion that must equal the existing partOf.`,
    );
  }

  const groupKind = sourceKind(partOf, input.sourcesDir);
  if (groupKind === undefined) {
    throw new Error(
      `runPromote(${input.sourceId}): partOf "${partOf}" does not resolve to any source in ` +
        `"${input.sourcesDir}" -- membership is unresolved.`,
    );
  }
  if (groupKind !== 'source-group') {
    throw new Error(
      `runPromote(${input.sourceId}): partOf "${partOf}" resolves to a "${groupKind}", ` +
        `not a source-group -- membership is invalid (FR-011).`,
    );
  }

  return partOf;
}

/**
 * Promote one discovered source-group member: rerun verification, record the
 * verdict, advance the Source and the selected RepositoryRecord.
 *
 * Fails loud (throws) and writes NOTHING on any of:
 * - malformed input,
 * - the member's SSOT file being missing/unreadable/malformed,
 * - the target NOT being a fetchable work (`isFetchableWork`, FR-007,
 *   INV-APPROVE, INV-3) -- a source-group (work-bundle) is rejected loud,
 * - the member not currently `status === 'discovered'` (FR-013 alternatives),
 * - an absent/unresolved `partOf`, or a `--group` mismatch (FR-011),
 * - an ambiguous copy with no `--archive` (FR-009a),
 * - the selected copy carrying no `metadataSnapshot` to tie the verdict to,
 * - ANY hard verification check failing on the rerun (FR-010a) -- the abort
 *   names the failed check(s).
 */
export async function runPromote(input: PromoteInput): Promise<PromoteResult> {
  assertWellFormed(input);

  const filePath = path.join(input.sourcesDir, `${input.sourceId}.yml`);
  if (!existsSync(filePath)) {
    throw new Error(`runPromote(${input.sourceId}): no SSOT file at "${filePath}" -- member not found.`);
  }

  const { source, records } = loadSourceFile(filePath);

  // Approval applies ONLY to a fetchable work (FR-007, INV-APPROVE, INV-3) --
  // a work-bundle (`kind: 'source-group'`) is rejected loud here, on the
  // single explicit `isFetchableWork` predicate, independent of its `status`
  // or group membership. This is the container prohibition; it is checked
  // BEFORE the `discovered` precondition below so a group is never
  // misdiagnosed by an unrelated check.
  if (!isFetchableWork(source)) {
    throw new Error(
      `runPromote(${input.sourceId}): "${input.sourceId}" is a source-group (work-bundle), ` +
        `not a fetchable work -- a container is never approved-for-acquisition and can never ` +
        `be promoted (FR-007, INV-3).`,
    );
  }

  // Precondition: only a discovered candidate is promotable (FR-013 -- an
  // alternative terminal outcome, not a chain).
  if (source.status !== 'discovered') {
    throw new Error(
      `runPromote(${input.sourceId}): member status is "${source.status ?? '(none)'}", not ` +
        `"discovered" -- promotion only applies to a discovered candidate.`,
    );
  }

  // Membership is authoritative: confirm partOf resolves to a source-group and
  // assert any --group flag against it. Never written.
  resolvePartOfGroup(source, input);

  // Select the copy (infer-one / fail-loud ambiguity, FR-009a).
  const converted = records.map((authored) => authoredToRepositoryRecord(input.sourceId, authored));
  const selected = selectRepositoryRecord(converted, input.archive);
  const selectedIndex = converted.indexOf(selected);
  const selectedAuthored = records[selectedIndex];

  // Re-run the SHARED deterministic verification (FR-010a). Same code path as
  // `verify-member` -- never re-implemented here.
  const verdict = await verifyMember({
    member: source,
    record: selected,
    resolveArk: input.resolveArk,
    existingMembers: input.existingMembers,
    candidateDate: input.candidateDate,
  });

  // Any hard-check failure ABORTS: record nothing, change no status (FR-010a).
  if (verdict.result !== 'passed') {
    const failed = failedCheckNames(verdict);
    throw new Error(
      `runPromote(${input.sourceId}): rerun verification failed -- aborting with no changes. ` +
        `Failed check(s): ${failed.join(', ')}.`,
    );
  }

  // The verdict is tied to the copy's metadata snapshot as evidence (D-03).
  const snapshot = selectedAuthored.metadataSnapshot;
  if (snapshot === undefined) {
    throw new Error(
      `runPromote(${input.sourceId}): selected copy "${selected.sourceArchive}" has no ` +
        `metadataSnapshot -- a recorded verdict must reference the evidence it was computed ` +
        `against (D-03).`,
    );
  }

  const verification: VerificationVerdict = {
    result: 'passed',
    verifiedAt: input.verifiedAt,
    checks: verdict.checks,
    snapshotRef: snapshot.path,
  };

  // Build the advanced state in memory, then perform the SINGLE write. partOf
  // is preserved by the spread -- membership is never touched (FR-011).
  const promotedRecords = records.map((authored, index) =>
    index === selectedIndex
      ? { ...authored, status: 'to-collect', verification }
      : authored,
  );
  const promotedSource: Source = { ...source, status: 'approved-for-acquisition' };

  writeFileSync(
    filePath,
    serializeSource({ source: promotedSource, records: promotedRecords }),
    'utf-8',
  );

  return {
    sourceId: source.sourceId,
    sourceArchive: selected.sourceArchive,
    status: 'approved-for-acquisition',
    recordStatus: 'to-collect',
    verdict,
  };
}
