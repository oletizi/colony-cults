import type { CanonicalModel } from '@/bibliography/model';
import type { ValidationFinding } from '@/bibliography/validate';
import {
  isAllowed,
  REPOSITORY_RECORD_REQUIRED_FIELDS,
  SOURCE_REQUIRED_FIELDS,
} from '@/bibliography/vocab';
import type { AssetManifestRef, IssueRef, RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/**
 * Referential integrity, closed-vocabulary, required-core, uniqueness, and
 * manifest-shape checks (US5 / T027) -- the remaining checks
 * `@/bibliography/validate`'s `validate()` composes alongside the US2 leak
 * check and the US4 view-drift check. Split out of `validate.ts` to keep
 * that file's total under the repo's ~300-line-per-file guidance.
 *
 * See specs/004-canonical-source-metadata/contracts/validation.md.
 */

/** Human-readable label for one Repository Record, naming its key. */
function recordLabel(record: RepositoryRecord): string {
  return `Repository Record (${record.sourceArchive || '(unknown archive)'}) for Source ${record.sourceId}`;
}

/**
 * Every `RepositoryRecord.sourceId` MUST resolve to a `Source` in
 * `model.sources` (FR-017). A record whose `sourceId` matches no loaded
 * Source is reported as `orphan-record`, naming the record's key. In the
 * live loader this pairing can never actually drift (`deriveModel` always
 * builds a record's `sourceId` from the owning Source it walked), so this
 * check guards the invariant for any `CanonicalModel` assembled by another
 * path (tests, future callers).
 */
export function validateOrphanRecords(model: CanonicalModel): ValidationFinding[] {
  const sourceIds = new Set(model.sources.map((source) => source.sourceId));
  return model.repositoryRecords
    .filter((record) => !sourceIds.has(record.sourceId))
    .map((record) => ({
      kind: 'orphan-record',
      sourceId: record.sourceId,
      detail: `${recordLabel(record)} resolves to no Source`,
    }));
}

/** One asset-level `orphan-asset` finding for an asset owned by an orphaned record. */
function orphanAssetFinding(record: RepositoryRecord, path: string, detail: string): ValidationFinding {
  return { kind: 'orphan-asset', sourceId: record.sourceId, path, detail };
}

/** `orphan-asset` findings for one orphaned record's per-issue assets. */
function orphanIssueAssetFindings(record: RepositoryRecord, issues: readonly IssueRef[]): ValidationFinding[] {
  return issues.flatMap((issue) =>
    issue.assets.map((asset) =>
      orphanAssetFinding(
        record,
        asset.localPath,
        `asset ${asset.localPath} (issue ${issue.ark}) is mirrored under ${recordLabel(record)}, which resolves to no Source`,
      ),
    ),
  );
}

/** The manifest roll-up's locating path, for a record with no per-issue asset breakdown. */
function manifestLocation(manifest: AssetManifestRef): string {
  return manifest.objectStore !== null ? manifest.objectStore.key : manifest.localPath ?? '(unknown location)';
}

/**
 * Every Asset -- whether enumerated individually (`record.issues[].assets`)
 * or only rolled up as a count (`record.manifest`) -- MUST resolve up to a
 * Repository Record that itself resolves to a Source (FR-017). The derived
 * model always attaches assets under their owning record, so an orphan asset
 * is representable only as: an asset owned by a record that is itself
 * orphaned (`orphan-record`). Per-issue assets are named individually; a
 * manifest roll-up with no per-issue breakdown (monograph copies) is named
 * once, by its roll-up location, to avoid re-reporting the same underlying
 * assets twice for periodicals (which carry both `manifest` and `issues`).
 */
export function validateOrphanAssets(model: CanonicalModel): ValidationFinding[] {
  const sourceIds = new Set(model.sources.map((source) => source.sourceId));
  const findings: ValidationFinding[] = [];
  for (const record of model.repositoryRecords) {
    if (sourceIds.has(record.sourceId)) {
      continue;
    }
    if (record.issues !== undefined) {
      findings.push(...orphanIssueAssetFindings(record, record.issues));
      continue;
    }
    if (record.manifest !== undefined && record.manifest.assetCount > 0) {
      const location = manifestLocation(record.manifest);
      findings.push(
        orphanAssetFinding(
          record,
          location,
          `manifest roll-up (${record.manifest.assetCount} asset(s)) at ${location} is mirrored under ${recordLabel(record)}, which resolves to no Source`,
        ),
      );
    }
  }
  return findings;
}

/** One `vocab` finding naming the field, offending value, and owning entity. */
function vocabFinding(sourceId: string, field: string, value: string, owner: string): ValidationFinding {
  return {
    kind: 'vocab',
    sourceId,
    detail: `${field} "${value}" on ${owner} is not in the closed vocabulary`,
  };
}

/**
 * Validate every closed-vocabulary field the derived model actually exposes
 * a value for (FR-019): `status` and `rights.status` per Repository Record,
 * plus `manifest.objectStore.provider` where an object-store location is
 * present. `status === ''` is the loader's own "unset" sentinel (see
 * `deriveModel`), not a vocab violation -- `validateMissingRequired` reports
 * that case instead, so it is skipped here to avoid double-reporting the
 * same gap under two finding kinds. `ocr_status` has no reachable field on
 * `RepositoryRecord`/`AssetManifestRef`/`Asset` in the current derived
 * model (the per-asset OCR outcome lives only in the on-disk provenance
 * sidecar, `@/model/provenance`'s `Provenance.ocrStatus`, which is never
 * folded into `CanonicalModel`) -- so it cannot be validated here without
 * fabricating a field; skipped for the same "no mock data" reason the model
 * itself omits it.
 */
export function validateVocab(model: CanonicalModel): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const record of model.repositoryRecords) {
    if (record.status !== '' && !isAllowed('status', record.status)) {
      findings.push(vocabFinding(record.sourceId, 'status', record.status, recordLabel(record)));
    }
    if (record.rights !== undefined && !isAllowed('rights', record.rights.status)) {
      findings.push(vocabFinding(record.sourceId, 'rights', record.rights.status, recordLabel(record)));
    }
    const provider = record.manifest?.objectStore?.provider;
    if (provider !== undefined && !isAllowed('provider', provider)) {
      findings.push(vocabFinding(record.sourceId, 'provider', provider, recordLabel(record)));
    }
  }
  return findings;
}

