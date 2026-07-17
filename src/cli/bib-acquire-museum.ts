/**
 * Museum-adapter wiring for `bib acquire` (T019), extracted from
 * `@/cli/bib-sourcegroup` to keep that file under the project's size guideline.
 *
 * The single export builds the {@link NewItalyMuseumAdapter} ONLY when the
 * member's selected copy is a museum (`accession`) record, so a Gallica (`ark`)
 * acquire never pays the codex/B2 cost of the museum path (see the function's
 * doc comment).
 */

import { loadAllSources } from '@/bibliography/load';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { HttpClient } from '@/gallica/http-client';
import { NewItalyMuseumAdapter } from '@/repository/new-italy-museum/adapter';
import { createMusarchExtractor } from '@/repository/new-italy-museum/extractor';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { resolveObjectStoreConfig } from '@/archive/b2-config';
import type { RepositoryAdapter } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Build the museum adapter for `bib acquire` ONLY when the member's SELECTED
 * copy is a museum (`accession`) record, so a Gallica (`ark`) acquire never
 * requires the codex engine (`createMusarchExtractor`'s preflight) or the B2
 * credentials the museum path -- and only it -- uses. The registry dispatch in
 * `runAcquire` (`selectForRecord`) stays the source of truth; this peek merely
 * decides which heavy deps to construct here.
 *
 * Resilient by design: any failure to load/select the member's record yields
 * `undefined` (no museum adapter), leaving `runAcquire` to surface the real
 * selection/precondition error with its own message rather than this peek
 * double-reporting it.
 */
export async function buildMuseumAdapterForMember(
  sourcesDir: string,
  id: string,
  archive: string | undefined,
): Promise<RepositoryAdapter | undefined> {
  let record: RepositoryRecord;
  try {
    const loaded = loadAllSources(sourcesDir);
    const entry = loaded.find((e) => e.source.sourceId === id);
    if (entry === undefined) {
      return undefined;
    }
    const candidates: RepositoryRecord[] = entry.records.map((authored) => ({
      ...authored,
      sourceId: entry.source.sourceId,
    }));
    record = selectRepositoryRecord(candidates, archive);
  } catch {
    return undefined;
  }

  const dispatchesToMuseum = (record.identifiers ?? []).some(
    (identifier) => identifier.type === 'accession',
  );
  if (!dispatchesToMuseum) {
    return undefined;
  }

  // Museum acquire mirrors the master image to the object store, so a real
  // ObjectStore (B2) is REQUIRED here -- fail loud if its config is absent
  // rather than silently mirroring nothing. `createMusarchExtractor` runs the
  // codex preflight (used by `resolve`, not `acquire`) and satisfies the
  // adapter's constructor invariant.
  const extractor = await createMusarchExtractor();
  const objectStore = new S3ObjectStore(resolveObjectStoreConfig());
  return new NewItalyMuseumAdapter({
    client: new HttpClient(),
    extractor,
    objectStore,
  });
}
