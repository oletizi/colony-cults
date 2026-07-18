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
  HostExitState,
  OperatorPermissionRequest,
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
}
