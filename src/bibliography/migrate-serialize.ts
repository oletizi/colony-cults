import { stringify } from 'yaml';

import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import type { Publication } from '@/model/publication';
import type { KnownExtent, LeadResolution, Reference, Source, SuspectedGap } from '@/model/source';

/**
 * One migrated Source together with its authored Repository Records, ready to
 * be serialized to `bibliography/sources/<sourceId>.yml`.
 */
export interface MigratedSource {
  source: Source;
  records: AuthoredRepositoryRecord[];
}

/**
 * Build one Repository Record's on-disk object in a FIXED key order (matching
 * the SSOT contract's field order), omitting absent optional fields entirely so
 * the output is deterministic and no field is fabricated.
 */
function orderedRecord(record: AuthoredRepositoryRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sourceArchive: record.sourceArchive,
    status: record.status,
  };
  if (record.catalogUrl !== undefined) {
    out.catalogUrl = record.catalogUrl;
  }
  if (record.originalUrl !== undefined) {
    out.originalUrl = record.originalUrl;
  }
  if (record.sourceUrl !== undefined) {
    out.sourceUrl = record.sourceUrl;
  }
  if (record.retrievedAt !== undefined) {
    out.retrievedAt = record.retrievedAt;
  }
  if (record.identifiers !== undefined && record.identifiers.length > 0) {
    out.identifiers = record.identifiers.map((id) => ({ type: id.type, value: id.value }));
  }
  if (record.rights !== undefined) {
    out.rights = record.rights;
  }
  if (record.rightsAssessment !== undefined) {
    const assessment: Record<string, unknown> = {};
    if (record.rightsAssessment.rightsRaw !== undefined) {
      assessment.rightsRaw = record.rightsAssessment.rightsRaw;
    }
    assessment.rightsStatus = record.rightsAssessment.rightsStatus;
    assessment.rightsBasis = record.rightsAssessment.rightsBasis;
    if (record.rightsAssessment.rightsJurisdiction !== undefined) {
      assessment.rightsJurisdiction = record.rightsAssessment.rightsJurisdiction;
    }
    assessment.assessedBy = record.rightsAssessment.assessedBy;
    assessment.assessedAt = record.rightsAssessment.assessedAt;
    out.rightsAssessment = assessment;
  }
  // Acquired object-store assets (spec 011, T005/T030). Emitted in a FIXED key
  // order per asset, with absent optionals (`role`/`sequence`/
  // `representationChoice`) omitted, so a load -> serialize round-trip is
  // byte-identical. Sits after rightsAssessment (the acquisition axis) and
  // ahead of the derived/serial fields, mirroring the model's field order.
  if (record.assets !== undefined && record.assets.length > 0) {
    out.assets = record.assets.map((asset) => {
      const entry: Record<string, unknown> = {
        sourceUrl: asset.sourceUrl,
        mediaType: asset.mediaType,
        objectStoreKey: asset.objectStoreKey,
        checksum: asset.checksum,
        byteLength: asset.byteLength,
        provenancePath: asset.provenancePath,
      };
      if (asset.role !== undefined) {
        entry.role = asset.role;
      }
      if (asset.sequence !== undefined) {
        entry.sequence = asset.sequence;
      }
      if (asset.representationChoice !== undefined) {
        entry.representationChoice = asset.representationChoice;
      }
      return entry;
    });
  }
  if (record.census !== undefined) {
    out.census = record.census;
  }
  if (record.metadataSnapshot !== undefined) {
    out.metadataSnapshot = {
      path: record.metadataSnapshot.path,
      retrievedAt: record.metadataSnapshot.retrievedAt,
      endpoint: record.metadataSnapshot.endpoint,
      normalizationVersion: record.metadataSnapshot.normalizationVersion,
    };
  }
  if (record.verification !== undefined) {
    out.verification = {
      result: record.verification.result,
      verifiedAt: record.verification.verifiedAt,
      checks: {
        identifierResolved: record.verification.checks.identifierResolved,
        rights: record.verification.checks.rights,
        requiredMetadata: record.verification.checks.requiredMetadata,
        hardDuplicate: record.verification.checks.hardDuplicate,
        possibleDuplicate: record.verification.checks.possibleDuplicate,
      },
      snapshotRef: record.verification.snapshotRef,
    };
  }
  return out;
}

