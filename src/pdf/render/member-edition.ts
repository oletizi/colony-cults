/**
 * Assembles the front-matter (title page) + colophon + ordered page-master
 * segment list for a source-group member's single collapsed PDF page (spec
 * 017 T008). Pure data assembly + provenance reads -- no image bytes fetched,
 * no Typst invocation (that lives in `@/pdf/render/member-build`, which
 * consumes this module's output).
 *
 * A source-group member has no `bibliography/sources/<id>.yml` SSOT file of
 * its own to read title/rights/catalog metadata from the way
 * `@/pdf/load/archive-edition`'s generic reader does (`makeSourceMetaReader`
 * + `loadSourceFile` against `repoRoot`) -- a member's `Source` +
 * `repositoryRecords` ARE the metadata; the caller already has them in hand
 * (loaded from the member's own SSOT entry, which every member DOES have --
 * see `@/pdf/render/batch`). So this module resolves everything directly off
 * the `member` value passed in, never re-reading a per-member file.
 */

import path from 'node:path';

import type { ProvenanceFields } from '@/archive/provenance';
import { readProvenance } from '@/archive/provenance';
import { buildOcrTranscription, deriveOcrDisclosureAggregate } from '@/pdf/load/archive-ocr-disclosure';
import { assembleColophon, type ColophonPageInput } from '@/pdf/load/colophon';
import type { ArchivePinReader } from '@/pdf/load/edition';
import type { ColophonMeta, TitlePageMeta } from '@/pdf/model';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/** A `Source` carrying its `repositoryRecords` -- the shape `buildMemberItem` receives. */
export type MemberWithRecords = Source & { repositoryRecords: RepositoryRecord[] };

/** One page-master segment's identity + image reference, ordered for the stacked verso. */
export interface MemberPageMasterSegment {
  /** Folio id derived from the asset's provenance sidecar filename (e.g. `f001`). */
  folioId: string;
  /** B2 object-store key for the segment's image bytes. */
  objectStoreKey: string;
  /** Expected sha256 of the segment's image bytes. */
  sha256: string;
  /** Archive-relative path to the segment's provenance sidecar (`fNNN.yml`). */
  provenancePath: string;
}

/** The assembled front-matter + colophon + ordered segments for one member's collapsed page. */
export interface MemberEditionAssembly {
  titlePage: TitlePageMeta;
  colophon: ColophonMeta;
  /** Page-master segments, ascending by `sequence` (T007 assertion 3). */
  segments: MemberPageMasterSegment[];
}

/** Derive a folio id from a provenance sidecar's archive-relative path (`.../f001.yml` -> `f001`). */
function folioIdFromProvenancePath(provenancePath: string): string {
  return path.basename(provenancePath, '.yml');
}

/**
 * Collect every `page-master` asset across `member.repositoryRecords`,
 * ordered ascending by `sequence` -- the N segment images that reconstruct
 * one physical clipping (T006). The detached `ocr-text` asset (`sequence: 0`,
 * a different role) is never included -- `verso.segments.length` therefore
 * always equals the `page-master` count (T007 assertion 6).
 *
 * @throws Error if the member has no `page-master` assets, or if any
 *   `page-master` asset carries no `sequence` (ordering requires it).
 */
export function collectPageMasterSegments(member: MemberWithRecords): MemberPageMasterSegment[] {
  const pageMasters = member.repositoryRecords
    .flatMap((record) => record.assets ?? [])
    .filter((asset) => asset.role === 'page-master');

  if (pageMasters.length === 0) {
    throw new Error(
      `collectPageMasterSegments: source "${member.sourceId}" has no "page-master" assets ` +
        'across its repositoryRecords -- a source-group member requires at least one segment image.',
    );
  }

  const ordered = pageMasters.map((asset) => {
    if (asset.sequence === undefined) {
      throw new Error(
        `collectPageMasterSegments: source "${member.sourceId}" has a "page-master" asset ` +
          `(objectStoreKey ${JSON.stringify(asset.objectStoreKey)}) with no "sequence" -- ` +
          'ordering the stacked verso requires every segment to carry its sequence.',
      );
    }
    return { asset, sequence: asset.sequence };
  });
  ordered.sort((a, b) => a.sequence - b.sequence);

  return ordered.map(({ asset }) => ({
    folioId: folioIdFromProvenancePath(asset.provenancePath),
    objectStoreKey: asset.objectStoreKey,
    sha256: asset.checksum,
    provenancePath: asset.provenancePath,
  }));
}

