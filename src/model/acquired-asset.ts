import type { ObjectStoreLocation } from '@/archive/provenance';

/**
 * Typed role values for an {@link AcquiredAsset}.
 * Represents the function of a multi-asset copy: `front`/`reverse` of a single
 * sheet, `page` numbers in a multi-page item, `primary` (the single master the
 * museum adapter writes), `repository-source` (a preserved source package such
 * as the Internet Archive item PDF), `page-master` (one per-page image the
 * Internet Archive adapter explodes), and `ocr-text` (one per-article OCR text
 * captured from the repository, e.g. the Papers Past correctable-text panel).
 * The tuple is the single source of truth; the union and the
 * {@link isAcquiredAssetRole} guard derive from it so the loader boundary
 * (`@/bibliography/load-fields`) can fail loud on an unknown stored role
 * rather than silently accepting it (Principle V).
 */
export const ACQUIRED_ASSET_ROLES = [
  'front',
  'reverse',
  'page',
  'primary',
  'repository-source',
  'page-master',
  'ocr-text',
] as const;

export type AcquiredAssetRole = (typeof ACQUIRED_ASSET_ROLES)[number];

/** Runtime guard: is `value` a known {@link AcquiredAssetRole}? */
export function isAcquiredAssetRole(value: string): value is AcquiredAssetRole {
  return (ACQUIRED_ASSET_ROLES as readonly string[]).includes(value);
}

/**
 * One preserved representation of a `RepositoryRecord`'s copy, produced by a
 * `RepositoryAdapter`'s `acquire` (contracts/repository-adapter.md
 * `AcquisitionResult.assets`). Multiple assets may exist per record
 * (front/reverse, page scans); a thumbnail is never a master.
 *
 * Deliberately NOT the same concept as `Asset` (`@/model/asset.ts`): `Asset`
 * models a page-image/derived-text file mirrored to a local git-cache path
 * (`localPath`, `pageOrdinal`) by the Gallica fetcher. `AcquiredAsset` models
 * a direct-to-object-store representation acquired by the newer adapter
 * architecture (no local git-cache path; `role`/`sequence` replace
 * `pageOrdinal`). Where a concept already exists it is reused rather than
 * duplicated under a new name: `objectStoreKey`'s type is tied to
 * {@link ObjectStoreLocation}'s `key` field (the same B2 object-key concept
 * used by `AssetManifestRef.objectStore`/`ProvenanceFields.object_store`) via
 * an indexed access type, and `checksum` is the same sha256-hex-digest
 * concept as `Asset.sha256`, renamed per the adapter contract to stay
 * algorithm-agnostic.
 *
 * See specs/011-museum-acquisition-path/data-model.md § AcquiredAsset.
 */
export interface AcquiredAsset {
  /** Original asset URL/locator the bytes were fetched from. */
  sourceUrl: string;
  /** MIME type, e.g. `image/jpeg`. */
  mediaType: string;
  /** B2 object-store key; same concept as `ObjectStoreLocation.key`. */
  objectStoreKey: ObjectStoreLocation['key'];
  /** Lowercase-hex sha256 digest of the asset bytes. */
  checksum: string;
  /** Integer byte count of the asset. */
  byteLength: number;
  /** Path to the git-tracked provenance record for this asset. */
  provenancePath: string;
  /** Role within a multi-asset copy, e.g. `front` / `reverse` / `page`. */
  role?: AcquiredAssetRole;
  /** Order within the item, for multi-page/multi-asset copies. */
  sequence?: number;
  /** How "best representation" was chosen, e.g. `max-resolution`. */
  representationChoice?: string;
  /**
   * The repository representation this asset was captured from, e.g.
   * `papers-past-text-tab` for the correctable-text OCR panel. Distinguishes
   * future alternative OCR sources (ALTO XML, downloadable text, corrected
   * editions). Optional/additive; absent on image masters.
   */
  sourceRepresentation?: string;
}
