/**
 * Shared test fixtures for sourcequery module.
 *
 * This module will hold test fakes and fixtures including:
 * - FakeBrowserSession (defined in T005)
 * - FakeTailscaleRunner (defined in T006)
 * - Fake clock/sleep utilities (defined in T007)
 *
 * These fakes are populated incrementally as their corresponding
 * interfaces and implementations are developed in later tasks.
 */
import type { BrowserSession } from '@/sourcequery/browser-session';
import type { PageResult } from '@/sourcequery/types';

/**
 * Script for a {@link FakeBrowserSession}: a per-URL response map plus an
 * optional fallback used for any URL not present in `responses`.
 */
export interface FakeBrowserSessionScript {
  responses?: Record<string, PageResult>;
  defaultResult?: PageResult;
}

/**
 * No-network test double for {@link BrowserSession}.
 * Returns scripted `PageResult`s keyed by URL (e.g. result page / challenge
 * stub / drop), falling back to `defaultResult` when provided. Records the
 * order of `navigate()` calls so tests can assert on navigation sequence.
 */
export class FakeBrowserSession implements BrowserSession {
  /** URLs passed to `navigate()`, in call order. */
  readonly navigateCalls: string[] = [];

  private readonly responses: Record<string, PageResult>;
  private readonly defaultResult: PageResult | undefined;
  private opened = false;
  private closed = false;

  constructor(script: FakeBrowserSessionScript = {}) {
    this.responses = script.responses ?? {};
    this.defaultResult = script.defaultResult;
  }

  /** Whether `open()` has been called and `close()` has not (yet). */
  get isOpen(): boolean {
    return this.opened && !this.closed;
  }

  async open(): Promise<void> {
    this.opened = true;
    this.closed = false;
  }

  async navigate(url: string): Promise<PageResult> {
    this.navigateCalls.push(url);
    const scripted = this.responses[url];
    if (scripted !== undefined) {
      return scripted;
    }
    if (this.defaultResult !== undefined) {
      return this.defaultResult;
    }
    throw new Error(
      `FakeBrowserSession: no scripted PageResult for URL: ${url}`,
    );
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
