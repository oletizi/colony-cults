/**
 * `bib verify-member <id> [--archive <sourceArchive>]` command wrapper
 * (T021/T022, FR-006-009a, US2). A THIN, READ-ONLY layer: it loads the
 * member, selects the target `RepositoryRecord` via
 * `@/sourcegroup/record-select`, builds the injected ark resolver + the
 * existing-members duplicate-lookup set, and runs the SHARED deterministic
 * verification function from `@/sourcegroup/verify-member` -- the same
 * function `promote` (T025) reruns, so the two can never diverge. This
 * module makes NO status change and NO relevance judgment; it only prints a
 * verdict.
 *
 * The real ark resolver (an OAI/SRU resolve) does not exist yet -- it is
 * injected here (`resolveArk`) so this module stays swappable/testable
 * without a network dependency. Likewise `loadMembers` is injected so tests
 * can exercise the fail-loud paths (member missing, ambiguous copy) without
 * touching the filesystem, while still supporting the real `loadAllSources`
 * against real fixture directories for an end-to-end path. Wiring the real
 * dependencies into `bib verify-member` is a separate task (T023) that edits
 * `src/cli/bibliography.ts`; this module is deliberately silent on argv
 * parsing.
 *
 * Exit-code semantics (resolves the T022 open item): a verdict -- pass OR
 * fail -- is DATA, not an error, so producing one always exits `0`. Only a
 * TOOLING failure (member missing, ambiguous copy with no `--archive`, or the
 * injected resolver itself throwing, e.g. a network error) is non-zero, and
 * that failure is surfaced verbatim, never swallowed.
 */

import type { LoadedSource } from '@/bibliography/load';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import { authoredToRepositoryRecord } from '@/bibliography/authored-record';
import { describeError } from '@/bibliography/load-primitives';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { verifyMember } from '@/sourcegroup/verify-member';
import type { ArkResolver, ExistingMemberRecord, MemberVerdict } from '@/sourcegroup/verify-member';
import type { RepositoryRecord } from '@/model/repository-record';

/** Injected member loader: reads every SSOT member from `sourcesDir` (e.g. `@/bibliography/load`'s `loadAllSources`, or a fake for tests). */
export type LoadMembers = (sourcesDir: string) => readonly LoadedSource[];

/** Input to {@link runVerifyMember}. */
export interface RunVerifyMemberInput {
  /** The member `sourceId` to verify, e.g. `PB-P007`. */
  id: string;
  /** `--archive <sourceArchive>`: selects one copy when the member has more than one RepositoryRecord. */
  archive?: string;
  /** `--json`: emit the verdict as JSON instead of the human table. */
  json?: boolean;
  /** The `bibliography/sources` directory `loadMembers` reads from. */
  sourcesDir: string;
  /** Injected member loader (swappable/testable; see module docs). */
  loadMembers: LoadMembers;
  /** Injected ark resolver (swappable/testable; see module docs). */
  resolveArk: ArkResolver;
  /** Output sink for the human/JSON verdict; defaults to `console.log`. */
  writeOut?: (line: string) => void;
  /** Output sink for fail-loud error messages; defaults to `console.error`. */
  writeErr?: (line: string) => void;
}

/** Result of {@link runVerifyMember}. */
export interface RunVerifyMemberResult {
  /** `0` when a verdict was produced (pass or fail is data); non-zero on a tooling error. */
  exitCode: number;
  /** The produced verdict; absent on a tooling error (member missing, ambiguous copy, resolver failure). */
  verdict?: MemberVerdict;
  /** The fail-loud message, present only when `exitCode !== 0`. */
  error?: string;
}

/** The record's ark value (the first `ark`-typed copy identifier), if any. */
function arkOf(record: AuthoredRepositoryRecord): string | undefined {
  return record.identifiers?.find((identifier) => identifier.type === 'ark')?.value;
}

/**
 * Build the existing-members duplicate-lookup set the shared `verifyMember`
 * compares against (FR-008): one {@link ExistingMemberRecord} per OTHER
 * member's copy that carries an ark (a record with no ark cannot participate
 * in either duplicate check, and `ExistingMemberRecord.ark` is mandatory).
 * The member being verified is excluded up front so it can never collide
 * with its own copies.
 */
export function buildExistingMembers(
  members: readonly LoadedSource[],
  excludeSourceId: string,
): ExistingMemberRecord[] {
  const existing: ExistingMemberRecord[] = [];
  for (const loaded of members) {
    if (loaded.source.sourceId === excludeSourceId) {
      continue;
    }
    for (const authored of loaded.records) {
      const ark = arkOf(authored);
      if (ark === undefined) {
        continue;
      }
      existing.push({
        sourceId: loaded.source.sourceId,
        ark,
        sourceArchive: authored.sourceArchive,
        title: loaded.source.titles[0]?.text,
        creator: loaded.source.creator,
      });
    }
  }
  return existing;
}

/** Render a verdict as human-readable lines. */
function formatVerdict(id: string, record: RepositoryRecord, verdict: MemberVerdict): string[] {
  const lines = [
    `bib verify-member ${id} (${record.sourceArchive}): ${verdict.result}`,
    'checks:',
  ];
  for (const [check, outcome] of Object.entries(verdict.checks)) {
    lines.push(`  ${check}: ${outcome}`);
  }
  return lines;
}

/** Locate a loaded member by `sourceId`; `undefined` on a lookup miss. */
function findMember(members: readonly LoadedSource[], id: string): LoadedSource | undefined {
  return members.find((loaded) => loaded.source.sourceId === id);
}

/**
 * `bib verify-member <id> [--archive <sourceArchive>]`: a thin, read-only
 * wrapper around the shared deterministic verification function. See module
 * docs for the exit-code semantics this resolves (T022 open item).
 */
export async function runVerifyMember(input: RunVerifyMemberInput): Promise<RunVerifyMemberResult> {
  const writeOut = input.writeOut ?? ((line: string) => console.log(line));
  const writeErr = input.writeErr ?? ((line: string) => console.error(line));

  const fail = (message: string): RunVerifyMemberResult => {
    const error = `bib verify-member: ${message}`;
    writeErr(error);
    return { exitCode: 1, error };
  };

  let members: readonly LoadedSource[];
  try {
    members = input.loadMembers(input.sourcesDir);
  } catch (error) {
    return fail(describeError(error));
  }

  const member = findMember(members, input.id);
  if (member === undefined) {
    return fail(`member "${input.id}" not found in ${input.sourcesDir}.`);
  }

  let record: RepositoryRecord;
  try {
    const candidates = member.records.map((authored) =>
      authoredToRepositoryRecord(member.source.sourceId, authored),
    );
    // (sourceId, sourceArchive) is unique within one member's authored
    // records (loadSourceFile rule 5), so this selection is exactly the
    // widened-and-back-narrowed record -- no re-lookup needed.
    record = selectRepositoryRecord(candidates, input.archive);
  } catch (error) {
    return fail(describeError(error));
  }

  const existingMembers = buildExistingMembers(members, member.source.sourceId);

  let verdict: MemberVerdict;
  try {
    verdict = await verifyMember({
      member: member.source,
      record,
      resolveArk: input.resolveArk,
      existingMembers,
    });
  } catch (error) {
    return fail(describeError(error));
  }

  if (input.json === true) {
    writeOut(JSON.stringify({ id: input.id, sourceArchive: record.sourceArchive, ...verdict }, null, 2));
  } else {
    writeOut(formatVerdict(input.id, record, verdict).join('\n'));
  }

  return { exitCode: 0, verdict };
}
