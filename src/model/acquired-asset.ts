import type { ObjectStoreLocation } from '@/archive/provenance';

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
  role?: string;
  /** Order within the item, for multi-page/multi-asset copies. */
  sequence?: number;
  /** How "best representation" was chosen, e.g. `max-resolution`. */
  representationChoice?: string;
}
