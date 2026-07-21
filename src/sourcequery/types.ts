/**
 * Core type definitions for the Source Query Client (Phase 1).
 * All types are typed entities; no `any`, `as`, or @ts-ignore.
 */

/** Parsed search result summary from persisted HTML. */
export interface QuerySummary {
  count: number;
  candidates: Candidate[];
}

/** A single search result candidate. */
export interface Candidate {
  title: string;
  ref: string;
  date?: string;
}

/**
 * Result of a source query.
 * Discriminated union: for 'persist' sources, captures are present;
 * for 'derived-facts-only' sources, derivedFacts and attribution are present instead.
 */
export type QueryResult =
  | {
      summary: QuerySummary;
      captures: PersistedCapture[];
      source: string;
      query: string;
      retention: 'persist';
    }
  | {
      summary: QuerySummary;
      derivedFacts: Candidate[];
      attribution: string;
      source: string;
      query: string;
      retention: 'derived-facts-only';
    };

/** Persisted capture of a single query page. */
export interface PersistedCapture {
  htmlPath: string;
  snapshotPath: string;
  url: string;
  capturedAtUtc: string;
}

/** A Tailscale exit node enumerated from `tailscale exit-node list`. */
export interface ExitNode {
  ip: string;
  hostname: string;
  country: string;
  city: string;
  online: boolean;
}

/** Prior exit node state captured before any switch. */
export interface HostExitState {
  priorExitNode: string | null;
}

/** Kind of blocking evidence. */
export type BlockEvidenceKind = 'status' | 'challenge' | 'drop';

/** Persisted proof of a hard block. */
export interface BlockEvidence {
  kind: BlockEvidenceKind;
  detail: string;
  evidencePath: string;
  capturedAtUtc: string;
}

/** Escalation request returned when a block is detected; client stops after this. */
export interface OperatorPermissionRequest {
  source: string;
  blockEvidence: BlockEvidence;
  currentOrigin: string;
  proposedNode: ExitNode;
  switchCommand: string;
  hostImpactWarning: string;
  minimalQueryPlan: string[];
}

/** Grace window configuration for post-switch discipline. */
export interface GraceWindowConfig {
  settleMs: number;
  extraSlowIntervalMs: number;
  maxRequests: number;
  maxWindowMs: number;
}

/** Result of a single page navigation. */
export interface PageResult {
  status: number | null;
  html: string;
  snapshotMarkdown: string;
  errored: boolean;
}
