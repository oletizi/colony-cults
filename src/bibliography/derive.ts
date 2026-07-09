import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { AuthoredRepositoryRecord, CanonicalModel, IdentifierLeak } from '@/bibliography/model';
import type { LoadedSource } from '@/bibliography/load';
import type { ObjectStoreLocation, ProvenanceFields } from '@/archive/provenance';
import { readProvenance } from '@/archive/provenance';
import { sourceLayout } from '@/archive/location';
import type { AssetManifestRef, RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

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
 * ADAPTER: walk a source's archive directory and read every companion
 * provenance YAML into {@link ProvenanceFields}. Ground truth for asset
 * location: `src/archive/location.ts` (`sourceLayout`) and
 * `src/archive/provenance.ts` (`readProvenance`).
 */
export async function gatherProvenance(
  sourceId: string,
  archiveRoot: string,
): Promise<ProvenanceFields[]> {
  const layout = sourceLayout(sourceId);
  const sourceDir = path.join(archiveRoot, 'archive', 'cases', layout.case, layout.type, layout.slug);
  const yamlPaths = (await collectYamlFiles(sourceDir)).sort();
  const provenance: ProvenanceFields[] = [];
  for (const yamlPath of yamlPaths) {
    provenance.push(await readProvenance(yamlPath));
  }
  return provenance;
}

/** Group a source's provenance entries by `source_archive`. */
function groupByArchive(entries: ProvenanceFields[]): Map<string, ProvenanceFields[]> {
  const groups = new Map<string, ProvenanceFields[]>();
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

function objectStoreEquals(a: ObjectStoreLocation, b: ObjectStoreLocation): boolean {
  return (
    a.provider === b.provider && a.bucket === b.bucket && a.key === b.key && a.endpoint === b.endpoint
  );
}

/** The shared `object_store` block if every asset in the group has the exact same one, else `null`. */
function sharedObjectStore(entries: ProvenanceFields[]): ObjectStoreLocation | null {
  const first = entries[0].object_store;
  if (first === null) {
    return null;
  }
  const shared = entries.every((entry) => {
    const location = entry.object_store;
    return location !== null && objectStoreEquals(location, first);
  });
  return shared ? first : null;
}

/** Build one archive's `AssetManifestRef` from its grouped provenance entries. */
function buildManifest(entries: ProvenanceFields[]): AssetManifestRef {
  const objectStore = sharedObjectStore(entries);
  const manifest: AssetManifestRef = {
    assetCount: entries.length,
    objectStore,
  };
  if (objectStore === null) {
    manifest.localPath = entries[0].local_path;
  }
  return manifest;
}

/** Merge one `(sourceId, sourceArchive)` key's authored + derived data (authored overrides). */
function mergeRecord(
  sourceId: string,
  sourceArchive: string,
  authored: AuthoredRepositoryRecord | undefined,
  derivedEntries: ProvenanceFields[] | undefined,
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
  // `rights` is intentionally left unset here: ProvenanceFields carries
  // rights_status/rights_raw but no per-copy `ark`, so a faithful `Rights`
  // object (which requires one) cannot be derived without fabricating a
  // field -- omitting it is more honest than mock data.
  const record: RepositoryRecord = {
    sourceId,
    sourceArchive,
    status: '',
    catalogUrl: representative.catalog_url,
    originalUrl: representative.original_url,
    retrievedAt: representative.retrieved,
  };
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
  provenanceBySource: Map<string, ProvenanceFields[]>,
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
