/**
 * ExitNodePolicy: enumerate exit nodes, capture prior host state, and
 * geo-select a usable node (research R4; FR-013, FR-015).
 *
 * This file currently holds only the enumeration / current-state /
 * node-selection foundation. Two later tasks extend this same class:
 * - T020 adds `buildPermissionRequest(...)`.
 * - T021 adds `runApprovedSwitch(node, plan, config)` (switch → settle →
 *   minimal set, extra-slow, bounded, each persisted → restore), which is
 *   why `clock` and `sleep` are accepted here even though this task's
 *   methods don't use them yet.
 */
import type { Clock, Sleep } from '@/sourcequery/clock';
import type { TailscaleRunner } from '@/sourcequery/tailscale-runner';
import type {
  BlockEvidence,
  ExitNode,
  GraceWindowConfig,
  HostExitState,
  OperatorPermissionRequest,
  QueryResult,
} from '@/sourcequery/types';

/** Constructor dependencies for {@link ExitNodePolicy}. */
export interface ExitNodePolicyDeps {
  tailscale: TailscaleRunner;
  clock: Clock;
  sleep: Sleep;
}

/**
 * Policy over the injectable {@link TailscaleRunner}: enumerate exit nodes,
 * capture the host's prior exit-node state before any switch, and
 * geo-select a usable online node.
 */
export class ExitNodePolicy {
  private readonly tailscale: TailscaleRunner;
  private readonly clock: Clock;
  private readonly sleep: Sleep;

  constructor(deps: ExitNodePolicyDeps) {
    this.tailscale = deps.tailscale;
    this.clock = deps.clock;
    this.sleep = deps.sleep;
  }

  /** `tailscale exit-node list`, structured. */
  async enumerate(): Promise<ExitNode[]> {
    return this.tailscale.listExitNodes();
  }

  /** Prior exit-node state, captured BEFORE any switch so it can be restored (FR-013). */
  async captureCurrentState(): Promise<HostExitState> {
    return { priorExitNode: await this.tailscale.currentExitNode() };
  }

  /**
   * Geo-select a usable exit node (research R4). Prefers an ONLINE node
   * whose `country` matches `preferredGeo` (case-insensitive); else any
   * ONLINE node; else `null` (no usable node — an explicit domain signal
   * the caller handles honestly, NOT a fabricated fallback). Offline nodes
   * are never selected.
   */
  selectNode(nodes: ExitNode[], preferredGeo?: string): ExitNode | null {
    const online = nodes.filter((node) => node.online);
    if (online.length === 0) {
      return null;
    }
    if (preferredGeo !== undefined) {
      const geoMatch = online.find(
        (node) => node.country.toLowerCase() === preferredGeo.toLowerCase(),
      );
      if (geoMatch !== undefined) {
        return geoMatch;
      }
    }
    return online[0];
  }

  /**
   * Build the {@link OperatorPermissionRequest} presented to the operator when
   * a hard block is met and a usable exit node exists (FR-010/FR-011). This is
   * a PURE function: it performs no host interaction and NEVER switches the
   * exit node — the switch only happens later on explicit operator approval
   * (T021 / SC-003). It merely describes the proposed switch (its command and
   * whole-host impact) so the operator can decide.
   */
  buildPermissionRequest(args: {
    source: string;
    blockEvidence: BlockEvidence;
    currentState: HostExitState;
    proposedNode: ExitNode;
    minimalQueryPlan: string[];
  }): OperatorPermissionRequest {
    const target = args.proposedNode.hostname || args.proposedNode.ip;
    return {
      source: args.source,
      blockEvidence: args.blockEvidence,
      currentOrigin: args.currentState.priorExitNode ?? 'direct',
      proposedNode: args.proposedNode,
      switchCommand: `tailscale set --exit-node=${target}`,
      hostImpactWarning:
        'Approving this switch reroutes the ENTIRE host machine’s network traffic ' +
        `through exit node ${target}, not just this one query. All other processes on ` +
        'this host will egress via that node until the exit node is restored.',
      minimalQueryPlan: args.minimalQueryPlan,
    };
  }

  /**
   * Perform the ONE approved exit-node switch, then run the pre-planned minimal
   * set under grace-window discipline, then ALWAYS restore the host's prior
   * state (FR-012/FR-013/FR-014, SC-004; research R6).
   *
   * Sequence:
   * 1. Switch to `node` — the single host-network change this pass is allowed
   *    (FR-014: one node change per pass).
   * 2. In a `try`, wait `grace.settleMs`, then walk `plan` under bounds: stop at
   *    `grace.maxRequests` (count bound) or `grace.maxWindowMs` measured from the
   *    end of the settle (time bound); pace navigations by
   *    `grace.extraSlowIntervalMs` between them; persist each via `runOne`.
   *    `maxWindowMs` is a HARD CEILING: the time bound is re-checked
   *    immediately before every navigation, including after the inter-
   *    navigation pacing sleep — no navigation is ever allowed to START once
   *    the approved window has elapsed, even if pacing alone would push it
   *    past the bound.
   * 3. In a `finally`, restore `priorState.priorExitNode` (or `''` = direct)
   *    UNCONDITIONALLY — even if the loop throws (e.g. the switched node is ALSO
   *    blocked, the "burned node" case). `runOne`'s throw is NOT swallowed: it
   *    propagates out after restore so the caller reports honestly.
   *
   * `ranAll` is false when a bound cut the plan short — the caller surfaces the
   * partial coverage rather than silently truncating (spec Edge Cases).
   */
  async runApprovedSwitch(args: {
    node: ExitNode;
    priorState: HostExitState;
    plan: string[];
    grace: GraceWindowConfig;
    runOne: (url: string) => Promise<QueryResult>;
  }): Promise<{ results: QueryResult[]; ranAll: boolean }> {
    // FR-014: the ONE node change per pass. hostname when present, else ip.
    await this.tailscale.setExitNode(args.node.hostname || args.node.ip);
    try {
      // Settle before the active query phase begins (research R6).
      await this.sleep(args.grace.settleMs);

      const results: QueryResult[] = [];
      // Window measured over the active query phase (after the settle).
      const startMs = this.clock();

      for (let i = 0; i < args.plan.length; i += 1) {
        if (results.length >= args.grace.maxRequests) {
          break; // count bound reached — stop, do not silently continue.
        }
        if (this.clock() - startMs >= args.grace.maxWindowMs) {
          break; // time bound reached — stop at the bound.
        }
        if (i > 0) {
          // Extra-slow pacing between navigations (only BETWEEN, not before the first).
          await this.sleep(args.grace.extraSlowIntervalMs);
        }
        // Hard ceiling: re-check the time bound AFTER any pacing sleep and
        // BEFORE starting the navigation — the approved window's exposure
        // must not be extended by even one pacing interval. No navigation
        // may START once the window is exhausted.
        if (this.clock() - startMs >= args.grace.maxWindowMs) {
          break; // time bound reached during pacing — do not start this navigation.
        }
        results.push(await args.runOne(args.plan[i]));
      }

      const ranAll = results.length === args.plan.length;
      return { results, ranAll };
    } finally {
      // FR-013 / SC-004: restore ALWAYS — even on throw. '' clears to direct.
      await this.tailscale.setExitNode(args.priorState.priorExitNode ?? '');
    }
  }
}
