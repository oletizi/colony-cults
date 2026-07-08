import type { Rights } from '@/model/rights';

/**
 * One fascicle (periodical) or the whole document (monograph) being fetched.
 *
 * See specs/001-gallica-fetcher/data-model.md § Issue.
 */
export interface Issue {
  /** Issue ark. */
  ark: string;
  /** Issue date. */
  date: string;
  /** Page count. */
  pageCount: number;
  /** Resolved before any download. */
  rights: Rights;
}
