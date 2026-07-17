/**
 * Core logic for `bib rights-assess <sourceId>` (T018, specs/011-museum-
 * acquisition-path). Two independent operations share the record-selection
 * plumbing, split purely on caller intent (never on record state):
 *
 *  - {@link reviewRightsEvidence} (no `--status`): reuses the grounded
 *    metadata `bib inventory` already persisted for the selected copy (its
 *    `metadataSnapshot`) and surfaces the adapter-PROPOSED `RightsEvidence`
 *    (the grounded `date` + its interpretation + evidence excerpt, any
 *    `rightsRaw`/credit) for the operator to review -- no page re-fetch, no
 *    re-run of the extraction engine. Writes NOTHING (FR-008).
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
import { describeError } from '@/bibliography/load-primitives';
import { loadSourceFile } from '@/bibliography/load';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { ResolvedRepositoryItem, RightsEvidence } from '@/repository/adapter';
import type { RepositoryAdapterRegistry } from '@/repository/registry';
import type { RepositoryRecord } from '@/model/repository-record';
import type { RightsAssessment } from '@/model/rights';
import type { Source } from '@/model/source';
import type { GroundedExtraction, GroundedField, MuseumItemFields } from '@/extraction/structured-extractor';
import { readSnapshot } from '@/sourcegroup/snapshot';
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

// --- Metadata-snapshot reuse (review mode never re-resolves) ---------------
//
// `bib inventory --repository` already ran the adapter's `resolve` once --
// fetching the item page AND running the (expensive, non-deterministic)
// codex LLM extraction -- and persisted the resulting `GroundedExtraction`
// verbatim as a metadata snapshot (`@/sourcegroup/snapshot`'s `writeSnapshot`,
// called with `raw: JSON.stringify(item.metadata)`, see
// `@/sourcegroup/museum-inventory`). Review mode reuses that persisted
// snapshot instead of calling `adapter.resolve` a second time: it fetches
// nothing and runs no engine call. These helpers parse the snapshot's raw
// JSON back into a `GroundedExtraction<MuseumItemFields>` with fail-loud
// validation of its shape (never a blind `as`-cast of parsed JSON).

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, context: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${context} must be a JSON object.`);
  }
  return value;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, context);
}

/** Validate one parsed `GroundedField<string>` (the museum schema's fields are all string-valued). */
function validateGroundedField(value: unknown, context: string): GroundedField<string> {
  const obj = requireObject(value, context);
  const fieldValue = requireString(obj.value, `${context}.value`);
  const evidenceObj = requireObject(obj.evidence, `${context}.evidence`);
  const excerpt = requireString(evidenceObj.excerpt, `${context}.evidence.excerpt`);
  const selector = optionalString(evidenceObj.selector, `${context}.evidence.selector`);
  const interpretation = requireString(obj.interpretation, `${context}.interpretation`);
  const provenanceObj = requireObject(obj.provenance, `${context}.provenance`);
  if (provenanceObj.modelAssisted !== true) {
    throw new Error(`${context}.provenance.modelAssisted must be exactly \`true\`.`);
  }
  const engine = requireString(provenanceObj.engine, `${context}.provenance.engine`);
  const model = requireString(provenanceObj.model, `${context}.provenance.model`);
  const promptVersion = requireString(provenanceObj.promptVersion, `${context}.provenance.promptVersion`);
  const at = requireString(provenanceObj.at, `${context}.provenance.at`);
  return {
    value: fieldValue,
    evidence: selector === undefined ? { excerpt } : { excerpt, selector },
    interpretation,
    provenance: { modelAssisted: true, engine, model, promptVersion, at },
  };
}

/**
 * Validate parsed JSON as a `GroundedExtraction<MuseumItemFields>`: `date` is
 * required (rights-critical, `MUSEUM_ITEM_SCHEMA.rightsCriticalFields`);
 * `creator`/`description`/`statedCredit` are validated only when present
 * (mirrors the extractor's "missing fields are returned absent, never
 * fabricated" contract, `@/extraction/structured-extractor`).
 */
function validateGroundedExtraction(
  parsed: unknown,
  context: string,
): GroundedExtraction<MuseumItemFields> {
  const obj = requireObject(parsed, context);
  const extraction: GroundedExtraction<MuseumItemFields> = {
    date: validateGroundedField(obj.date, `${context}.date`),
  };
  if (obj.creator !== undefined) {
    extraction.creator = validateGroundedField(obj.creator, `${context}.creator`);
  }
  if (obj.description !== undefined) {
    extraction.description = validateGroundedField(obj.description, `${context}.description`);
  }
  if (obj.statedCredit !== undefined) {
    extraction.statedCredit = validateGroundedField(obj.statedCredit, `${context}.statedCredit`);
  }
  return extraction;
}