/** Whether `source` carries the named `SOURCE_REQUIRED_FIELDS` entry. */
function sourceHasRequiredField(source: Source, field: string): boolean {
  switch (field) {
    case 'sourceId':
      return source.sourceId !== undefined && source.sourceId !== '';
    case 'titles':
      return source.titles !== undefined && source.titles.length > 0;
    case 'kind':
      return source.kind !== undefined;
    default:
      throw new Error(`sourceHasRequiredField: unknown Source required field "${field}"`);
  }
}

/** Whether `record` carries the named `REPOSITORY_RECORD_REQUIRED_FIELDS` entry. */
function recordHasRequiredField(record: RepositoryRecord, field: string): boolean {
  switch (field) {
    case 'sourceArchive':
      return record.sourceArchive !== undefined && record.sourceArchive !== '';
    case 'status':
      return record.status !== undefined && record.status !== '';
    default:
      throw new Error(`recordHasRequiredField: unknown RepositoryRecord required field "${field}"`);
  }
}

/**
 * Enforce the required-core field spec (FR-019): every `Source` must carry
 * `sourceId`, a non-empty `titles`, and `kind` (`SOURCE_REQUIRED_FIELDS`);
 * every `RepositoryRecord` must carry `sourceArchive` and `status`
 * (`REPOSITORY_RECORD_REQUIRED_FIELDS`) -- the latter catches, among other
 * things, the `status: ''` sentinel `deriveModel` leaves on a derived-only
 * record with no authored acquisition data.
 */
export function validateMissingRequired(model: CanonicalModel): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const source of model.sources) {
    for (const spec of SOURCE_REQUIRED_FIELDS) {
      if (!sourceHasRequiredField(source, spec.field)) {
        findings.push({
          kind: 'missing-required',
          sourceId: source.sourceId,
          detail: `Source ${source.sourceId || '(unknown sourceId)'} missing required field "${spec.field}"`,
        });
      }
    }
  }
  for (const record of model.repositoryRecords) {
    for (const spec of REPOSITORY_RECORD_REQUIRED_FIELDS) {
      if (!recordHasRequiredField(record, spec.field)) {
        findings.push({
          kind: 'missing-required',
          sourceId: record.sourceId,
          detail: `${recordLabel(record)} missing required field "${spec.field}"`,
        });
      }
    }
  }
  return findings;
}

/**
 * `(sourceId, sourceArchive)` MUST be unique across `model.repositoryRecords`
 * (data-model). The loader already throws on duplicates authored within one
 * SSOT file; this catches a duplicate arising across the derived model (e.g.
 * a merge of multiple sources). Reports one finding per duplicate occurrence
 * beyond the first for a given key.
 */
export function validateDuplicateCopies(model: CanonicalModel): ValidationFinding[] {
  const seenKeys = new Set<string>();
  const findings: ValidationFinding[] = [];
  for (const record of model.repositoryRecords) {
    const key = `${record.sourceId} ${record.sourceArchive}`;
    if (seenKeys.has(key)) {
      findings.push({
        kind: 'duplicate-copy',
        sourceId: record.sourceId,
        detail: `duplicate ${recordLabel(record)} -- (sourceId, sourceArchive) must be unique`,
      });
      continue;
    }
    seenKeys.add(key);
  }
  return findings;
}

