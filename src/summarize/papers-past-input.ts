/**
 * Detection + widening helpers for a source-group MEMBER whose reading text is
 * a DETACHED `ocr-text` asset (Papers Past today) rather than an on-disk
 * `issue.txt`.
 *
 * CONVERGENCE (spec 017): the interim Papers Past input adapter that lived here
 * -- it re-resolved the `ocr-text` asset and PRE-FETCHED the `.txt` from the
 * CDN/B2 itself -- has been REMOVED. That duplicated the canonical mechanism
 * `@/archive/issue-text-materialize`'s `materializeIssueText`, which rehydrates
 * the SAME detached `ocr-text` asset into a standard `issue.txt` PLUS a full
 * `ProvenanceFields` `issue.txt.yml` sidecar (idempotent, crash-safe,
 * fail-loud). Its design intent -- "downstream readers do not need to know
 * which path produced it" -- is exactly what the summarizer now relies on:
 * `@/summarize/select-input` materializes via `materializeIssueText`, then
 * selects the resulting `issue.txt` through its NORMAL English-OCR path.
 *
 * What remains here is only the thin, fetch-free glue the summarizer needs to
 * decide "is this a member that must be materialized?" ({@link
 * hasDetachedOcrTextAsset}) and to hand `materializeIssueText` the widened
 * `Source & { repositoryRecords }` shape it consumes ({@link
 * toMemberWithRecords}). No CDN base, no `fetch`, no bespoke `.txt` read.
 */

import { authoredToRepositoryRecord } from '@/bibliography/authored-record';
import type { LoadedSource } from '@/bibliography/load';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/**
 * A `Source` carrying its widened `repositoryRecords` -- the exact shape
 * `materializeIssueText` (`@/archive/issue-text-materialize`) consumes.
 */
export type MemberWithRecords = Source & { repositoryRecords: RepositoryRecord[] };

/**
 * True when `loaded` carries a detached `ocr-text`-role asset across its
 * repository records -- i.e. a source-group member (e.g. a Papers Past
 * clipping) whose reading text is a B2-resident `<sha>.txt`, NOT an inline
 * `issue.txt`, and therefore must be rehydrated via `materializeIssueText`
 * before the summarizer can select it. A source with no such asset (a Gallica
 * periodical/monograph with an on-disk `issue.txt`) returns `false` and takes
 * the summarizer's ordinary on-disk path unchanged.
 */
export function hasDetachedOcrTextAsset(loaded: LoadedSource): boolean {
  return loaded.records.some((record) =>
    (record.assets ?? []).some((asset) => asset.role === 'ocr-text'),
  );
}

/**
 * Widen a {@link LoadedSource}'s authored repository records into the full
 * `RepositoryRecord` shape `materializeIssueText` requires, attaching the
 * owning `sourceId` (the SSOT's one-file-per-source layout implies it) via
 * `authoredToRepositoryRecord`. Pure -- no I/O.
 */
export function toMemberWithRecords(loaded: LoadedSource): MemberWithRecords {
  const repositoryRecords = loaded.records.map((record) =>
    authoredToRepositoryRecord(loaded.source.sourceId, record),
  );
  return { ...loaded.source, repositoryRecords };
}
