/**
 * SourceQueryClient: the orchestrator for one governed query pass (Phase 1,
 * T014). Implements the US1 MVP happy path of the data-model state machine:
 * open a single browser session, navigate (paced by a PolitenessPolicy),
 * persist the raw page, classify it, and return a grounded `QueryResult` for a
 * result page OR a legitimate empty page.
 *
 * Persist-before-analysis (Principle XII / R5): for a persist-retention source
 * the raw page is written to disk BEFORE `classify()` reads it. `classify()`
 * inspects the page (result-container probe + challenge fingerprints — that IS
 * analysis) and THROWS on an unclassifiable page; persisting first guarantees
 * every fetched page leaves a raw capture on disk, even one that then fails to
 * classify, so a new/fixed `SourceConfig` can be bootstrapped from it.
 *
 * Scope boundaries (fail-loud, Principle V — never fabricate a result):
 * - Multi-page walking (`pages > 1`) is a later enhancement and THROWS here
 *   rather than silently returning only page 1.
 * - On a hard block (US2 / T020) block evidence exists on disk FIRST — for a
 *   persist source the raw pre-classify capture IS that evidence (no duplicate
 *   `block-<UTC>` copy) — then the pass either RETURNS an
 *   `OperatorPermissionRequest` (a usable exit node exists) or THROWS an honest
 *   fail-loud error (Tailscale unavailable, or no usable node). It NEVER
 *   switches the exit node autonomously — that only happens on explicit operator
 *   approval (T021 / FR-011 / SC-003).
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
import { staleCookieHint } from '@/sourcequery/browser-profile';
import { groundedResultFromCapture, derivedFactsResult } from '@/sourcequery/frugality';
import { persistCapture, persistBlockEvidence } from '@/sourcequery/persistence';
import { ExitNodePolicy } from '@/sourcequery/exit-node-policy';
import { describeError } from '@/bibliography/load-primitives';
import type {
  BlockEvidence,
  Candidate,
  ExitNode,
  HostExitState,
  OperatorPermissionRequest,
  PageResult,
  PersistedCapture,
  QueryResult,
  QuerySummary,
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
  /**
   * 1-indexed result page to START at (default 1). Combined with {@link pages},
   * this selects a specific slice of the result set — e.g. `page: 3, pages: 1`
   * fetches only the third page (a "tranche"), letting a caller walk the long
   * tail one bounded page at a time and reassess between fetches.
   */
  page?: number;
  /**
   * Number of consecutive result pages to walk starting at {@link page}
   * (default 1). `pages > 1` fetches each page in turn (persist-first, paced by
   * the same politeness policy), unions the candidates (de-duplicated by `ref`),
   * and grounds the total count from the first fetched page. A hard block on any
   * page stops the walk and surfaces that page's escalation/stop.
   */
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
/**
 * A trailing stale-cookie remediation hint for a WAF hard block. Only the WAF
 * kinds (`challenge`, `status`) can be a stale-cookie re-challenge (TASK-44); a
 * `drop` (navigation error) is not, so it gets no hint. Empty string otherwise
 * so the block message is unchanged for non-WAF blocks.
 */
