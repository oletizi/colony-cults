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
 * - On a hard block (US2 / T020) the pass persists block evidence FIRST, then
 *   either RETURNS an `OperatorPermissionRequest` (a usable exit node exists)
 *   or THROWS an honest fail-loud error (Tailscale unavailable, or no usable
 *   node). It NEVER switches the exit node autonomously — that only happens on
 *   explicit operator approval (T021 / FR-011 / SC-003).
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
import type { BlockClassification } from '@/sourcequery/block-detection';
import { persistThenParse } from '@/sourcequery/frugality';
import { persistCapture, persistBlockEvidence } from '@/sourcequery/persistence';
import { ExitNodePolicy } from '@/sourcequery/exit-node-policy';
import { describeError } from '@/bibliography/load-primitives';
import type {
  ExitNode,
  HostExitState,
  OperatorPermissionRequest,
  PageResult,
  QueryResult,
} from '@/sourcequery/types';

/** Constructor-injected dependencies (interface-first; no class inheritance). */
export interface SourceQueryClientDeps {
  browser: BrowserSession;
  /** Drives the ExitNodePolicy used on the hard-block escalation path (US2). */
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
  /**
   * The operator-approved exit node (ip or hostname) relayed back in-session
   * (FR-012). When set, `query()` runs the approved-switch pass instead of the
   * normal navigate/classify pass: switch → settle → minimal set under grace →
   * restore. NEVER switches without this (FR-011 / SC-003).
   */
  approveExitNode?: string;
}

/** Orchestrates one governed query pass and returns a grounded QueryResult. */
export class SourceQueryClient {
  private readonly browser: BrowserSession;
  private readonly clock: Clock;
  private readonly sleep: Sleep;
  private readonly resolveConfig: (id: string) => SourceConfig;
  private readonly exitNodePolicy: ExitNodePolicy;

  constructor(deps: SourceQueryClientDeps) {
    this.browser = deps.browser;
    this.clock = deps.clock;
    this.sleep = deps.sleep;
    this.resolveConfig = deps.resolveConfig ?? getSourceConfig;
    this.exitNodePolicy = new ExitNodePolicy({
      tailscale: deps.tailscale,
      clock: deps.clock,
      sleep: deps.sleep,
    });
  }

  /**
   * Run one query pass for `sourceId` + `text`. Returns a grounded
   * `QueryResult` on a result or legitimate-empty page, or an
   * `OperatorPermissionRequest` on a hard block where a usable exit node
   * exists (after persisting block evidence). Throws (fail-loud) on a hard
   * block where Tailscale is unavailable or no usable node exists, on an
   * unsupported `pages > 1` request, or on any grounding/persistence failure.
   * The browser session is ALWAYS closed, even on throw. NEVER switches the
   * exit node autonomously (FR-011 / SC-003).
   */
  async query(
    sourceId: string,
    text: string,
    opts?: QueryOptions,
  ): Promise<QueryResult | OperatorPermissionRequest> {
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

    // Operator-approved escalation path (FR-012): run the switch → settle →
    // minimal set → restore pass instead of the normal navigate/classify pass.
    if (opts?.approveExitNode !== undefined) {
      return await this.runApprovedPass(config, text, url, opts.approveExitNode);
    }

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
        // FR-010: persist block evidence FIRST — an OperatorPermissionRequest is
        // never raised, and no honest stop is reported, without proof on disk.
        const blockEvidence = await persistBlockEvidence({
          source: config.id,
          kind: classification.kind,
          detail: classification.detail,
          html: pageResult.html,
          snapshotMarkdown: pageResult.snapshotMarkdown,
          capturedAtUtc,
        });

        // Enumerate exit nodes and capture the host's prior state. If EITHER
        // fails, Tailscale is unavailable: report honestly and STOP — never
        // switch (fail-loud, Principle V; FR-011/SC-003).
        let nodes: ExitNode[];
        let currentState: HostExitState;
        try {
          nodes = await this.exitNodePolicy.enumerate();
          currentState = await this.exitNodePolicy.captureCurrentState();
        } catch (error) {
          throw new Error(
            `SourceQueryClient: hard block detected (kind="${classification.kind}", ` +
              `detail="${classification.detail}") for source "${config.id}" query "${text}", ` +
              'but Tailscale is unavailable (no exit nodes available / Tailscale unavailable): ' +
              `${describeError(error)}. Reporting honestly and stopping — NO exit-node switch. ` +
              `Block evidence persisted at ${blockEvidence.evidencePath}.`,
          );
        }

        const node = this.exitNodePolicy.selectNode(nodes, config.preferredGeo);
        if (node === null) {
          throw new Error(
            `SourceQueryClient: hard block detected (kind="${classification.kind}", ` +
              `detail="${classification.detail}") for source "${config.id}" query "${text}", ` +
              'but there is no usable exit node (no online candidate). Reporting honestly and ' +
              'stopping — NO exit-node switch (fail-loud, Principle V). Block evidence persisted ' +
              `at ${blockEvidence.evidencePath}.`,
          );
        }

        // A usable node exists: build the escalation and STOP. The switch NEVER
        // happens autonomously here — only on explicit operator approval (T021 /
        // FR-011 / SC-003).
        return this.exitNodePolicy.buildPermissionRequest({
          source: config.id,
          blockEvidence,
          currentState,
          proposedNode: node,
          minimalQueryPlan: [url],
        });
      }

