/**
 * Core logic for `bib rights-assess <sourceId>` (T018, specs/011-museum-
 * acquisition-path). Two independent operations share the record-selection
 * plumbing, split purely on caller intent (never on record state):
 *
 *  - {@link reviewRightsEvidence} (no `--status`): resolves the selected
 *    copy through its dispatched `RepositoryAdapter` and surfaces the
 *    adapter-PROPOSED `RightsEvidence` (the grounded `date` + its
 *    interpretation + evidence excerpt, any `rightsRaw`/credit) for the
 *    operator to review. Writes NOTHING (FR-008).
 *  - {@link recordRightsAssessment} (`--status <...> --basis "<...>"`):
 *    writes the OPERATOR's authoritative `RightsAssessment` onto the
 *    selected `RepositoryRecord` and persists it to the SSOT. The adapter
 *    is NEVER consulted here -- the operator's flags are the sole source of
 *    the recorded judgment, and `assessedBy` is always the literal
 *    `'operator'`, never a model/automated value.
 *
 * Both operations select the copy the same way `bib promote` does
 * (`selectRepositoryRecord`, `@/sourcegroup/record-select`): a member with
 * exactly one `RepositoryRecord` needs no `--archive`; more than one requires
 * it, failing loud (naming the available archives) otherwise.
 *
 * See specs/011-museum-acquisition-path/data-model.md § RightsAssessment and
 * contracts/repository-adapter.md INV-B.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import { authoredToRepositoryRecord } from '@/bibliography/authored-record';
import { loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { RightsEvidence } from '@/repository/adapter';
import type { RepositoryAdapterRegistry } from '@/repository/registry';
import type { RepositoryRecord } from '@/model/repository-record';
import type { RightsAssessment } from '@/model/rights';
import type { Source } from '@/model/source';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';

/** Identity of the copy a review/write operation acted on. */
export interface AssessedCopy {
  sourceId: string;
  sourceArchive: string;
}

const RIGHTS_STATUS_VALUES: ReadonlySet<string> = new Set([
  'public-domain',
  'restricted',
  'uncertain',
]);

function isRightsAssessmentStatus(value: string): value is RightsAssessment['rightsStatus'] {
  return RIGHTS_STATUS_VALUES.has(value);
}

/** Load one SSOT source file's `source` + authored `records` by `sourceId`. */
function loadRecordFile(
  sourcesDir: string,
  sourceId: string,
): { filePath: string; source: Source; records: AuthoredRepositoryRecord[] } {
  const filePath = path.join(sourcesDir, `${sourceId}.yml`);
  const { source, records } = loadSourceFile(filePath);
  return { filePath, source, records };
}

/**
 * Select one copy by `--archive` (or infer-one), returning both the widened
 * `RepositoryRecord` (what the adapter/registry seam consumes) and the index
 * into `records` it came from (so a write can target it precisely).
 */
function selectAuthored(
  sourceId: string,
  records: readonly AuthoredRepositoryRecord[],
  archive: string | undefined,
): { selectedIndex: number; selected: RepositoryRecord } {
  const converted = records.map((authored) => authoredToRepositoryRecord(sourceId, authored));
  const selected = selectRepositoryRecord(converted, archive);
  const selectedIndex = converted.indexOf(selected);
  return { selectedIndex, selected };
}

/** Input to {@link reviewRightsEvidence}. */
export interface ReviewRightsEvidenceInput {
  /** Directory holding the one-file-per-source SSOT (`bibliography/sources`). */
  sourcesDir: string;
  /** The member's `sourceId` (e.g. `PB-P100`). */
  sourceId: string;
  /** `--archive`: selects one copy when the member has more than one record. */
  archive?: string;
  /** Injected `RepositoryAdapterRegistry` (INV-D: dispatch by copy identifier, never a locator sniff). */
  registry: RepositoryAdapterRegistry;
}

/** Result of {@link reviewRightsEvidence}: the adapter-proposed evidence; nothing written. */
export interface ReviewRightsEvidenceResult extends AssessedCopy {
  evidence: RightsEvidence;
}

/** Fail loud on structurally malformed input before touching the filesystem. */
function assertReviewInputWellFormed(input: ReviewRightsEvidenceInput): void {
  if (input === null || typeof input !== 'object') {
    throw new Error('reviewRightsEvidence: input is required.');
  }
  if (typeof input.sourcesDir !== 'string' || input.sourcesDir.trim().length === 0) {
    throw new Error('reviewRightsEvidence: input.sourcesDir is required.');
  }
  if (typeof input.sourceId !== 'string' || input.sourceId.trim().length === 0) {
    throw new Error('reviewRightsEvidence: input.sourceId is required.');
  }
  if (input.registry === null || typeof input.registry !== 'object') {
    throw new Error(
      'reviewRightsEvidence: input.registry (the injected RepositoryAdapterRegistry) is required.',
    );
  }
}

/**
 * Review mode (FR-008): surface the adapter's PROPOSED rights evidence for
 * one copy -- the grounded `date` (value + its model `interpretation` + the
 * evidence excerpt), any `rightsRaw`/credit -- so the operator can confirm
 * the interpretation before recording a judgment via
 * {@link recordRightsAssessment}. Writes NOTHING to the SSOT.
 *
 * Dispatches the adapter via `registry.selectForRecord` (never a locator-
 * shape sniff, INV-D) and resolves the copy from its recorded `sourceUrl`
 * -- fails loud when that is absent, since there is then nothing to
 * resolve.
 */