function wafRemediationSuffix(kind: string): string {
  return kind === 'challenge' || kind === 'status' ? ` ${staleCookieHint()}` : '';
}

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

    const page = opts?.page ?? 1;
    const pages = opts?.pages ?? 1;
    if (!Number.isInteger(page) || page < 1) {
      throw new Error(
        `SourceQueryClient: page must be a positive integer (1-indexed), got ${page} ` +
          '(fail-loud, Principle V).',
      );
    }
    if (!Number.isInteger(pages) || pages < 1) {
      throw new Error(
        `SourceQueryClient: pages must be a positive integer, got ${pages} ` +
          '(fail-loud, Principle V).',
      );
    }

    // The slice of the result set to fetch: `pages` consecutive pages starting
    // at `page` (1-indexed). One page is the common case (a single tranche).
    const urls = Array.from({ length: pages }, (_, i) => config.buildQueryUrl(text, page + i));

    // Operator-approved escalation path (FR-012): run the switch → settle →
    // minimal set → restore pass instead of the normal navigate/classify pass.
    if (opts?.approveExitNode !== undefined) {
      return await this.runApprovedPass(config, text, urls, opts.approveExitNode);
    }

    // ONE politeness policy across the whole walk so inter-page navigations are
    // paced by the source's minIntervalMs (never a burst), and ONE browser
    // session opened once and closed once for the whole tranche.
    const politeness = new PolitenessPolicy({
      minIntervalMs: config.minIntervalMs,
      now: this.clock,
      sleep: this.sleep,
    });

    await this.browser.open();
    try {
      const results: QueryResult[] = [];
      for (const url of urls) {
        const outcome = await this.queryOnePage(config, text, url, politeness);
        // A hard block on ANY page stops the walk and surfaces that page's
        // escalation/stop — never a silent partial union past a block.
        if ('proposedNode' in outcome) {
          return outcome;
        }
        results.push(outcome);
      }
      return this.mergeResults(results);
    } finally {
      await this.browser.close();
    }
  }

  /**
   * Fetch, persist, classify and ground ONE result page within an already-open
   * browser session (the caller owns open/close and the shared politeness policy
   * so a multi-page walk reuses one session and paces between pages). Returns a
   * grounded {@link QueryResult} for a result/legitimate-empty page, or an
   * {@link OperatorPermissionRequest} on a hard block where a usable exit node
   * exists (after persisting block evidence). Throws (fail-loud) on a hard block
   * where Tailscale is unavailable or no usable node exists.
   */
  private async queryOnePage(
    config: SourceConfig,
    text: string,
    url: string,
    politeness: PolitenessPolicy,
  ): Promise<QueryResult | OperatorPermissionRequest> {
    {
      const pageResult = await politeness.run(() => this.browser.navigate(url));

      // The composition layer forms the timestamp from the injected clock so the
      // pass is deterministic; core modules never call Date themselves.
      const capturedAtUtc = new Date(this.clock()).toISOString();

      // Persist-before-analysis (Principle XII / FR-010): for a persist-retention
      // source the raw page is written to disk BEFORE classify() reads it, so
      // every fetched page — INCLUDING one that then fails classification — leaves
      // a raw capture on disk. `classify` may THROW on an unclassifiable page; the
      // capture is already saved, so the throw propagates with the evidence intact.
      const { classification, capture } = await this.persistThenClassify(
        pageResult,
        config,
        text,
        url,
        capturedAtUtc,
      );

      if (classification.outcome === 'block') {
        // FR-010: block evidence exists on disk FIRST — an OperatorPermissionRequest
        // is never raised, and no honest stop is reported, without proof on disk.
        // For a persist source the raw capture IS the block evidence (no second
        // `block-<UTC>` copy of the same bytes). A retention-forbidden source
        // persists nothing above, so its block proof is written here instead.
        const blockEvidence: BlockEvidence =
          capture !== null
            ? {
                kind: classification.kind,
                detail: classification.detail,
                evidencePath: capture.htmlPath,
                capturedAtUtc: capture.capturedAtUtc,
              }
            : await persistBlockEvidence({
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
              `Block evidence persisted at ${blockEvidence.evidencePath}.${wafRemediationSuffix(classification.kind)}`,
          );
        }

        const node = this.exitNodePolicy.selectNode(nodes, config.preferredGeo);
        if (node === null) {
          throw new Error(
            `SourceQueryClient: hard block detected (kind="${classification.kind}", ` +
              `detail="${classification.detail}") for source "${config.id}" query "${text}", ` +
              'but there is no usable exit node (no online candidate). Reporting honestly and ' +
              'stopping — NO exit-node switch (fail-loud, Principle V). Block evidence persisted ' +
              `at ${blockEvidence.evidencePath}.${wafRemediationSuffix(classification.kind)}`,
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
      // approved-switch pass (ground positive counts from the already-persisted
      // capture; retention-aware empty handling).
      return await this.resultOrEmpty(classification, pageResult, config, text, capture);
    }
  }

  /**
   * Merge the per-page {@link QueryResult}s of a walk into one: union the
   * candidates (de-duplicated by `ref`, preserving first-seen order), ground the
   * total count from the FIRST fetched page (the total is the same on every
   * page), and concatenate every page's captures (persist) or derived facts.
   * A single-page walk returns its one result unchanged.
   */
  private mergeResults(results: QueryResult[]): QueryResult {
    const first = results[0];
    if (first === undefined) {
      throw new Error(
        'SourceQueryClient.mergeResults: no results to merge (empty walk) — ' +
          'a walk always fetches at least one page (fail-loud, Principle V).',
      );
    }
    if (results.length === 1) {
      return first;
    }

    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const r of results) {
      for (const c of r.summary.candidates) {
        if (!seen.has(c.ref)) {
          seen.add(c.ref);
          candidates.push(c);
        }
      }
    }
    const summary: QuerySummary = { count: first.summary.count, candidates };

    if (first.retention === 'persist') {
      return {
        summary,
        captures: results.flatMap((r) => (r.retention === 'persist' ? r.captures : [])),
        source: first.source,
        query: first.query,
        retention: 'persist',
      };
    }
    return {
      summary,
      derivedFacts: results.flatMap((r) =>
        r.retention === 'derived-facts-only' ? r.derivedFacts : [],
      ),
      attribution: first.attribution,
      source: first.source,
      query: first.query,
      retention: 'derived-facts-only',
    };
  }

  /**
   * Persist-before-analysis (Principle XII / R5): for a persist-retention source,
   * write the raw page to disk via {@link persistCapture} BEFORE {@link classify}
   * reads it, and return the resulting {@link PersistedCapture} alongside the
   * classification. `classify()` reads the page (result-container probe +
   * challenge fingerprints — that IS analysis) and THROWS on an unclassifiable
   * page; persisting first guarantees the raw evidence survives that throw so a
   * new/fixed `SourceConfig` can be bootstrapped from the captured page.
   *
   * A `'derived-facts-only'` source (retention-forbidden, FR-009) persists
   * NOTHING here (`capture` is `null`) and is classified from the in-memory HTML;
   * an unclassifiable derived-facts-only page persists nothing by design.
   */
  private async persistThenClassify(
    pageResult: PageResult,
    config: SourceConfig,
    text: string,
    url: string,
    capturedAtUtc: string,
  ): Promise<{ classification: BlockClassification; capture: PersistedCapture | null }> {
    let capture: PersistedCapture | null = null;
    if (config.retention === 'persist') {
      // Throws on write failure (fail-loud, Principle V) — let it propagate.
      capture = await persistCapture({
        source: config.id,
        query: text,
        url,
        html: pageResult.html,
        snapshotMarkdown: pageResult.snapshotMarkdown,
        capturedAtUtc,
      });
    }

    // Analysis happens AFTER the (persist-retention) raw bytes are on disk. A
    // throw here (unclassifiable page) propagates with the capture already saved.
    const classification = classify(pageResult, config);
    return { classification, capture };
  }

  /**
   * Convert a NON-block classification into a grounded {@link QueryResult} from
   * the ALREADY-decided persistence (the raw page was persisted before classify
   * for persist sources; `capture` is `null` for retention-forbidden sources).
   * The ONE source of truth used by BOTH the normal pass and the approved-switch
   * grace run:
   * - `result` (persist) → grounds the positive count against the already-
   *   persisted capture (throws when ungrounded); no double-write of the bytes.
   * - `result` (derived-facts-only) → parse + ground the in-memory HTML, return
   *   `derivedFacts` + attribution, persist NOTHING (FR-009).
   * - `empty` → retention-aware count-0: `derived-facts-only` returns
   *   `derivedFacts: []` + attribution (nothing persisted); `persist` returns a
   *   count-0 result citing the already-persisted capture.
   *
   * A `block` classification must be handled by the caller (it never reaches
   * here); if one does, we THROW (fail-loud) rather than mis-handle it as empty.
   */
  private async resultOrEmpty(
    classification: BlockClassification,
    pageResult: PageResult,
    config: SourceConfig,
    text: string,
    capture: PersistedCapture | null,
  ): Promise<QueryResult> {
    // Retention-forbidden sources (FR-009): nothing was persisted; parse the
    // in-memory HTML and return derived facts only.
    if (config.retention === 'derived-facts-only') {
      if (classification.outcome === 'result') {
        return derivedFactsResult({ pageResult, config, query: text });
      }
      if (classification.outcome === 'empty') {
        return {
          summary: { count: 0, candidates: [] },
          derivedFacts: [],
          attribution: config.attribution,
          source: config.id,
          query: text,
          retention: 'derived-facts-only',
        };
      }
      throw new Error(
        `SourceQueryClient.resultOrEmpty: received a "block" classification ` +
          `(kind="${classification.kind}", detail="${classification.detail}") for source ` +
          `"${config.id}" query "${text}"; blocks must be handled by the caller, not here.`,
      );
    }

    // Persist source: the raw page is already on disk (persist-before-analysis),
    // so the capture must be present.
    if (capture === null) {
      throw new Error(
        `SourceQueryClient.resultOrEmpty: persist-retention source "${config.id}" query ` +
          `"${text}" reached result/empty handling without a persisted capture — the raw page ` +
          'must be persisted before classification (persist-before-analysis invariant).',
      );
    }

    if (classification.outcome === 'result') {
      // Ground the positive count from the ALREADY-persisted bytes (no re-write).
      return await groundedResultFromCapture({ capture, config, query: text });
    }

    if (classification.outcome === 'empty') {
      // An empty result cites no positive number, so there is nothing to ground;
      // return a count-0 result citing the already-persisted capture.
      return {
        summary: { count: 0, candidates: [] },
        captures: [capture],
        source: config.id,
        query: text,
        retention: 'persist',
      };
    }

    throw new Error(
      `SourceQueryClient.resultOrEmpty: received a "block" classification ` +
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
    urls: string[],
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
        plan: urls,
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

      // Merge whatever pages ran under the grace window (one for a single-page
      // tranche, N for a walk) into one grounded result. A grace window that ran
      // fewer than the requested pages yields the pages that did run — never a
      // fabricated page.
      return this.mergeResults(results);
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

    // Persist-before-analysis here too (Principle XII): a persist-retention page
    // fetched over the switched origin is written to disk BEFORE classify reads
    // it, including a still-blocked ("burned node") page.
    const { classification, capture } = await this.persistThenClassify(
      pageResult,
      config,
      text,
      url,
      capturedAtUtc,
    );

    if (classification.outcome === 'block') {
      throw new Error(
        `SourceQueryClient: still blocked after the approved exit-node switch (burned node) ` +
          `for source "${config.id}" query "${text}" (kind="${classification.kind}", ` +
          `detail="${classification.detail}"). Aborting the grace run — host state is restored ` +
          'and the continued block is reported honestly (no node churning).',
      );
    }

    return await this.resultOrEmpty(classification, pageResult, config, text, capture);
  }
}
