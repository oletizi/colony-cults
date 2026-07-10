import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { Source } from '@/model/source';

/**
 * `exclude-member` (T026/T027, FR-013): the terminal path for a discovered
 * source-group candidate that will not be acquired -- `discovered ->
 * excluded`, with the operator-supplied reason recorded.
 *
 * The `Source` model has no dedicated exclusion-reason field (see
 * `@/model/source`); per the task brief this records the reason in the
 * source's free-text `notes` (appending an `excluded: <reason>` line) rather
 * than adding a model field, since `notes` already exists for exactly this
 * kind of free-text provenance and a model change is unwarranted for one
 * string.
 *
 * Reconsidering an excluded member back into the pipeline is a separate,
 * explicit operation (contracts/cli-commands.md) and is out of scope here --
 * this module only ever advances `discovered -> excluded`.
 */

/** Input to {@link runExcludeMember}. */
export interface ExcludeMemberInput {
  /** Directory holding the one-file-per-source SSOT (`bibliography/sources`). */
  sourcesDir: string;
  /** The member's `sourceId` (e.g. `PB-P100`). */
  sourceId: string;
  /** The operator-supplied exclusion reason; must be non-empty (FR-013). */
  reason: string;
}

/** Result of a successful exclusion. */
export interface ExcludeMemberResult {
  /** The excluded member's `sourceId`. */
  sourceId: string;
  /** Always `'excluded'` -- returned only on success. */
  status: 'excluded';
  /** The reason recorded, exactly as supplied (trimmed). */
  reason: string;
}

/** Fail loud on structurally malformed input before touching the filesystem. */
function assertWellFormed(input: ExcludeMemberInput): void {
  if (input === null || typeof input !== 'object') {
    throw new Error('runExcludeMember: input is required.');
  }
  if (typeof input.sourcesDir !== 'string' || input.sourcesDir.trim().length === 0) {
    throw new Error('runExcludeMember: input.sourcesDir is required.');
  }
  if (typeof input.sourceId !== 'string' || input.sourceId.trim().length === 0) {
    throw new Error('runExcludeMember: input.sourceId is required.');
  }
  if (typeof input.reason !== 'string') {
    throw new Error('runExcludeMember: input.reason is required.');
  }
}

/**
 * Append an `excluded: <reason>` line to `existingNotes`, preserving any
 * prior free text rather than clobbering it. Absent/blank existing notes
 * collapse to just the new line.
 */
function appendExclusionNote(existingNotes: string | undefined, reason: string): string {
  const line = `excluded: ${reason}`;
  if (existingNotes === undefined || existingNotes.trim().length === 0) {
    return line;
  }
  return `${existingNotes}\n${line}`;
}

/**
 * Advance one source-group member `discovered -> excluded`, recording the
 * operator-supplied reason.
 *
 * Fails loud (throws) on:
 * - malformed input (missing `sourcesDir` / `sourceId` / `reason`),
 * - an empty or whitespace-only `--reason` (FR-013),
 * - the member's SSOT file being missing/unreadable/malformed (surfaced
 *   verbatim from {@link loadSourceFile}),
 * - the member not currently being `status === 'discovered'` -- exclusion is
 *   an alternative terminal outcome of `discovered` only; a separate
 *   reconsideration operation handles `excluded -> pipeline` and is out of
 *   scope here.
 *
 * No write happens unless every precondition passes.
 */
export async function runExcludeMember(input: ExcludeMemberInput): Promise<ExcludeMemberResult> {
  assertWellFormed(input);

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new Error('runExcludeMember: --reason must be non-empty.');
  }

  const filePath = path.join(input.sourcesDir, `${input.sourceId}.yml`);
  const { source, records } = loadSourceFile(filePath);

  if (source.status !== 'discovered') {
    throw new Error(
      `runExcludeMember(${input.sourceId}): member status is ` +
        `"${source.status ?? '(none)'}", not "discovered" -- exclusion only applies to a ` +
        `discovered candidate (FR-013). Reconsidering an excluded member back into the ` +
        `pipeline is a separate, explicit operation.`,
    );
  }

  const excluded: Source = {
    ...source,
    status: 'excluded',
    notes: appendExclusionNote(source.notes, reason),
  };

  writeFileSync(filePath, serializeSource({ source: excluded, records }), 'utf-8');

  return { sourceId: source.sourceId, status: 'excluded', reason };
}
