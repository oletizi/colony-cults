/**
 * Shared test fixtures for the sourcequery module.
 *
 * Exports no-network test doubles for the module's injectable interfaces:
 * - {@link FakeBrowserSession} — a scripted stand-in for `BrowserSession`,
 *   returning `PageResult`s keyed by URL (see {@link FakeBrowserSessionScript}).
 * - {@link FakeTailscaleRunner} — a scripted stand-in for `TailscaleRunner`,
 *   tracking exit-node list/current/set calls without shelling out.
 *
 * Fake clock/sleep utilities live in `@/sourcequery/clock`
 * (`createFakeClock`), not here.
 */
import type { BrowserSession } from '@/sourcequery/browser-session';
import type { TailscaleRunner } from '@/sourcequery/tailscale-runner';
import type { ExitNode, PageResult } from '@/sourcequery/types';

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
 * Enforces the open-before-navigate precondition: `navigate()` throws if
 * called before `open()` or after `close()`, mirroring a real
 * persistent-Chrome session.
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
    if (!this.isOpen) {
      throw new Error(
        `FakeBrowserSession: navigate('${url}') called before open() (or after close()) — ` +
          'a real persistent-Chrome session requires open() before any navigation.',
      );
    }
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

/**
 * No-network test double for {@link TailscaleRunner}. Constructed with a
 * scripted exit-node list and the exit node "already active" on the host
 * (mirroring `currentExitNode()`'s captured-before-any-switch contract).
 *
 * Every `setExitNode()` call (both the approved switch and the later
 * restore) is appended, in order, to the public `setCalls` array, so tests
 * can assert:
 * - `setCalls` is empty before operator approval (no switch happened yet),
 * - `setCalls` holds exactly two entries once a switch-then-restore pass
 *   completes (`setCalls[0]` the switched-to node, `setCalls[1]` the
 *   restore value),
 * - the restore value (`setCalls[1]`) matches the node that was current
 *   before the switch (or `''` if there was no prior exit node).
 *
 * Never shells out to the real `tailscale` CLI.
 */
export class FakeTailscaleRunner implements TailscaleRunner {
  /** Every value passed to `setExitNode()`, in call order. */
  readonly setCalls: string[] = [];

  private readonly nodes: ExitNode[];
  private current: string | null;

  constructor(nodes: ExitNode[] = [], initialCurrentExitNode: string | null = null) {
    this.nodes = nodes;
    this.current = initialCurrentExitNode;
  }

  async listExitNodes(): Promise<ExitNode[]> {
    return this.nodes;
  }

  async currentExitNode(): Promise<string | null> {
    return this.current;
  }

  async setExitNode(value: string): Promise<void> {
    this.setCalls.push(value);
    this.current = value === '' ? null : value;
  }
}