      // Result / legitimate-empty: single source of truth shared with the
      // approved-switch pass (persist + ground positive counts; retention-aware
      // empty handling).
      return await this.persistResultOrEmpty(
        classification,
        pageResult,
        config,
        text,
        url,
        capturedAtUtc,
      );
    } finally {
      await this.browser.close();
    }
  }

  /**
   * Convert a NON-block classification into a grounded {@link QueryResult}. The
   * ONE source of truth used by BOTH the normal pass and the approved-switch
   * grace run:
   * - `result` → Frugality persists, re-parses from the persisted copy, and
   *   grounds the positive count (throws on persistence failure / ungrounded).
   * - `empty` → retention-aware count-0: `derived-facts-only` returns
   *   `derivedFacts: []` + attribution and persists NOTHING (FR-009); `persist`
   *   writes the empty page as evidence and returns a count-0 capture result.
   *
   * A `block` classification must be handled by the caller (it never reaches
   * here); if one does, we THROW (fail-loud) rather than mis-handle it as empty.
   */
  private async persistResultOrEmpty(
    classification: BlockClassification,
    pageResult: PageResult,
    config: SourceConfig,
    text: string,
    url: string,
    capturedAtUtc: string,
  ): Promise<QueryResult> {
    if (classification.outcome === 'result') {
      return await persistThenParse({
        pageResult,
        config,
        query: text,
        url,
        capturedAtUtc,
      });
    }

    if (classification.outcome === 'empty') {
      // Retention-forbidden sources (FR-009) must NEVER write raw bytes — not
      // even for an empty page — so honour retention here just as Frugality does.
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
    }

    throw new Error(
      `SourceQueryClient.persistResultOrEmpty: received a "block" classification ` +
        `(kind="${classification.kind}", detail="${classification.detail}") for source ` +
        `"${config.id}" query "${text}"; blocks must be handled by the caller, not here.`,
    );
  }

  /**
   * The operator-approved escalation pass (FR-012): open a session, resolve the
   * approved node, capture prior host state, perform the ONE switch and run the
   * minimal plan under grace-window discipline, then ALWAYS restore host state
   * (owned by {@link ExitNodePolicy.runApprovedSwitch}'s `finally`). The session
   * is ALWAYS closed. Fail-loud throughout: an unavailable Tailscale, an unknown
   * approved node, a still-blocked ("burned") node, or an exhausted grace window
   * before any query ran all surface as honest errors — never a fabricated result.
   */
  private async runApprovedPass(
    config: SourceConfig,
    text: string,
    url: string,
    approvedNodeId: string,
  ): Promise<QueryResult> {
    await this.browser.open();
    try {
      // A throw here = Tailscale unavailable; it propagates as an honest failure.
      const nodes = await this.exitNodePolicy.enumerate();

      const node = nodes.find(
        (candidate) => candidate.ip === approvedNodeId || candidate.hostname === approvedNodeId,
      );
      if (node === undefined) {
        throw new Error(
          `SourceQueryClient: approved exit node "${approvedNodeId}" not found among enumerated ` +
            `nodes for source "${config.id}" query "${text}". Refusing to switch to an unknown ` +
            'node (fail-loud, Principle V).',
        );
      }

      const priorState = await this.exitNodePolicy.captureCurrentState();

      const { results } = await this.exitNodePolicy.runApprovedSwitch({
        node,
        priorState,
        plan: [url],
        grace: config.grace,
        runOne: (u) => this.runOneUnderGrace(u, config, text),
      });

      if (results.length === 0) {
        // The grace-window bound was hit before any query ran. Report, don't
        // fabricate a result (spec Edge Cases: "Grace window exhausted mid-plan").
        throw new Error(
          `SourceQueryClient: the approved-switch grace window was exhausted before any query ` +
            `ran for source "${config.id}" query "${text}" (settleMs=${config.grace.settleMs}, ` +
            `maxRequests=${config.grace.maxRequests}, maxWindowMs=${config.grace.maxWindowMs}). ` +
            'Reporting honestly — no fabricated result. Host state has been restored.',
        );
      }

      // Single-url MVP plan: `ranAll` is true on success. Partial-coverage
      // reporting for multi-url plans (surfacing `!ranAll`) lands with multi-page
      // support.
      return results[0];
    } finally {
      await this.browser.close();
    }
  }

  /**
   * Navigate + persist + parse ONE url during the approved grace run, WITHOUT
   * the PolitenessPolicy — the extra-slow spacing is owned by
   * {@link ExitNodePolicy.runApprovedSwitch}. On a still-present block after the
   * switch (a "burned node"), THROW so the grace loop aborts; host state is
   * restored by `runApprovedSwitch`'s `finally`.
   */
  private async runOneUnderGrace(
    url: string,
    config: SourceConfig,
    text: string,
  ): Promise<QueryResult> {
    const pageResult = await this.browser.navigate(url);
    const capturedAtUtc = new Date(this.clock()).toISOString();
    const classification = classify(pageResult, config);

    if (classification.outcome === 'block') {
      throw new Error(
        `SourceQueryClient: still blocked after the approved exit-node switch (burned node) ` +
          `for source "${config.id}" query "${text}" (kind="${classification.kind}", ` +
          `detail="${classification.detail}"). Aborting the grace run — host state is restored ` +
          'and the continued block is reported honestly (no node churning).',
      );
    }

    return await this.persistResultOrEmpty(
      classification,
      pageResult,
      config,
      text,
      url,
      capturedAtUtc,
    );
  }
}
