/**
 * BrowserSession: injectable boundary around a single browser session used
 * to navigate to query result pages. Interface-first (Principle VI); the
 * real implementation (Playwright-backed) is added in a later task (T013).
 */
import type { PageResult } from '@/sourcequery/types';

/** A single browser session capable of navigating to URLs and returning page results. */
export interface BrowserSession {
  /** Launch/open the underlying browser session. Throws on launch failure. */
  open(): Promise<void>;

  /** Navigate to `url`, returning the resulting page's status/HTML/snapshot. */
  navigate(url: string): Promise<PageResult>;

  /** Close the session, releasing any underlying resources. */
  close(): Promise<void>;
}
