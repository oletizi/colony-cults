/**
 * Source-group candidate discovery (T005 scaffold).
 *
 * Spike outcome (T004, see specs/006-source-group-acquisition/research.md):
 * the single discovery mechanism is the BnF general-catalogue SRU
 * (`https://catalogue.bnf.fr/api/SRU`), a documented, unauthenticated,
 * programmatically-callable bibliographic search — distinct from the
 * anti-bot-blocked Gallica web search. The `discover` verb WILL ship,
 * backed by exactly one mechanism.
 *
 * PROJECT PRINCIPLE — FAIL LOUD, NO FALLBACKS. The dispatcher uses exactly
 * ONE mechanism. When that mechanism is unavailable it THROWS; it never
 * silently falls back to a second mechanism. The operator-supplied-candidate
 * path (FR-019) is an explicit operator input, not an automatic fallback the
 * software selects on its own.
 *
 * This file scaffolds only the interface, the candidate types, and the
 * fail-loud dispatcher. The concrete SRU network client is task T033 and is
 * intentionally NOT implemented here.
 *
 * @see specs/006-source-group-acquisition/research.md — Spike outcome (T004)
 */

/**
 * The discovery mechanisms this pipeline recognizes. Exactly one is active
 * per dispatcher instance — this is a discriminator, NOT a fallback ladder.
 *
 * - `bnf-catalogue-sru`: the shipped mechanism (BnF general-catalogue SRU).
 * - `operator-supplied`: candidates handed in explicitly by an operator
 *   (FR-019). Not an automatic fallback; only used when the operator chooses
 *   it as the active mechanism.
 */
export type DiscoveryEndpoint = 'bnf-catalogue-sru' | 'operator-supplied';

/**
 * A single candidate archival record surfaced by a discovery mechanism.
 *
 * These are CANDIDATES only. Relevance judgment (original court record vs.
 * a later historical account) is always a human/agent decision made
 * downstream; the software merely surfaces what a search returned.
 */
export interface DiscoveryCandidate {
  /**
   * Stable identifier for the candidate as reported by the mechanism —
   * e.g. a BnF ARK (`bib.persistentid`) or a BnF notice number. This is the
   * value later stages resolve/verify; it is not yet a confirmed member.
   */
  readonly identifier: string;
  /** Best-effort title as reported by the mechanism, for operator triage. */
  readonly titleHint?: string;
  /** Best-effort creator/author as reported by the mechanism. */
  readonly creatorHint?: string;
  /** Best-effort publication/creation date as reported by the mechanism. */
  readonly dateHint?: string;
  /** Which mechanism surfaced this candidate. */
  readonly endpoint: DiscoveryEndpoint;
}

/** Options for a discovery search. */
export interface DiscoverySearchOptions {
  /** Max candidates to return; maps to SRU `maximumRecords`. */
  readonly maxResults?: number;
  /** 1-based offset of the first result; maps to SRU `startRecord`. */
  readonly startRecord?: number;
}

/**
 * A discovery mechanism: a search over some documented archival catalogue
 * that surfaces candidate records. Interface-first so the dispatcher can be
 * exercised with a fake in unit tests (composition over inheritance, DI).
 *
 * The concrete BnF-catalogue-SRU implementation is task T033.
 */
export interface DiscoveryMechanism {
  /** Which endpoint this mechanism represents. */
  readonly endpoint: DiscoveryEndpoint;
  /**
   * Whether the mechanism can currently service a search. When this returns
   * false the dispatcher fails loud rather than trying anything else.
   */
  isAvailable(): Promise<boolean>;
  /** Run a search and return candidate records (never a fallback set). */
  search(
    query: string,
    opts?: DiscoverySearchOptions,
  ): Promise<readonly DiscoveryCandidate[]>;
}

/**
 * Thrown when the single configured discovery mechanism cannot service a
 * search. This is the fail-loud boundary: there is deliberately no `cause`
 * that hands off to another mechanism.
 */
export class DiscoveryUnavailableError extends Error {
  readonly endpoint: DiscoveryEndpoint;

  constructor(endpoint: DiscoveryEndpoint, detail: string) {
    super(
      `Discovery mechanism "${endpoint}" is unavailable: ${detail}. ` +
        `No fallback mechanism is attempted (fail-loud, FR-018/FR-020). ` +
        `Resolve the mechanism, or run the pipeline from ` +
        `operator-supplied candidate identifiers (FR-019).`,
    );
    this.name = 'DiscoveryUnavailableError';
    this.endpoint = endpoint;
  }
}

/**
 * Dispatches discovery to EXACTLY ONE mechanism. Constructor-injected with
 * the single active mechanism; there is no list, no ordering, no next-in-line.
 * If that mechanism is unavailable, {@link discover} throws
 * {@link DiscoveryUnavailableError} — it does not consult any other source.
 */
export class DiscoveryDispatcher {
  private readonly mechanism: DiscoveryMechanism;

  constructor(mechanism: DiscoveryMechanism) {
    this.mechanism = mechanism;
  }

  /** The endpoint this dispatcher is bound to. */
  get endpoint(): DiscoveryEndpoint {
    return this.mechanism.endpoint;
  }

  /**
   * Surface candidate records for `query` via the single active mechanism.
   *
   * @throws DiscoveryUnavailableError when the mechanism reports unavailable.
   *         No other mechanism is attempted.
   */
  async discover(
    query: string,
    opts?: DiscoverySearchOptions,
  ): Promise<readonly DiscoveryCandidate[]> {
    let available: boolean;
    try {
      available = await this.mechanism.isAvailable();
    } catch (err) {
      throw new DiscoveryUnavailableError(
        this.mechanism.endpoint,
        `availability check failed: ${describeError(err)}`,
      );
    }

    if (!available) {
      throw new DiscoveryUnavailableError(
        this.mechanism.endpoint,
        'mechanism reported it cannot service a search',
      );
    }

    return this.mechanism.search(query, opts);
  }
}

/** Render an unknown thrown value as a human-readable string. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
