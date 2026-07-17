/**
 * The Gallica capabilities `estimateIssue` depends on: the page count and one
 * sampled full-native page image (to measure a representative byte size).
 */
export interface EstimateClient {
  /** Page count (`nbVueImages`) for one issue. */
  pagination(issueArk: string): Promise<number>;
  /** Full native-resolution JPEG bytes for a page. */
  iiifImage(issueArk: string, page: number): Promise<Uint8Array>;
}

/** Result of a dry-run size estimate for one issue. */
export interface IssueEstimate {
  /**
   * Number of folios the estimate covers: the document's total page count
   * for a whole-document estimate, or the selection's size (`folios.length`)
   * when a folio selection (spec 012) is supplied.
   */
  pageCount: number;
  /** Byte size of the single sampled page. */
  sampleBytes: number;
  /** `sampleBytes * pageCount` — the estimated total download size. */
  estimatedBytes: number;
}

/**
 * Estimate an issue's total download size for `--dry-run` (T024, FR-010).
 *
 * Approach: read the authoritative page count, sample one full-native JPEG
 * once (through the polite {@link EstimateClient}, so pacing/backoff still
 * apply), measure its bytes, and multiply. This reads one page but writes
 * NOTHING — the dry-run guarantee is about not mutating the archive.
 *
 * `folios` (spec 012, optional): when supplied, EVERY requested folio is
 * bounds-checked against the real page count first (out-of-range throws,
 * matching the fetch core's fail-loud guarantee for `--dry-run --pages` too),
 * the sample is taken from the selection's first folio instead of page 1, and
 * the estimate is scaled to `folios.length` rather than the whole document --
 * so a dry-run preview of an excerpt reports ONLY the excerpt. Absent (the
 * default) is unchanged: sample page 1, scale to the full page count.
 */
export async function estimateIssue(
  issueArk: string,
  client: EstimateClient,
  folios?: number[],
): Promise<IssueEstimate> {
  const totalPageCount = await client.pagination(issueArk);
  if (!Number.isInteger(totalPageCount) || totalPageCount < 1) {
    throw new Error(
      `estimateIssue: issue ${issueArk} reported a non-positive page count ` +
        `(${totalPageCount})`,
    );
  }

  if (folios !== undefined) {
    if (folios.length === 0) {
      throw new Error(
        `estimateIssue: empty folio selection for issue ${issueArk} -- ` +
          `nothing to estimate`,
      );
    }
    for (const folio of folios) {
      if (!Number.isInteger(folio) || folio < 1 || folio > totalPageCount) {
        throw new Error(
          `estimateIssue: requested folio ${folio} is out of bounds for ` +
            `issue ${issueArk} (valid folios are 1..${totalPageCount})`,
        );
      }
    }
  }

  const sampleFolio = folios !== undefined ? folios[0] : 1;
  const sample = await client.iiifImage(issueArk, sampleFolio);
  const sampleBytes = sample.byteLength;
  if (sampleBytes === 0) {
    throw new Error(
      `estimateIssue: sampled page ${sampleFolio} of ${issueArk} was empty; ` +
        `cannot estimate`,
    );
  }

  const pageCount = folios !== undefined ? folios.length : totalPageCount;

  return {
    pageCount,
    sampleBytes,
    estimatedBytes: sampleBytes * pageCount,
  };
}