/** A non-empty trimmed value, or throw naming the field + context. */
function requireNonEmpty(value: string, label: string, context: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${context}: ${label} is empty -- ${label} is required.`);
  }
  return value;
}

/** The member's title: canonical title if present, else the first authored title. */
function resolveMemberTitle(member: MemberWithRecords, context: string): string {
  const canonical = member.titles.find((title) => title.role === 'canonical');
  const chosen = canonical ?? member.titles[0];
  return requireNonEmpty(chosen === undefined ? '' : chosen.text, 'title', context);
}

/**
 * The member's rights determination: the member's own affirmative
 * `rights.status` if authored, else the lead segment's folio provenance
 * `rights_status` (mirrors `@/pdf/load/archive-edition`'s `resolveTitleAndRights`
 * fallback, since a member's `Source.rights` is often not yet authored).
 */
function resolveMemberRights(
  member: MemberWithRecords,
  leadProvenance: ProvenanceFields,
  context: string,
): string {
  return requireNonEmpty(member.rights?.status ?? leadProvenance.rights_status, 'rights', context);
}

/**
 * The title-page `date`: the `YYYY-MM-DD` prefix of the lead segment's
 * provenance `retrieved` timestamp -- a member's flat archive directory
 * carries no dated issue subdirectory to derive a date from otherwise
 * (mirrors `@/pdf/load/archive-edition`'s `resolveDate` fallback).
 */
function resolveMemberDate(leadProvenance: ProvenanceFields, context: string): string {
  const retrieved = leadProvenance.retrieved.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(retrieved);
  if (match !== null) {
    return match[1];
  }
  if (retrieved.length > 0) {
    return retrieved;
  }
  throw new Error(
    `${context}: no date available -- the lead segment's provenance carries no "retrieved" timestamp.`,
  );
}

/** The member's catalog URL: the first repositoryRecord that carries one, else `null`. */
function resolveCatalogUrl(member: MemberWithRecords): string | null {
  for (const record of member.repositoryRecords) {
    if (record.catalogUrl !== undefined && record.catalogUrl.trim().length > 0) {
      return record.catalogUrl;
    }
  }
  return null;
}

/** The member's source-level ark, from its repositoryRecords' copy identifiers, or `null`. */
function resolveArk(member: MemberWithRecords): string | null {
  for (const record of member.repositoryRecords) {
    for (const identifier of record.identifiers ?? []) {
      if (identifier.type === 'ark' && identifier.value.trim().length > 0) {
        return identifier.value;
      }
    }
  }
  return null;
}

/** The member's creator, or `null` when absent/blank. */
function resolveCreator(member: MemberWithRecords): string | null {
  const creator = member.creator?.trim();
  return creator === undefined || creator.length === 0 ? null : creator;
}

/**
 * Assemble a source-group member's front-matter + colophon + ordered
 * page-master segments (spec 017 T008). Reads every segment's provenance
 * sidecar ONCE (for the OCR-transcription disclosure aggregate + the lead
 * segment's title-page date/rights fallback).
 *
 * A member is ALWAYS treated as an English, OCR-only edition: no machine
 * translation is ever performed on a clipping's detached OCR text (spec
 * 017's whole design is "reuse the OCR text as-is"), so the colophon always
 * carries the honest OCR-transcription disclosure (`translation: null`),
 * regardless of the underlying scan's own recorded `language` (a fact about
 * the source document, not about which recto-reading path this build takes).
 *
 * @throws Error if the member has no `page-master` assets, if any lacks a
 *   `sequence`, if the member's title/rights/date cannot be resolved, or if
 *   `assembleColophon`'s own OCR-transcription/archiveRef checks fail.
 */
export async function assembleMemberEdition(
  member: MemberWithRecords,
  archiveRoot: string,
  pin: ArchivePinReader,
): Promise<MemberEditionAssembly> {
  const context = `assembleMemberEdition ${member.sourceId}`;
  const segments = collectPageMasterSegments(member);

  const provenances = await Promise.all(
    segments.map((segment) => readProvenance(path.join(archiveRoot, segment.provenancePath))),
  );
  const leadProvenance = provenances[0];

  const ocrTranscription = buildOcrTranscription(deriveOcrDisclosureAggregate(provenances, context));

  const titlePage: TitlePageMeta = {
    title: resolveMemberTitle(member, context),
    creator: resolveCreator(member),
    date: resolveMemberDate(leadProvenance, context),
    rights: resolveMemberRights(member, leadProvenance, context),
    ark: resolveArk(member),
    catalogUrl: resolveCatalogUrl(member),
  };

  const colophonPages: ColophonPageInput[] = segments.map((segment) => ({
    pageId: 'p001',
    folioId: segment.folioId,
    objectStoreKey: segment.objectStoreKey,
    sha256: segment.sha256,
    machineAssist: null,
  }));

  const colophon = assembleColophon({
    sourceId: member.sourceId,
    itemId: member.sourceId,
    archiveRef: pin.read(),
    pages: colophonPages,
    readingLanguage: 'english',
    ocrTranscription,
  });

  return { titlePage, colophon, segments };
}