/** Parse + validate a snapshot's raw JSON body (fail loud on malformed JSON or shape). */
function parseGroundedMetadataSnapshot(
  raw: string,
  context: string,
): GroundedExtraction<MuseumItemFields> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${context}: malformed JSON metadata snapshot (${describeError(error)}).`);
  }
  return validateGroundedExtraction(parsed, context);
}

/**
 * The record's/its owning `Source`'s display title, for the minimal
 * `ResolvedRepositoryItem` review mode builds. `Source.titles` is guaranteed
 * non-empty by `loadSourceFile` (rule 2) before it ever reaches here; prefers
 * the `canonical` title when one exists, otherwise the first authored title.
 */
function titleFor(source: Source): string {
  const canonical = source.titles.find((title) => title.role === 'canonical');
  return (canonical ?? source.titles[0]).text;
}

/** Input to {@link reviewRightsEvidence}. */
export interface ReviewRightsEvidenceInput {
  /** Directory holding the one-file-per-source SSOT (`bibliography/sources`). */
  sourcesDir: string;
  /** The member's `sourceId` (e.g. `PB-P100`). */
  sourceId: string;
  /** `--archive`: selects one copy when the member has more than one record. */
  archive?: string;
  /**
   * The repo root the metadata-snapshot store's `bibliography/` subpath is
   * relative to (same value as `runMuseumInventory`'s `baseDir`) -- used to
   * read back the record's persisted metadata snapshot instead of
   * re-resolving through the adapter.
   */
  baseDir: string;
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
  if (typeof input.baseDir !== 'string' || input.baseDir.trim().length === 0) {
    throw new Error(
      'reviewRightsEvidence: input.baseDir (the repo root the metadata-snapshot store is ' +
        'relative to) is required.',
    );
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
 * REUSES the grounded metadata `bib inventory` already extracted and
 * persisted at acquisition time, rather than calling `adapter.resolve`
 * again: `resolve` both re-fetches the item page AND re-runs the expensive,
 * non-deterministic codex LLM extraction, and `collectRightsEvidence` only
 * ever reads `item.metadata` -- it needs no network/engine call at all. This
 * function loads the record's persisted `metadataSnapshot` (the exact
 * `JSON.stringify(item.metadata)` `bib inventory` wrote,
 * `@/sourcegroup/museum-inventory`), validates its shape, and builds a
 * minimal `ResolvedRepositoryItem` from the RECORD (its accession
 * identifier, `sourceUrl`, owning `Source`'s title) plus that parsed
 * metadata -- so `adapter.collectRightsEvidence` runs against real grounded
 * data with zero fetches and zero engine calls.
 *
 * Dispatches the adapter via `registry.selectForRecord` (never a locator-
 * shape sniff, INV-D; dispatch itself is a pure lookup, no I/O). Fails loud
 * -- directing the operator to re-inventory -- when the record carries no
 * `sourceUrl` or no persisted `metadataSnapshot` (e.g. an older record
 * inventoried before snapshots existed): this function never silently falls
 * back to re-resolving, since that would reintroduce the duplicate-fetch/
 * duplicate-extraction cost this reuse path exists to avoid.
 */
export async function reviewRightsEvidence(
  input: ReviewRightsEvidenceInput,
): Promise<ReviewRightsEvidenceResult> {
  assertReviewInputWellFormed(input);

  const { source, records } = loadRecordFile(input.sourcesDir, input.sourceId);
  const { selected } = selectAuthored(input.sourceId, records, input.archive);

  const adapter = input.registry.selectForRecord(selected);
  const copyLabel = `${input.sourceId} @ ${selected.sourceArchive}`;

  const sourceUrl = selected.sourceUrl;
  if (sourceUrl === undefined || sourceUrl.trim().length === 0) {
    throw new Error(
      `reviewRightsEvidence(${copyLabel}): the record carries no sourceUrl -- nothing to review ` +
        'rights evidence for.',
    );
  }

  const snapshotRef = selected.metadataSnapshot;
  if (snapshotRef === undefined) {
    throw new Error(
      `reviewRightsEvidence(${copyLabel}): the record carries no persisted metadata snapshot -- ` +
        're-run "bib inventory --repository <name> ..." for this copy to create one. Review mode ' +
        'reuses the grounded metadata inventory already extracted rather than re-fetching the page ' +
        'and re-running the extraction engine, so there is no fallback re-resolve path here.',
    );
  }

  const snapshotRecord = await readSnapshot(input.baseDir, snapshotRef.path);
  const metadata = parseGroundedMetadataSnapshot(
    snapshotRecord.raw,
    `reviewRightsEvidence(${copyLabel}): metadataSnapshot "${snapshotRef.path}"`,
  );

  const item: ResolvedRepositoryItem = {
    repository: adapter.repository,
    identifiers: selected.identifiers ?? [],
    sourceUrl,
    title: titleFor(source),
    assetLocators: [],
    metadata,
  };

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
