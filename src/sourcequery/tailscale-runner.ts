/**
 * TailscaleRunner: injectable boundary around the `tailscale` CLI used to
 * enumerate exit nodes and switch/restore the host's active exit node.
 * Interface-first (Principle VI); the real implementation (exec-backed) is
 * added in a later task.
 */
import type { ExitNode } from '@/sourcequery/types';

/** Runner over the `tailscale` CLI for exit-node enumeration and switching. */
export interface TailscaleRunner {
  /** `tailscale exit-node list`, parsed into structured exit nodes. */
  listExitNodes(): Promise<ExitNode[]>;

  /**
   * `tailscale status --json`, read for the currently active exit node.
   * Captured before any switch so it can be restored. `null` if direct
   * (no exit node currently set).
   */
  currentExitNode(): Promise<string | null>;

  /**
   * `tailscale set --exit-node=<value>`. An empty string clears to direct
   * (no exit node).
   */
  setExitNode(value: string): Promise<void>;
}
