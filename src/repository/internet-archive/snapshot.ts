/**
 * `recordItemSnapshot` -- T020's Internet Archive metadata-snapshot recorder
 * for the archive.org acquisition adapter (specs/013-archiveorg-acquisition-path).
 *
 * Delegates entirely to the shipped, write-once metadata-snapshot store
 * (`@/sourcegroup/snapshot`'s `writeSnapshot`) -- this module never
 * re-implements storage, slugging, or the write-once guard. It only maps an
 * archive.org `ItemMetadata` (from `@/repository/internet-archive/metadata`)
 * onto that store's `MetadataSnapshotInput` shape:
 *
 * - `sourceId`             <- caller-supplied
 * - `ark`                  <- `item.identifier` (the IA item id acts as the
 *                             "ark" slug for the snapshot path)
 * - `raw`                  <- `item.raw` (the exact response body, verbatim)
 * - `retrievedAt`          <- caller-supplied
 * - `endpoint`             <- `item.metadataEndpoint`
 * - `normalizationVersion` <- `IA_NORMALIZATION_VERSION`
 * - `stamp`                <- caller-supplied
 *
 * `retrievedAt` and `stamp` are injected by the caller rather than derived
 * here (no `Date.now()` inside this module) -- mirroring how
 * `runMuseumInventory` supplies both to `writeSnapshot` (see
 * `src/sourcegroup/museum-inventory.ts`), so recording stays deterministic
 * and testable.
 *
 * See specs/013-archiveorg-acquisition-path/data-model.md § "Metadata snapshot".
 */

import { writeSnapshot } from '@/sourcegroup/snapshot';
import type { MetadataSnapshotRef } from '@/sourcegroup/snapshot';
import type { ItemMetadata } from '@/repository/internet-archive/metadata';

/**
 * The normalization scheme version this IA adapter applies, paralleling
 * `MUSEUM_NORMALIZATION_VERSION` (`src/sourcegroup/museum-inventory.ts`).
 * Bump when the fields this adapter derives from an archive.org item's
 * metadata change shape.
 */
export const IA_NORMALIZATION_VERSION = 1;

/**
 * Record an archive.org item's metadata JSON via the shipped, write-once
 * snapshot store and return the `MetadataSnapshotRef` to attach to the
 * owning `RepositoryRecord.metadataSnapshot`.
 *
 * `retrievedAt` and `stamp` are caller-supplied (injected, not generated
 * here) so this function -- and its tests -- remain deterministic.
 */
export async function recordItemSnapshot(
  baseDir: string,
  sourceId: string,
  item: ItemMetadata,
  retrievedAt: string,
  stamp: string,
): Promise<MetadataSnapshotRef> {
  return writeSnapshot(baseDir, {
    sourceId,
    ark: item.identifier,
    raw: item.raw,
    retrievedAt,
    endpoint: item.metadataEndpoint,
    normalizationVersion: IA_NORMALIZATION_VERSION,
    stamp,
  });
}
