/**
 * SourceQueryClient: the orchestrator for one governed query pass (Phase 1,
 * T014). Implements the US1 MVP happy path of the data-model state machine:
 * open a single browser session, navigate (paced by a PolitenessPolicy),
 * persist the raw page, classify it, and return a grounded `QueryResult` for a
 * result page OR a legitimate empty page.
 *
 * Scope boundaries (fail-loud, Principle V — never fabricate a result):
 * - Multi-page walking (`pages > 1`) is a later enhancement and THROWS here
 *   rather than silently returning only page 1.
 * - The hard-block -> exit-node-escalation path (US2 / T020) is NOT wired here.
 *   A detected block THROWS a descriptive error; it never persists block
 *   evidence or builds an OperatorPermissionRequest (that is T020).
 *
 * The injected `Clock` is the ONE allowed place to form the `capturedAtUtc`
 * timestamp (this is the composition layer); the library core modules
 * (persistence, frugality, block-detection) never call `Date` themselves, so
 * the whole pass stays deterministic under a fake clock.
 */

import type { BrowserSession } from '@/sourcequery/browser-session';
import type { TailscaleRunner } from '@/sourcequery/tailscale-runner';
import type { Clock, Sleep } from '@/sourcequery/clock';
import type { SourceConfig } from '@/sourcequery/source-config';
import { getSourceConfig } from '@/sourcequery/source-config';
import { PolitenessPolicy } from '@/sourcequery/politeness-policy';
import { classify } from '@/sourcequery/block-detection';
import { persistThenParse } from '@/sourcequery/frugality';
import { persistCapture } from '@/sourcequery/persistence';
import type { QueryResult } from '@/sourcequery/types';

/** Constructor-injected dependencies (interface-first; no class inheritance). */
export interface SourceQueryClientDeps {
  browser: BrowserSession;
  /** Stored for US2 (exit-node escalation); unused on the happy path. */
  tailscale: TailscaleRunner;
  clock: Clock;
  sleep: Sleep;
  /** Config resolver; defaults to the source registry's `getSourceConfig`. */
  resolveConfig?: (id: string) => SourceConfig;
}

/** Per-query options. */
export interface QueryOptions {
  /** Number of result pages to walk. Only `1` is supported in the MVP. */
  pages?: number;
}

/** Orchestrates one governed query pass and returns a grounded QueryResult. */
export class SourceQueryClient {
  private readonly browser: BrowserSession;
  private readonly tailscale: TailscaleRunner;
  private readonly clock: Clock;
  private readonly sleep: Sleep;
  private readonly resolveConfig: (id: string) => SourceConfig;

  constructor(deps: SourceQueryClientDeps) {
    this.browser = deps.browser;
    this.tailscale = deps.tailscale;
    this.clock = deps.clock;
    this.sleep = deps.sleep;
    this.resolveConfig = deps.resolveConfig ?? getSourceConfig;
  }

  /** The injected TailscaleRunner reserved for US2 (T020) exit-node escalation. */
  get exitNodeRunner(): TailscaleRunner {
    return this.tailscale;
  }

  /**
   * Run one query pass for `sourceId` + `text`. Returns a grounded
   * `QueryResult` on a result or legitimate-empty page. Throws (fail-loud) on
   * a hard block (escalation is a later task), on an unsupported `pages > 1`
   * request, or on any grounding/persistence failure. The browser session is
   * ALWAYS closed, even on throw.
   */
  async query(sourceId: string, text: string, opts?: QueryOptions): Promise<QueryResult> {
    const config = this.resolveConfig(sourceId);

    const pages = opts?.pages ?? 1;
    if (pages > 1) {
      throw new Error(
        `SourceQueryClient: pages=${pages} requested, but multi-page walking is a later ` +
          'enhancement not wired in the MVP. Refusing to silently return only page 1 ' +
          '(fail-loud, Principle V).',
      );
    }

    const url = config.buildQueryUrl(text, 1);
    const politeness = new PolitenessPolicy({
      minIntervalMs: config.minIntervalMs,
      now: this.clock,
      sleep: this.sleep,
    });

    await this.browser.open();
    try {
      const pageResult = await politeness.run(() => this.browser.navigate(url));

      // The composition layer forms the timestamp from the injected clock so the
      // pass is deterministic; core modules never call Date themselves.
      const capturedAtUtc = new Date(this.clock()).toISOString();

      const classification = classify(pageResult, config);

      if (classification.outcome === 'block') {
        throw new Error(
          `SourceQueryClient: hard block detected (kind="${classification.kind}", ` +
            `detail="${classification.detail}") for source "${config.id}" query "${text}". ` +
            'Hard-block exit-node escalation is handled by a later task (US2 / T020) and is ' +
            'not wired in this MVP. Refusing to fabricate a result.',
        );
      }

      if (classification.outcome === 'result') {
        // Frugality persists, re-parses from the persisted copy, and grounds the
        // positive count; throws on persistence failure or ungrounded output.
        return await persistThenParse({
          pageResult,
          config,
          query: text,
          url,
          capturedAtUtc,
        });
      }

      // Legitimate empty. Retention-forbidden sources (FR-009) must NEVER write
      // raw bytes — not even for an empty page — so honour retention here just as
      // the result path (Frugality) does:
      if (config.retention === 'derived-facts-only') {
        return {
          summary: { count: 0, candidates: [] },
          derivedFacts: [],
          attribution: config.attribution,
          source: config.id,
          query: text,
          retention: 'derived-facts-only',
        };
      }

      // Persist source: write the empty page as evidence and return a count-0
      // result. An empty result cites no positive number, so there is nothing to
      // ground (no persistThenParse grounding pass).
      const capture = await persistCapture({
        source: config.id,
        query: text,
        url,
        html: pageResult.html,
        snapshotMarkdown: pageResult.snapshotMarkdown,
        capturedAtUtc,
      });
      return {
        summary: { count: 0, candidates: [] },
        captures: [capture],
        source: config.id,
        query: text,
        retention: 'persist',
      };
    } finally {
      await this.browser.close();
    }
  }
}