/**
 * A copy MUST reference its mirrored assets via an `AssetManifestRef` (an
 * object carrying at least a numeric `assetCount`), never a scalar checksum
 * (FR-006). `RepositoryRecord.manifest` is statically typed as
 * `AssetManifestRef | undefined` -- no code path in this codebase can
 * currently produce a scalar there -- so this check is a runtime guard on
 * that invariant (defensive, not reachable via any known input today),
 * rather than a case this repo's fixtures can seed without violating the
 * type system.
 */
export function validateSingleChecksum(model: CanonicalModel): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const record of model.repositoryRecords) {
    if (record.manifest === undefined) {
      continue;
    }
    const wellFormed =
      typeof record.manifest === 'object' &&
      record.manifest !== null &&
      typeof record.manifest.assetCount === 'number';
    if (!wellFormed) {
      findings.push({
        kind: 'single-checksum',
        sourceId: record.sourceId,
        detail: `${recordLabel(record)} references its assets as a scalar checksum instead of an asset manifest`,
      });
    }
  }
  return findings;
}

/**
 * `group-has-repository-records` findings: one per `Source` with `kind ===
 * 'source-group'` that has >= 1 entry in `model.repositoryRecords` keyed to
 * its `sourceId` (FR-001/data-model invariant 1). A source group never
 * carries a `repositoryRecords` field of its own on the `Source` type --
 * repository records are folded into `model.repositoryRecords` by
 * `deriveModel`, keyed by `sourceId` -- so membership in that array is the
 * only representation to check.
 */
function groupRepositoryRecordFindings(model: CanonicalModel): ValidationFinding[] {
  const recordSourceIds = new Set(model.repositoryRecords.map((record) => record.sourceId));
  return model.sources
    .filter((source) => source.kind === 'source-group' && recordSourceIds.has(source.sourceId))
    .map((group) => ({
      kind: 'group-has-repository-records',
      sourceId: group.sourceId,
      detail: `source group "${group.sourceId}" must not hold repository records`,
    }));
}

/**
 * `dangling-part-of` / `part-of-not-a-group` findings: for every `Source`
 * with `partOf` set, resolve it against `model.sources` (data-model
 * invariant 5). A `partOf` naming no existing `sourceId` is `dangling-part-
 * of`; a `partOf` naming an existing Source whose `kind !== 'source-group'`
 * is `part-of-not-a-group`. A `partOf` resolving to an existing source-group
 * is valid membership and yields no finding.
 */
function partOfFindings(model: CanonicalModel): ValidationFinding[] {
  const sourcesById = new Map(model.sources.map((source) => [source.sourceId, source]));
  const findings: ValidationFinding[] = [];
  for (const member of model.sources) {
    if (member.partOf === undefined) {
      continue;
    }
    const target = sourcesById.get(member.partOf);
    if (target === undefined) {
      findings.push({
        kind: 'dangling-part-of',
        sourceId: member.sourceId,
        detail: `member "${member.sourceId}" has part_of "${member.partOf}" but no such source exists`,
      });
      continue;
    }
    if (target.kind !== 'source-group') {
      findings.push({
        kind: 'part-of-not-a-group',
        sourceId: member.sourceId,
        detail: `member "${member.sourceId}" has part_of "${member.partOf}", which is not a source group (kind: ${target.kind})`,
      });
    }
  }
  return findings;
}

/**
 * `group-is-member` findings: one per `Source` that is itself `kind ===
 * 'source-group'` but ALSO carries `partOf` (i.e. it is nested as a member of
 * another group). The intended invariant is that a source-group is never a
 * member of anything -- groups are a flat, one-level container.
 */
function groupIsMemberFindings(model: CanonicalModel): ValidationFinding[] {
  return model.sources
    .filter((source) => source.kind === 'source-group' && source.partOf !== undefined)
    .map((group) => ({
      kind: 'group-is-member',
      sourceId: group.sourceId,
      detail: `source group "${group.sourceId}" must not itself be a member (has partOf "${group.partOf}")`,
    }));
}

/**
 * Validate source-group invariants (FR-001/FR-005/FR-006 --
 * specs/005-source-groups/contracts/validation.md): a group must not hold
 * repository records, every member's `partOf` must resolve to an existing
 * source-group, and a source-group must never itself be a member of another
 * group. A zero-member group, or a group with members and no repository
 * records, is valid and yields no finding (FR-005).
 */
export function validateSourceGroups(model: CanonicalModel): ValidationFinding[] {
  return [
    ...groupRepositoryRecordFindings(model),
    ...partOfFindings(model),
    ...groupIsMemberFindings(model),
  ];
}
