import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { AuthoredRepositoryRecord, CanonicalModel, IdentifierLeak } from '@/bibliography/model';
import type { LoadedSource } from '@/bibliography/load';
import type { ObjectStoreLocation } from '@/archive/provenance';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import { readAssetProvenance } from '@/bibliography/provenance-read';
import { sourceLayout } from '@/archive/location';
import type { AssetManifestRef, RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/**
 * The fields `deriveModel`'s roll-up actually reads off a per-asset
 * provenance entry. {@link AssetProvenance} (the tolerant on-disk reader's
 * output, `@/bibliography/provenance-read`) and the strict `ProvenanceFields`
 * (`@/archive/provenance`) both satisfy this structurally: unit tests build
 * full `ProvenanceFields` objects (their extra fields are simply ignored
 * here), and {@link gatherProvenance} supplies `AssetProvenance` objects read
 * from disk, which never carry the optional acquisition fields below.
 */
export interface RollupProvenance {
  /** Holding archive, e.g. `Gallica / BnF`. */
  readonly source_archive: string;
  /** Archive-relative path of the asset. */
  readonly local_path: string;
  /** Object-store master location, or `null` for a legacy/not-yet-uploaded asset. */
  readonly object_store: ObjectStoreLocation | null;
  /** Catalog / issue landing URL, when the roll-up source carries one. */
  readonly catalog_url?: string;
  /** The exact origin URL the asset bytes were fetched from, when carried. */
  readonly original_url?: string;
  /** Retrieval timestamp (ISO), when carried. */
  readonly retrieved?: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEnoent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'ENOENT';
}

/**
 * Recursively collect every companion `.yml` provenance file under `dir`.
 * A missing `dir` is not an error -- it means the source has no mirrored
 * assets yet (e.g. `wanted`/`to-collect` status) -- so it yields no files.
 * Any other filesystem error (permissions, etc.) fails loud.
 */
async function collectYamlFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw new Error(`gatherProvenance: cannot read directory "${dir}": ${describeError(error)}`);
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectYamlFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.yml')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * ADAPTER: walk a source's asset directories and read every companion asset
 * YAML into {@link AssetProvenance}, using the TOLERANT reader
 * (`@/bibliography/provenance-read`) rather than the strict
 * `readProvenance` (`@/archive/provenance`) -- ~233 legacy asset sidecars
 * predate the `object_store`/`size` fields and are still valid assets
 * (FR-011), not corruption.
 *
 * `sourceLayout` roots the walk at the source's SLUG directory
 * (`<archiveRoot>/archive/cases/<case>/<type>/<slug>`), which already
 * excludes the case's sibling `metadata/` directory (source stubs,
 * `acquisition-register.csv`) -- those are not asset provenance and must
 * never be read as such.
 */
export async function gatherProvenance(
  sourceId: string,
  archiveRoot: string,
): Promise<AssetProvenance[]> {
  const layout = sourceLayout(sourceId);
  const sourceDir = path.join(archiveRoot, 'archive', 'cases', layout.case, layout.type, layout.slug);
  const yamlPaths = (await collectYamlFiles(sourceDir)).sort();
  const provenance: AssetProvenance[] = [];
  for (const yamlPath of yamlPaths) {
    provenance.push(await readAssetProvenance(yamlPath));
  }
  return provenance;
}

/** Group a source's provenance entries by `source_archive`. */
function groupByArchive(entries: readonly RollupProvenance[]): Map<string, RollupProvenance[]> {
  const groups = new Map<string, RollupProvenance[]>();
  for (const entry of entries) {
    const group = groups.get(entry.source_archive);
    if (group === undefined) {
      groups.set(entry.source_archive, [entry]);
    } else {
      group.push(entry);
    }
  }
  return groups;
}

/** The `provider`/`bucket`/`endpoint` shared by a copy's object-store-backed masters. */
interface SharedLocation {
  provider: string;
  bucket: string;
  endpoint: string;
}

/**
 * The shared storage location of a copy's object-store-backed assets, or
 * `null` when none of them are object-store-backed (all legacy/local-only).
 * Each asset's `object_store.key` is that asset's OWN archive-relative path,
 * so no two assets share an identical block by design -- only
 * `provider`/`bucket`/`endpoint` are expected to be identical across a
 * copy's masters (same bucket/endpoint config for the whole archive). A
 * mismatch among the object-store-backed assets is a data-integrity bug --
 * fail loud rather than silently pick one.
 */
function sharedLocation(entries: readonly RollupProvenance[]): SharedLocation | null {
  const backed = entries.filter(
    (entry): entry is RollupProvenance & { object_store: ObjectStoreLocation } =>
      entry.object_store !== null,
  );
  if (backed.length === 0) {
    return null;
  }
  const first = backed[0].object_store;
  const consistent = backed.every(
    (entry) =>
      entry.object_store.provider === first.provider &&
      entry.object_store.bucket === first.bucket &&
      entry.object_store.endpoint === first.endpoint,
  );
  if (!consistent) {
    throw new Error(
      'buildManifest: object-store-backed assets in this copy do not share the same ' +
        'provider/bucket/endpoint -- data integrity issue',
    );
  }
  return { provider: first.provider, bucket: first.bucket, endpoint: first.endpoint };
}

/**
 * The longest common ancestor directory of a set of archive-relative asset
 * paths, used as the manifest's representative directory (object-store `key`
 * or the local-path fallback) -- the copy's asset DIRECTORY, not any single
 * asset's own path.
 */
