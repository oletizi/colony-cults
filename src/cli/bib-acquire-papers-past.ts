/**
 * Papers Past adapter wiring for `bib acquire` (T013), mirroring
 * `@/cli/bib-acquire-museum` in structure so `@/cli/bib-sourcegroup-acquire`
 * stays under the project's size guideline.
 *
 * The single export builds the {@link PapersPastAdapter} ONLY when the
 * member's selected copy is a Papers Past (`papers-past`) record, so a
 * non-papers-past acquire never pays the browser/B2 construction cost (see
 * the function's doc comment, FR-011).
 */

import { loadAllSources } from '@/bibliography/load';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { HttpClient } from '@/gallica/http-client';
import { PapersPastAdapter } from '@/repository/papers-past/adapter';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { resolveObjectStoreConfig } from '@/archive/b2-config';
import type { RepositoryAdapter } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';

/**
 * Build the Papers Past adapter for `bib acquire` ONLY when the member's
 * SELECTED copy is a Papers Past (`papers-past`) record, so a non-papers-past
 * acquire never requires the Playwright browser session (the spec-014
 * Incapsula-WAF-clearing session) or the B2 credentials the Papers Past path
 * -- and only it -- uses. The registry dispatch in `runAcquire`
 * (`selectForRecord`) stays the source of truth; this peek merely decides
 * which heavy deps to construct here.
 *
 * Resilient by design: any failure to load/select the member's record yields
 * `undefined` (no Papers Past adapter), leaving `runAcquire` to surface the
 * real selection/precondition error with its own message rather than this
 * peek double-reporting it.
 */
export async function buildPapersPastAdapterForMember(
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

  const dispatchesToPapersPast = (record.identifiers ?? []).some(
    (i) => i.type === 'papers-past',
  );
  if (!dispatchesToPapersPast) {
    return undefined;
  }

  // Papers Past acquire mirrors the page-image facsimile to the object
  // store, so a real ObjectStore (B2) is REQUIRED here -- fail loud if its
  // config is absent rather than silently mirroring nothing. The Playwright
  // browser session clears the Incapsula WAF that gates the article page.
  return new PapersPastAdapter({
    browserSession: new PlaywrightBrowserSession(),
    byteFetch: new HttpClient(),
    objectStore: new S3ObjectStore(resolveObjectStoreConfig()),
  });
}
