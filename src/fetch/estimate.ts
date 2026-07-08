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
  /** Page count reported by the host (`nbVueImages`). */
  pageCount: number;
  /** Byte size of the single sampled page (page 1). */
  sampleBytes: number;
  /** `sampleBytes * pageCount` — the estimated total download size. */
  estimatedBytes: number;
}

/**
 * Estimate an issue's total download size for `--dry-run` (T024, FR-010).
 *
 * Approach: read the authoritative page count, sample page 1's full-native
 * JPEG once (through the polite {@link EstimateClient}, so pacing/backoff still
 * apply), measure its bytes, and multiply. This reads one page but writes
 * NOTHING — the dry-run guarantee is about not mutating the archive.
 */
export async function estimateIssue(
  issueArk: string,
  client: EstimateClient,
): Promise<IssueEstimate> {
  const pageCount = await client.pagination(issueArk);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(
      `estimateIssue: issue ${issueArk} reported a non-positive page count ` +
        `(${pageCount})`,
    );
  }

  const sample = await client.iiifImage(issueArk, 1);
  const sampleBytes = sample.byteLength;
  if (sampleBytes === 0) {
    throw new Error(
      `estimateIssue: sampled page 1 of ${issueArk} was empty; cannot estimate`,
    );
  }

  return {
    pageCount,
    sampleBytes,
    estimatedBytes: sampleBytes * pageCount,
  };
}