export async function reviewRightsEvidence(
  input: ReviewRightsEvidenceInput,
): Promise<ReviewRightsEvidenceResult> {
  assertReviewInputWellFormed(input);

  const { records } = loadRecordFile(input.sourcesDir, input.sourceId);
  const { selected } = selectAuthored(input.sourceId, records, input.archive);

  const adapter = input.registry.selectForRecord(selected);

  const sourceUrl = selected.sourceUrl;
  if (sourceUrl === undefined || sourceUrl.trim().length === 0) {
    throw new Error(
      `reviewRightsEvidence(${input.sourceId} @ ${selected.sourceArchive}): the record carries ` +
        'no sourceUrl -- nothing to resolve for rights evidence.',
    );
  }

  const item = await adapter.resolve({ repository: adapter.repository, value: sourceUrl }, {});
  const evidence = await adapter.collectRightsEvidence(item);

  return { sourceId: input.sourceId, sourceArchive: selected.sourceArchive, evidence };
}

/** Input to {@link recordRightsAssessment}. */
export interface RecordRightsAssessmentInput {
  /** Directory holding the one-file-per-source SSOT (`bibliography/sources`). */
  sourcesDir: string;
  /** The member's `sourceId` (e.g. `PB-P100`). */
  sourceId: string;
  /** `--archive`: selects one copy when the member has more than one record. */
  archive?: string;
  /**
   * `--status`, unvalidated at the CLI boundary; validated here against the
   * closed `public-domain | restricted | uncertain` vocab (fail loud, no
   * write on a bad value).
   */
  status: string;
  /**
   * `--basis`, REQUIRED and non-empty: a status may never be recorded
   * without a basis (fail loud, no write on missing/empty).
   */
  basis: string;
  /** `--jurisdiction`, e.g. `"AU"`. */
  jurisdiction?: string;
  /** `--rights-raw`, the verbatim stated rights/credit text (evidence). */
  rightsRaw?: string;
  /** Injected clock for `assessedAt`; defaults to wall clock. */
  now?: () => string;
}

/** Result of {@link recordRightsAssessment}: the persisted assessment + where it was written. */
export interface RecordRightsAssessmentResult extends AssessedCopy {
  assessment: RightsAssessment;
  filePath: string;
}

/** Fail loud on structurally malformed input before touching the filesystem. */
function assertWriteInputWellFormed(input: RecordRightsAssessmentInput): void {
  if (input === null || typeof input !== 'object') {
    throw new Error('recordRightsAssessment: input is required.');
  }
  if (typeof input.sourcesDir !== 'string' || input.sourcesDir.trim().length === 0) {
    throw new Error('recordRightsAssessment: input.sourcesDir is required.');
  }
  if (typeof input.sourceId !== 'string' || input.sourceId.trim().length === 0) {
    throw new Error('recordRightsAssessment: input.sourceId is required.');
  }
  if (typeof input.basis !== 'string' || input.basis.trim().length === 0) {
    throw new Error(
      `recordRightsAssessment(${input.sourceId}): --basis is required and must be non-empty -- ` +
        'a rights status may never be recorded without a basis.',
    );
  }
}

/**
 * Write mode (FR-008): record the OPERATOR's authoritative
 * {@link RightsAssessment} on the selected copy and persist it to the SSOT.
 * Fails loud -- and writes NOTHING -- when `basis` is missing/empty or
 * `status` is outside the closed vocabulary; every precondition is checked
 * BEFORE the single `writeFileSync` (no partial-write path).
 *
 * The adapter/registry is NEVER consulted: this is the one and only path
 * that sets `rightsAssessment.rightsStatus`, and the written status is
 * exactly `input.status` -- this function never derives or overrides it.
 * `assessedBy` is always the literal `'operator'`.
 */
export async function recordRightsAssessment(
  input: RecordRightsAssessmentInput,
): Promise<RecordRightsAssessmentResult> {
  assertWriteInputWellFormed(input);

  if (!isRightsAssessmentStatus(input.status)) {
    throw new Error(
      `recordRightsAssessment(${input.sourceId}): --status must be "public-domain", ` +
        `"restricted", or "uncertain" (got "${input.status}").`,
    );
  }

  const { filePath, source, records } = loadRecordFile(input.sourcesDir, input.sourceId);
  const { selectedIndex, selected } = selectAuthored(input.sourceId, records, input.archive);

  const now = input.now ?? (() => new Date().toISOString());
  const assessment: RightsAssessment = {
    rightsStatus: input.status,
    rightsBasis: input.basis.trim(),
    assessedBy: 'operator',
    assessedAt: now(),
  };
  if (input.rightsRaw !== undefined && input.rightsRaw.trim().length > 0) {
    assessment.rightsRaw = input.rightsRaw;
  }
  if (input.jurisdiction !== undefined && input.jurisdiction.trim().length > 0) {
    assessment.rightsJurisdiction = input.jurisdiction;
  }

  const updatedRecords = records.map((authored, index) =>
    index === selectedIndex ? { ...authored, rightsAssessment: assessment } : authored,
  );

  writeFileSync(filePath, serializeSource({ source, records: updatedRecords }), 'utf-8');

  return {
    sourceId: input.sourceId,
    sourceArchive: selected.sourceArchive,
    assessment,
    filePath,
  };
}
