/**
 * Write the archive companion records for a RepositoryRecord's object-store
 * masters -- the discovery layer the archive pipeline reads. The B2-direct
 * adapters (New Italy Museum, Internet Archive) mirror masters straight to the
 * object store; this closes the loop by committing the `f###.yml` /
 * `<sha>.yml` companions that make those masters findable, so the
 * `undiscoverable-master` sanity check stays quiet.
 *
 * Reuses the canonical companion writer {@link writeProvenance} (same format
 * the Gallica path writes and `bib validate` reads), so there is exactly ONE
 * companion serialization in the codebase.
 *
 * Companion placement:
 *   - A `page-master` in a source with a (registered or derivable) archive
 *     layout -> the cases layout `archive/cases/<case>/<type>/<slug>/f<NNN>.yml`
 *     (`<NNN>` = the asset's `sequence`), where the translator/OCR discover it.
 *   - Any other object-store asset (the preserved source PDF, a museum photo)
 *     -> the asset's own `provenancePath` (which mirrors its object key), the
 *     natural home for a non-paginated master.
 */

import { join } from 'node:path';
import type { ObjectStoreLocation, ProvenanceFields } from '@/archive/provenance';
import { writeProvenance } from '@/archive/provenance';
import { deriveSourceLayout, isSourceLayoutRegistered, sourceLayout } from '@/archive/location';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/** Object-store coordinates recorded on each companion (the master's B2 home). */
export interface CompanionObjectStore {
  provider: string;
  bucket: string;
  endpoint: string;
}

/** File extension for a page-master image from its MIME type (default `png`). */
function extForMediaType(mediaType: string): string {
  if (mediaType === 'image/jpeg') return 'jpg';
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/gif') return 'gif';
  if (mediaType === 'image/tiff') return 'tif';
  if (mediaType === 'application/pdf') return 'pdf';
  return 'bin';
}

/** The canonical title of a source (canonical role, else the first title). */
function sourceTitle(source: Source): string {
  const titles = source.titles ?? [];
  const canonical = titles.find((t) => t.role === 'canonical') ?? titles[0];
  if (canonical === undefined) {
    throw new Error(`writeRecordCompanions: source "${source.sourceId}" has no title`);
  }
  return canonical.text;
}

/** The archive layout for a source: the registered one, else derived from its `case`. */
function layoutFor(source: Source): { case: string; type: string; slug: string } {
  return isSourceLayoutRegistered(source.sourceId) ? sourceLayout(source.sourceId) : deriveSourceLayout(source);
}

/** The companion `.yml` path + the `local_path` the companion records, for one asset. */
function placement(
  source: Source,
  asset: AcquiredAsset,
  archiveRoot: string,
): { yamlPath: string; localPath: string } {
  if (asset.role === 'page-master' && typeof asset.sequence === 'number') {
    const layout = layoutFor(source);
    const stem = `f${String(asset.sequence).padStart(3, '0')}`;
    const rel = join('archive', 'cases', layout.case, layout.type, layout.slug);
    return {
      yamlPath: join(archiveRoot, rel, `${stem}.yml`),
      localPath: join(rel, `${stem}.${extForMediaType(asset.mediaType)}`),
    };
  }
  // Non-paginated master (source PDF, museum photo): its provenancePath IS the
  // companion home, and the object key IS the archive-relative asset path.
  return { yamlPath: join(archiveRoot, asset.provenancePath), localPath: asset.objectStoreKey };
}

/** Asset `type` label for the companion (drives how the pipeline treats it). */
function companionType(asset: AcquiredAsset): string {
  if (asset.mediaType === 'application/pdf') return 'source-document';
  return 'page-image';
}

/**
 * Write the companion records for every object-store master on `record`.
 * Returns the written companion `.yml` paths. Fail-loud: a record whose source
 * has no derivable layout throws rather than silently mis-filing companions.
 */
export async function writeRecordCompanions(params: {
  source: Source;
  record: RepositoryRecord;
  archiveRoot: string;
  objectStore: CompanionObjectStore;
  now: string;
}): Promise<string[]> {
  const { source, record, archiveRoot, objectStore, now } = params;
  const written: string[] = [];
  const title = sourceTitle(source);
  const rightsStatus = record.rightsAssessment?.rightsStatus ?? source.rights?.status ?? 'public-domain';
  const rightsRaw = record.rightsAssessment?.rightsBasis ?? source.rights?.basis ?? '';
  const catalogUrl = record.catalogUrl ?? record.originalUrl ?? '';
  const retrieved = record.qualityAssessment?.assessedAt ?? record.retrievedAt ?? now;

  for (const asset of record.assets ?? []) {
    if (typeof asset.objectStoreKey !== 'string' || asset.objectStoreKey.length === 0) {
      continue;
    }
    const { yamlPath, localPath } = placement(source, asset, archiveRoot);
    const store: ObjectStoreLocation = {
      provider: objectStore.provider,
      bucket: objectStore.bucket,
      key: asset.objectStoreKey,
      endpoint: objectStore.endpoint,
    };
    const fields: ProvenanceFields = {
      id: source.sourceId,
      title,
      type: companionType(asset),
      case: source.case ?? deriveSourceLayout(source).case,
      language: source.language ?? 'French',
      source_archive: record.sourceArchive,
      catalog_url: catalogUrl,
      original_url: record.originalUrl ?? asset.sourceUrl,
      rights_status: rightsStatus,
      retrieved,
      local_path: localPath,
      sha256: asset.checksum,
      format: asset.mediaType,
      ocr_status: 'none',
      size: asset.byteLength,
      object_store: store,
      rights_raw: rightsRaw,
      notes: null,
    };
    await writeProvenance(yamlPath, fields);
    written.push(yamlPath);
  }
  return written;
}