/** Compare records by their `sourceArchive` key for a stable on-disk order. */
function byArchive(a: AuthoredRepositoryRecord, b: AuthoredRepositoryRecord): number {
  if (a.sourceArchive < b.sourceArchive) {
    return -1;
  }
  return a.sourceArchive > b.sourceArchive ? 1 : 0;
}

/**
 * Build one `publications[]` entry's on-disk object in a FIXED key order
 * (matching contracts/ssot-publications.md § 2), omitting the absent optional
 * `machineAssist` so the output is deterministic and no field is fabricated.
 * Mirrors {@link orderedRecord}'s pattern for `repositoryRecords[]`.
 */
function orderedPublication(publication: Publication): Record<string, unknown> {
  const out: Record<string, unknown> = {
    variant: publication.variant,
    publishedAt: publication.publishedAt,
    snapshot: publication.snapshot,
    snapshotShort: publication.snapshotShort,
    cdnBase: publication.cdnBase,
    keyScheme: publication.keyScheme,
    rightsBasis: publication.rightsBasis,
  };
  if (publication.machineAssist !== undefined) {
    out.machineAssist = publication.machineAssist;
  }
  out.manifest = {
    manifestPath: publication.manifest.manifestPath,
    issueCount: publication.manifest.issueCount,
  };
  return out;
}

/**
 * Compare publications by `snapshotShort` then `variant` for a stable,
 * deterministic on-disk order (mirrors {@link byArchive}).
 */
function byPublication(a: Publication, b: Publication): number {
  if (a.snapshotShort !== b.snapshotShort) {
    return a.snapshotShort < b.snapshotShort ? -1 : 1;
  }
  if (a.variant !== b.variant) {
    return a.variant < b.variant ? -1 : 1;
  }
  return 0;
}

/**
 * Build one `references[]` entry (a citation mined FROM the source) in a FIXED
 * key order, omitting absent optionals so the output is deterministic. Preserves
 * input order of the array (hand-authored, no natural sort key).
 */
function orderedReference(reference: Reference): Record<string, unknown> {
  const out: Record<string, unknown> = { citedAs: reference.citedAs };
  if (reference.citedKind !== undefined) {
    out.citedKind = reference.citedKind;
  }
  if (reference.basis !== undefined) {
    out.basis = reference.basis;
  }
  if (reference.resolvedTo !== undefined) {
    out.resolvedTo = reference.resolvedTo;
  }
  if (reference.notes !== undefined) {
    out.notes = reference.notes;
  }
  return out;
}

/**
 * Build one `resolution`'s on-disk object in a FIXED key order (`state` first,
 * then its state-specific fields), mirroring {@link orderedRecord}'s pattern.
 * Each branch emits exactly the fields {@link LeadResolution} carries for that
 * `state` -- nothing fabricated, nothing dropped, so a resolution round-trips
 * unchanged through load -> serialize (specs/011 § SuspectedLead.resolution).
 */
function orderedResolution(resolution: LeadResolution): Record<string, unknown> {
  switch (resolution.state) {
    case 'unexamined':
      return { state: resolution.state };
    case 'identified':
      return {
        state: resolution.state,
        candidate: resolution.candidate,
        resolvedAt: resolution.resolvedAt,
      };
    case 'inventoried':
      return {
        state: resolution.state,
        sourceId: resolution.sourceId,
        resolvedAt: resolution.resolvedAt,
      };
    case 'excluded':
      return {
        state: resolution.state,
        reason: resolution.reason,
        resolvedAt: resolution.resolvedAt,
      };
    case 'unavailable':
      return {
        state: resolution.state,
        reason: resolution.reason,
        resolvedAt: resolution.resolvedAt,
      };
  }
}

/**
 * Build one `knownExtent`'s on-disk object in a FIXED key order (`state`
 * first, then its state-specific fields), mirroring {@link orderedResolution}.
 * Each branch emits exactly the fields {@link KnownExtent} carries for that
 * `state` -- nothing fabricated, nothing dropped, so a `knownExtent`
 * round-trips unchanged through load -> serialize (specs/011 § KnownExtent).
 */
