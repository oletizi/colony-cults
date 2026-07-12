import type { SearchLogEntry } from '@/bibliography/search-log';
import type {
  CoverageSearchHistory,
  RepositoryRollup,
  SearchMatrixCell,
} from '@/bibliography/coverage/coverage-model';

/**
 * The search-history projection (T025, FR-013): a repository x campaign matrix
 * and a repository-axis rollup, both PURE over the already-loaded search log.
 *
 * - `matrix`: one cell per (repository, campaign) pair present in the log.
 *   `lastSearched` is the max date across that pair's entries; `openQuestions`
 *   is the `remainingQuestions` of the LATEST entry for that pair -- NOT a
 *   union across all history. A question recorded by an early search and
 *   omitted by a later one is treated as closed; the authoring convention is
 *   that each search entry records the questions still open AS OF that search
 *   (carry forward the still-open ones, drop the resolved ones). This keeps
 *   `openQuestions` meaning "currently open" and pairs coherently with
 *   `lastSearched` (both come from the latest search).
 * - `byRepository`: one row per repository, treating each repository as a
 *   research object -- its `lastSearched` is the max across its campaigns and
 *   its `openQuestions` is the de-duplicated union of each campaign's CURRENT
 *   open questions (i.e. of the matrix cells for that repository), not of all
 *   history.
 *
 * ISO `YYYY-MM-DD` dates compare lexicographically, so string `>` yields the
 * chronological max (the loader enforces the ISO format, V10, so this holds).
 * Ordering is deterministic: entries are folded in (date, id) ascending order
 * -- so the last-folded entry for a bucket is its latest -- and the outputs
 * are sorted (repository, then campaign).
 */

/** One accumulating (repository, campaign) matrix bucket during the fold. */
interface MatrixAccumulator {
  repository: string;
  campaign: string;
  lastSearched: string;
  /** The latest-so-far entry's questions (replaced, not unioned, as the fold advances). */
  openQuestions: string[];
}

/** De-duplicate while preserving first-seen order (a stable set union). */
function dedupe(questions: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const question of questions) {
    if (!seen.has(question)) {
      seen.add(question);
      out.push(question);
    }
  }
  return out;
}

/** Entries in a deterministic (date, then id) ASCENDING order for a stable fold. */
function orderedEntries(searchLog: readonly SearchLogEntry[]): SearchLogEntry[] {
  return [...searchLog].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
  );
}

/**
 * Fold entries (in ascending (date, id) order) into (repository, campaign)
 * matrix buckets: `lastSearched` becomes the max date and `openQuestions`
 * becomes the LATEST entry's questions (each later entry REPLACES the bucket's
 * questions, so the final one -- the max entry -- wins).
 */
function accumulateMatrix(entries: readonly SearchLogEntry[]): MatrixAccumulator[] {
  const buckets = new Map<string, MatrixAccumulator>();
  for (const entry of entries) {
    const key = `${entry.repository} ${entry.campaign}`;
    const questions = entry.remainingQuestions ?? [];
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        repository: entry.repository,
        campaign: entry.campaign,
        lastSearched: entry.date,
        openQuestions: [...questions],
      });
      continue;
    }
    if (entry.date > existing.lastSearched) {
      existing.lastSearched = entry.date;
    }
    // Latest-entry-wins: the fold is date-ascending, so this (later) entry's
    // questions supersede the earlier ones. Resolved questions omitted here
    // correctly drop out of "currently open".
    existing.openQuestions = [...questions];
  }
  return [...buckets.values()];
}

/** Build the {@link CoverageSearchHistory}: matrix + repository-axis rollup. */
export function buildSearchHistory(searchLog: readonly SearchLogEntry[]): CoverageSearchHistory {
  const entries = orderedEntries(searchLog);

  const matrix: SearchMatrixCell[] = accumulateMatrix(entries)
    .map((bucket) => ({
      repository: bucket.repository,
      campaign: bucket.campaign,
      lastSearched: bucket.lastSearched,
      openQuestions: dedupe(bucket.openQuestions),
    }))
    .sort((a, b) =>
      a.repository === b.repository
        ? a.campaign.localeCompare(b.campaign)
        : a.repository.localeCompare(b.repository),
    );

  // The repository rollup aggregates each repository's CAMPAIGNS' current open
  // questions (the matrix cells), not raw history -- so a question closed in a
  // campaign's latest search is closed in the repository view too.
  const rollups = new Map<string, RepositoryRollup>();
  for (const cell of matrix) {
    const existing = rollups.get(cell.repository);
    if (existing === undefined) {
      rollups.set(cell.repository, {
        repository: cell.repository,
        lastSearched: cell.lastSearched,
        openQuestions: [...cell.openQuestions],
      });
      continue;
    }
    if (cell.lastSearched > existing.lastSearched) {
      existing.lastSearched = cell.lastSearched;
    }
    existing.openQuestions.push(...cell.openQuestions);
  }
  const byRepository: RepositoryRollup[] = [...rollups.values()]
    .map((rollup) => ({
      repository: rollup.repository,
      lastSearched: rollup.lastSearched,
      openQuestions: dedupe(rollup.openQuestions),
    }))
    .sort((a, b) => a.repository.localeCompare(b.repository));

  return { matrix, byRepository };
}
