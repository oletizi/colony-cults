import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { assertInsideArchive } from '@/archive/location';
import { sha256OfBytes, sha256OfFile } from '@/archive/checksum';
import {
  writeProvenance,
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
 * provenance and an updated integrity manifest (T022, FR-006..009).
 *
 * - The write-guard runs FIRST: any target outside the archive throws and
 *   nothing is written (no override).
 * - Resumability (FR-009): when `force` is not set and the asset already
 *   exists AND its on-disk bytes hash to the sha256 recorded in the companion
 *   YAML, the asset is left untouched and `skipped: true` is returned.
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

  // FR-009 resumability: skip a present, checksum-verified asset.
  if (options.force !== true && existsSync(targetPath)) {
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

  const record: ProvenanceFields = {
    ...provenanceFields,
    local_path: relPath,
    sha256,
    size: bytes.length,
  };

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);
  await writeProvenance(yamlPath, record);
  await updateManifest(archiveRoot, relPath, sha256);

  return { path: targetPath, sha256, skipped: false };
}

/**
 * Re-hash an existing asset and compare against the sha256 recorded in its
 * companion YAML (FR-008, `--verify`). Fails loud when the asset or its
 * companion (or its recorded checksum) is missing -- there is nothing to
 * verify against, and a silent pass would defeat the check.
 */
export async function verifyAsset(assetPath: string): Promise<VerifyResult> {
  if (!existsSync(assetPath)) {
    throw new Error(`verifyAsset: asset does not exist: ${assetPath}`);
  }
  const yamlPath = companionYamlPath(assetPath);
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
