import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { assertInsideArchive } from '@/archive/location';
import { sha256OfBytes, sha256OfFile } from '@/archive/checksum';
import { objectKeyForAsset } from '@/archive/object-key';
import type { ObjectStore } from '@/archive/object-store';
import {
  readProvenance,
  writeProvenance,
  type ObjectStoreLocation,
  type ProvenanceFields,
} from '@/archive/provenance';

/** Repo-relative location of the integrity manifest inside the archive root. */
const MANIFEST_RELATIVE = path.join('manifests', 'MANIFEST.sha256');

/** Outcome of a {@link storeAsset} call. */
export interface StoreResult {
  /** Absolute path the asset lives at. */
  path: string;
  /** Lowercase-hex SHA-256 recorded for the asset. */
  sha256: string;
  /** True when an already-present, checksum-verified asset was left untouched. */
  skipped: boolean;
}

/** Outcome of a {@link verifyAsset} call (FR-008, `--verify`). */
export interface VerifyResult {
  /** Absolute path of the asset. */
  path: string;
  /** SHA-256 recorded in the companion YAML. */
  recorded: string;
  /** SHA-256 re-computed from the file on disk. */
  actual: string;
  /** True when recorded === actual. */
  ok: boolean;
}

/** Options for {@link storeAsset}. */
export interface StoreOptions {
  /** Re-fetch/rewrite even when a verified copy already exists. */
  force?: boolean;
  /**
   * When provided together with {@link StoreOptions.objectStoreCoords}, the
   * asset master is uploaded here (in addition to the local OCR cache) on the
   * write path, before provenance/manifest are written.
   */
  objectStore?: ObjectStore;
  /**
   * Coordinates recorded in the companion YAML's `object_store` block. The
   * object `key` is NOT taken from here -- it is re-derived from the archive
   * layout, same as `local_path`/`sha256`.
   */
  objectStoreCoords?: { provider: string; bucket: string; endpoint: string };
}

/**
 * Companion YAML path for an asset. Page images replace the extension
 * (`f001.jpg` -> `f001.yml`); other assets append it (`issue.pdf` ->
 * `issue.pdf.yml`), matching the archive convention.
 */
export function companionYamlPath(assetPath: string): string {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
    return `${assetPath.slice(0, assetPath.length - ext.length)}.yml`;
  }
  return `${assetPath}.yml`;
}

/** Read the recorded `sha256` from a companion YAML, or `null` if absent. */
async function readRecordedSha(yamlPath: string): Promise<string | null> {
  if (!existsSync(yamlPath)) {
    return null;
  }
  const text = await readFile(yamlPath, 'utf-8');
  const match = text.match(/^sha256:\s*"?([0-9a-f]{64})"?\s*$/m);
  return match ? match[1] : null;
}

/** Read `manifests/MANIFEST.sha256` into a `relPath -> sha256` map. */
async function readManifestEntries(
  manifestPath: string,
): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  if (existsSync(manifestPath)) {
    const existing = await readFile(manifestPath, 'utf-8');
    for (const line of existing.split('\n')) {
      const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/);
      if (match) {
        entries.set(match[2], match[1]);
      }
    }
  }
  return entries;
}

/**
 * Insert/replace a `<sha256>  <relPath>` line in the archive's
 * `manifests/MANIFEST.sha256`, keeping the file sorted by path so repeated
 * runs produce deterministic, diff-friendly output.
 */
