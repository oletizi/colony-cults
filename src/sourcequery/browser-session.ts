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

  /**
   * Fetch the raw bytes at `url` INSIDE the open, WAF-cleared browser context
   * (an in-page `fetch` that reuses the browser's cookies, TLS, and origin), so
   * an Incapsula/Cloudflare-gated CDN that a stateless client cannot reach is
   * served the asset it would serve the cleared browser. The session MUST be
   * open AND already navigated to a page on the SAME ORIGIN as `url` (call
   * `navigate` first) — the in-page fetch runs in that page's context. Fails
   * loud (throws) on a non-OK response or a closed/never-navigated session;
   * never returns a challenge body as if it were the asset.
   */
  fetchBytes(url: string): Promise<Uint8Array>;

  /** Close the session, releasing any underlying resources. */
  close(): Promise<void>;
}