function commonDirectory(paths: readonly string[]): string {
  if (paths.length === 0) {
    throw new Error('commonDirectory: cannot compute a common directory from zero paths');
  }
  const dirSegments = paths.map((p) => p.split('/').slice(0, -1));
  let common = dirSegments[0];
  for (const segments of dirSegments.slice(1)) {
    let i = 0;
    while (i < common.length && i < segments.length && segments[i] === common[i]) {
      i += 1;
    }
    common = common.slice(0, i);
  }
  return common.join('/');
}

/** Build one archive's `AssetManifestRef` from its grouped provenance entries. */
function buildManifest(entries: readonly RollupProvenance[]): AssetManifestRef {
  const location = sharedLocation(entries);
  const directory = commonDirectory(entries.map((entry) => entry.local_path));
  const manifest: AssetManifestRef = {
    assetCount: entries.length,
    objectStore: location === null ? null : { ...location, key: directory },
  };
  if (location === null) {
    manifest.localPath = directory;
  }
  return manifest;
}

/** Merge one `(sourceId, sourceArchive)` key's authored + derived data (authored overrides). */
function mergeRecord(
  sourceId: string,
  sourceArchive: string,
  authored: AuthoredRepositoryRecord | undefined,
  derivedEntries: RollupProvenance[] | undefined,
): RepositoryRecord {
  const manifest = derivedEntries !== undefined ? buildManifest(derivedEntries) : undefined;

  if (authored !== undefined) {
    // Authored acquisition fields win; the derived manifest (if any) attaches.
    // An authored-only key (derivedEntries undefined, e.g. PB-P001's restored
    // SLQ copy) survives here with no manifest -- it is not dropped.
    const record: RepositoryRecord = { sourceId, sourceArchive, status: authored.status };
    if (authored.catalogUrl !== undefined) {
      record.catalogUrl = authored.catalogUrl;
    }
    if (authored.originalUrl !== undefined) {
      record.originalUrl = authored.originalUrl;
    }
    if (authored.retrievedAt !== undefined) {
      record.retrievedAt = authored.retrievedAt;
    }
    if (authored.identifiers !== undefined) {
      record.identifiers = authored.identifiers;
    }
    if (authored.rights !== undefined) {
      record.rights = authored.rights;
    }
    if (manifest !== undefined) {
      record.manifest = manifest;
    }
    return record;
  }

  // Derived-only: no authored record exists for this key. Surface what
  // provenance tells us. `RepositoryRecord.status` is a required string (not
  // optional), so an unknown status is represented by the empty-string
  // sentinel -- the later required-field validator (T027) flags it, rather
  // than this module fabricating a status value.
  if (derivedEntries === undefined || derivedEntries.length === 0) {
    throw new Error(
      `deriveModel: internal error -- no authored or derived data for ` +
        `(${sourceId}, ${sourceArchive})`,
    );
  }
  const representative = derivedEntries[0];
  // `rights` is intentionally left unset here: the roll-up carries
  // rights_status/rights_raw only via the strict `ProvenanceFields` shape
  // (when tests supply it) but no per-copy `ark`, so a faithful `Rights`
  // object (which requires one) cannot be derived without fabricating a
  // field -- omitting it is more honest than mock data. Likewise
  // catalog_url/original_url/retrieved are OPTIONAL on `RollupProvenance` --
  // the tolerant on-disk reader never carries them -- so only set the
  // record's fields when the roll-up source actually supplied them.
  const record: RepositoryRecord = {
    sourceId,
    sourceArchive,
    status: '',
  };
  if (representative.catalog_url !== undefined) {
    record.catalogUrl = representative.catalog_url;
  }
  if (representative.original_url !== undefined) {
    record.originalUrl = representative.original_url;
  }
  if (representative.retrieved !== undefined) {
    record.retrievedAt = representative.retrieved;
  }
  if (manifest !== undefined) {
    record.manifest = manifest;
  }
  return record;
}

/**
 * PURE core: build the {@link CanonicalModel} from the authored SSOT entries
 * and each source's provenance-derived roll-up. The final `repositoryRecords`
 * is the UNION over `(sourceId, sourceArchive)` of authored and derived
 * records (C1 / FR-013a / SC-005):
 *
 * - key in both -> one record: authored acquisition fields (authored
 *   overrides), derived `manifest` attached.
 * - key only in authored (no provenance) -> the record SURVIVES with its
 *   authored fields and no manifest (e.g. PB-P001's restored SLQ copy).
 * - key only in derived -> a record surfaced from provenance, `status` unset
 *   (empty-string sentinel).
 *
 * Issue-layer derivation from the census is out of scope here (T024); `issues`
 * is left unset.
 */
export function deriveModel(
  authored: LoadedSource[],
  provenanceBySource: ReadonlyMap<string, readonly RollupProvenance[]>,
): CanonicalModel {
  const sources: Source[] = authored.map((entry) => entry.source);
  const repositoryRecords: RepositoryRecord[] = [];
  const identifierLeaks: IdentifierLeak[] = authored.flatMap((entry) => entry.identifierLeaks);

  for (const entry of authored) {
    const sourceId = entry.source.sourceId;
    const provenance = provenanceBySource.get(sourceId) ?? [];
    const derivedByArchive = groupByArchive(provenance);
    const authoredByArchive = new Map(entry.records.map((record) => [record.sourceArchive, record]));

    const archives = [...new Set([...derivedByArchive.keys(), ...authoredByArchive.keys()])].sort();
    for (const sourceArchive of archives) {
      repositoryRecords.push(
        mergeRecord(
          sourceId,
          sourceArchive,
          authoredByArchive.get(sourceArchive),
          derivedByArchive.get(sourceArchive),
        ),
      );
    }
  }

  return { sources, repositoryRecords, identifierLeaks };
}