function orderedKnownExtent(extent: KnownExtent): Record<string, unknown> {
  switch (extent.state) {
    case 'measured':
      return { state: extent.state, count: extent.count, basis: extent.basis };
    case 'unexamined':
      return { state: extent.state };
    case 'irreducible':
      return { state: extent.state, basis: extent.basis };
  }
}

/**
 * Build one `suspected[]` gap (a group-only inferred, uncited gap) in a FIXED
 * key order, omitting absent optionals. Preserves input array order.
 */
function orderedSuspected(gap: SuspectedGap): Record<string, unknown> {
  const out: Record<string, unknown> = {
    description: gap.description,
    basis: gap.basis,
  };
  if (gap.evidenceClass !== undefined) {
    out.evidenceClass = gap.evidenceClass;
  }
  if (gap.notes !== undefined) {
    out.notes = gap.notes;
  }
  if (gap.resolution !== undefined) {
    out.resolution = orderedResolution(gap.resolution);
  }
  return out;
}

/**
 * Deterministically serialize a {@link MigratedSource} to the SSOT YAML shape.
 * Keys are emitted in a fixed order and absent optional fields are omitted, so
 * re-serializing identical input yields byte-identical output (idempotency).
 * The result is loadable by `bibliography/load.ts` (contract source-record.md).
 */
export function serializeSource(migrated: MigratedSource): string {
  const source = migrated.source;
  const out: Record<string, unknown> = {
    sourceId: source.sourceId,
    kind: source.kind,
  };
  if (source.partOf !== undefined) {
    out.partOf = source.partOf;
  }
  // Field order: sourceId, kind, partOf, status, case, centrality, evidenceClass,
  // language, creator, rights, knownExtent, titles, identifiers, references,
  // suspected, notes, repositoryRecords, publications -- status sits right after
  // partOf since both describe the Source's place in the group/lifecycle model,
  // ahead of the more descriptive/bibliographic fields; publications sits last,
  // downstream of repositoryRecords. Every Source model field is emitted (when
  // present) so a load -> serialize round-trip is lossless.
  if (source.status !== undefined) {
    out.status = source.status;
  }
  if (source.case !== undefined) {
    out.case = source.case;
  }
  if (source.centrality !== undefined) {
    out.centrality = source.centrality;
  }
  if (source.evidenceClass !== undefined) {
    out.evidenceClass = source.evidenceClass;
  }
  if (source.language !== undefined) {
    out.language = source.language;
  }
  if (source.creator !== undefined) {
    out.creator = source.creator;
  }
  // rights sits right after the other descriptive/lifecycle fields (creator)
  // and ahead of titles/identifiers -- it is a work-level determination like
  // status/case/language/creator, not a bibliographic or repository field.
  if (source.rights !== undefined) {
    const rights: Record<string, unknown> = {
      status: source.rights.status,
      basis: source.rights.basis,
    };
    if (source.rights.determinedAt !== undefined) {
      rights.determinedAt = source.rights.determinedAt;
    }
    out.rights = rights;
  }
  // knownExtent + suspected are group-only fields (valid on
  // kind: source-group); emitted when present so a source-group's believed
  // extent and inferred gaps survive a load -> serialize round-trip.
  if (source.knownExtent !== undefined) {
    out.knownExtent = orderedKnownExtent(source.knownExtent);
  }
  out.titles = source.titles.map((title) =>
    title.language !== undefined
      ? { text: title.text, role: title.role, language: title.language }
      : { text: title.text, role: title.role },
  );
  if (source.identifiers.length > 0) {
    out.identifiers = source.identifiers.map((id) => ({ type: id.type, value: id.value }));
  }
  if (source.references !== undefined && source.references.length > 0) {
    out.references = source.references.map(orderedReference);
  }
  if (source.suspected !== undefined && source.suspected.length > 0) {
    out.suspected = source.suspected.map(orderedSuspected);
  }
  if (source.notes !== undefined) {
    out.notes = source.notes;
  }
  const records = [...migrated.records].sort(byArchive);
  if (records.length > 0) {
    out.repositoryRecords = records.map(orderedRecord);
  }
  // publications sits after repositoryRecords -- derivative editions WE
  // published are downstream of the held copies they were built from.
  if (source.publications !== undefined && source.publications.length > 0) {
    out.publications = [...source.publications].sort(byPublication).map(orderedPublication);
  }
  return stringify(out, { lineWidth: 0 });
}