async function updateManifest(
  archiveRoot: string,
  relPath: string,
  sha256: string,
): Promise<void> {
  const manifestPath = path.join(archiveRoot, MANIFEST_RELATIVE);
  const entries = await readManifestEntries(manifestPath);

  entries.set(relPath, sha256);

  const body = [...entries.keys()]
    .sort()
    .map((p) => `${entries.get(p)}  ${p}`)
    .join('\n');

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${body}\n`, 'utf-8');
}

/**
 * Ensure the manifest carries the correct `<sha256>  <relPath>` entry for an
 * asset, adding or repairing it only when it is absent or stale. Used on the
 * resumable SKIP path so an asset present + recorded on disk but missing from
 * `manifests/MANIFEST.sha256` (e.g. an interrupted earlier run) is not left
 * permanently unmanifested. No-op (no rewrite) when the entry already matches,
 * keeping the manifest deterministic across re-runs.
 */
async function ensureManifestEntry(
  archiveRoot: string,
  relPath: string,
  sha256: string,
): Promise<void> {
  const manifestPath = path.join(archiveRoot, MANIFEST_RELATIVE);
  const entries = await readManifestEntries(manifestPath);
  if (entries.get(relPath) === sha256) {
    return;
  }
  await updateManifest(archiveRoot, relPath, sha256);
}

/**
 * True when an asset is already fully recorded: the file exists AND its
 * companion YAML records a sha256 that matches the file's current bytes. This
 * lets a resumable fetch skip the DOWNLOAD (not merely the write) for pages it
 * has already completed and verified (FR-009 / SC-005). Never throws for a
 * missing or partial asset -- those are simply "not recorded" and get fetched.
 */
export async function isAssetRecorded(targetPath: string): Promise<boolean> {
  if (!existsSync(targetPath)) {
    return false;
  }
  const recorded = await readRecordedSha(companionYamlPath(targetPath));
  if (recorded === null) {
    return false;
  }
  const onDisk = await sha256OfFile(targetPath);
  return onDisk === recorded;
}

/**
 * Store one asset's bytes into the private archive, with its companion YAML
 * provenance and an updated integrity manifest (T022, T019, FR-006..009).
 *
 * - The write-guard runs FIRST: any target outside the archive throws and
 *   nothing is written (no override).
 * - Resumability, LEGACY path (FR-009): when NO object store is configured,
 *   `force` is not set, and the asset already exists AND its on-disk bytes
 *   hash to the sha256 recorded in the companion YAML, the asset is left
 *   untouched and `skipped: true` is returned.
 * - Resumability, OBJECT-STORE path (FR-006, SC-003): when an object store
 *   IS configured, the idempotent skip is instead driven by a B2 `head(key)`
 *   check on the write path, not by local file presence -- a locally-verified
 *   file is not "done" until it is also confirmed present in the object store
 *   at the matching sha256. A present-but-different object (hash mismatch) is
 *   re-uploaded, never silently treated as already done. `force: true` always
 *   re-uploads regardless of what `head` reports.
 * - `local_path`, `sha256` and `size` on the provenance record are always
 *   (re)derived here from the actual bytes and target, never trusted from the
 *   caller.
 */
export async function storeAsset(
  bytes: Uint8Array,
  targetPath: string,
  provenanceFields: ProvenanceFields,
  archiveRoot: string,
  options: StoreOptions = {},
): Promise<StoreResult> {
  const yamlPath = companionYamlPath(targetPath);

  // FR-006: guard both the asset and its sidecar BEFORE any filesystem write.
  assertInsideArchive(targetPath, archiveRoot);
  assertInsideArchive(yamlPath, archiveRoot);

  const sha256 = sha256OfBytes(bytes);
  const relPath = path.relative(path.resolve(archiveRoot), path.resolve(targetPath));

  const objectStoreConfigured =
    options.objectStore !== undefined && options.objectStoreCoords !== undefined;

  // FR-009 resumability (LEGACY, no object store): skip a present,
  // checksum-verified asset. Only applies when no object store is configured
  // -- once one is, the B2 `head` check below is the sole skip driver, so
  // this branch never double-skips or fights it.
  if (!objectStoreConfigured && options.force !== true && existsSync(targetPath)) {
    const recorded = await readRecordedSha(yamlPath);
    if (recorded !== null) {
      const onDisk = await sha256OfFile(targetPath);
      if (onDisk === recorded) {
        // Integrity repair: even though the bytes are untouched, guarantee the
        // manifest records this asset before returning -- an asset on disk but
        // missing from MANIFEST.sha256 would otherwise stay missing forever.
        await ensureManifestEntry(archiveRoot, relPath, recorded);
        return { path: targetPath, sha256: recorded, skipped: true };
      }
    }
  }

  let objectStoreLocation: ObjectStoreLocation | null = provenanceFields.object_store;
  let skipped = false;

  if (options.objectStore !== undefined && options.objectStoreCoords !== undefined) {
    const store = options.objectStore;
    const coords = options.objectStoreCoords;
    const key = objectKeyForAsset(archiveRoot, targetPath);

    // T019/FR-006/SC-003: the write-path skip is driven by B2's own head, not
    // by local file presence. `force` bypasses the head check entirely.
    let shouldUpload = true;
    if (options.force !== true) {
      const head = await store.head(key);
      if (head.exists === true && head.sha256 === sha256) {
        shouldUpload = false;
        skipped = true;
      }
    }

    if (shouldUpload) {
      // Write the local cache file, then upload the master BEFORE writing
      // provenance so the companion YAML never claims an upload that did not
      // happen. A failed put propagates and no provenance/manifest is
      // written (T014).
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, bytes);
      await store.put(key, bytes, {
        sha256,
        contentType: provenanceFields.format,
      });
    } else if (!existsSync(targetPath)) {
      // Skip path: no re-upload, but ensure the local cache file exists so
      // on-disk state is consistent even if it was never written locally.
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, bytes);
    }

    // The recorded `object_store.key` is RE-DERIVED here (never trusted from
    // the caller), same principle as `local_path`/`sha256`.
    objectStoreLocation = {
      provider: coords.provider,
      bucket: coords.bucket,
      key,
      endpoint: coords.endpoint,
    };
  } else {
    // No object store configured: always write the local cache file (the
    // legacy skip branch above already returned early for the resumable
    // case).
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, bytes);
  }

  const record: ProvenanceFields = {
    ...provenanceFields,
    local_path: relPath,
    sha256,
    size: bytes.length,
    object_store: objectStoreLocation,
  };

  await writeProvenance(yamlPath, record);
  await updateManifest(archiveRoot, relPath, sha256);

  return { path: targetPath, sha256, skipped };
}

/** Options for {@link verifyAsset}. */
export interface VerifyAssetOptions {
  /**
   * When provided AND the asset's companion YAML records a non-null
   * `object_store` block, verification fetches the asset's bytes FROM THE
   * OBJECT STORE (not the local file) and compares their sha256 against the
   * recorded checksum (FR-008, SC-002/SC-004). Omitted, or the companion has
   * `object_store: null` (a legacy, never-uploaded asset), falls back to the
   * existing local-file verification.
   */
  objectStore?: ObjectStore;
}

/**
 * Re-hash bytes fetched from the object store at the companion's recorded
 * `object_store.key` and compare against the recorded sha256 (SC-002). A
 * missing object (the store's `get` throws, e.g. deleted or never uploaded)
 * is a verification FAILURE, reported as `ok: false` with a diagnostic
 * `actual` -- never an unhandled crash and never a silent pass (SC-004).
 */
async function verifyAssetInObjectStore(
  assetPath: string,
  provenance: ProvenanceFields,
  objectStore: ObjectStore,
): Promise<VerifyResult> {
  const location = provenance.object_store;
  if (location === null) {
    throw new Error(
      `verifyAssetInObjectStore: called with a null object_store block for ${assetPath}`,
    );
  }
  const recorded = provenance.sha256;

  let bytes: Uint8Array;
  try {
    bytes = await objectStore.get(location.key);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      path: assetPath,
      recorded,
      actual: `MISSING in object store at key "${location.key}": ${message}`,
      ok: false,
    };
  }

  const actual = sha256OfBytes(bytes);
  return { path: assetPath, recorded, actual, ok: actual === recorded };
}

/**
 * Re-hash an existing asset and compare against the sha256 recorded in its
 * companion YAML (FR-008, `--verify`). Fails loud when the asset or its
 * companion (or its recorded checksum) is missing -- there is nothing to
 * verify against, and a silent pass would defeat the check.
 *
 * When `options.objectStore` is provided AND the companion's `object_store`
 * block is non-null, verification instead compares the OBJECT STORE copy's
 * bytes against the recorded sha256 (see {@link verifyAssetInObjectStore}) --
 * this is the `--verify` path that catches a local-only checksum match hiding
 * a corrupted or missing B2 master (SC-002/SC-004). A legacy asset with
 * `object_store: null`, or a call with no `objectStore` option at all, keeps
 * the original local-file behavior unchanged.
 */
export async function verifyAsset(
  assetPath: string,
  options: VerifyAssetOptions = {},
): Promise<VerifyResult> {
  if (!existsSync(assetPath)) {
    throw new Error(`verifyAsset: asset does not exist: ${assetPath}`);
  }
  const yamlPath = companionYamlPath(assetPath);

  if (options.objectStore !== undefined) {
    if (!existsSync(yamlPath)) {
      throw new Error(
        `verifyAsset: no companion ${yamlPath} for ${assetPath} (cannot resolve object_store)`,
      );
    }
    const provenance = await readProvenance(yamlPath);
    if (provenance.object_store !== null) {
      return verifyAssetInObjectStore(assetPath, provenance, options.objectStore);
    }
  }

  const recorded = await readRecordedSha(yamlPath);
  if (recorded === null) {
    throw new Error(
      `verifyAsset: no recorded sha256 for ${assetPath} ` +
        `(missing or malformed companion ${yamlPath})`,
    );
  }
  const actual = await sha256OfFile(assetPath);
  return { path: assetPath, recorded, actual, ok: actual === recorded };
}
