/**
 * SourceConfig type + the source registry (Phase 1, T004).
 *
 * A SourceConfig captures the per-source knobs the client needs to run a
 * governed query against one reference source. The registry maps a source
 * id -> its config; entries are added by later tasks (Papers Past, the
 * fixture server), not here.
 */

import type { GraceWindowConfig, QuerySummary } from '@/sourcequery/types';
import { PAPERS_PAST } from '@/sourcequery/sources/papers-past';

// Re-exported from the leaf `grace` module so existing importers of
// `DEFAULT_GRACE` from `source-config` keep working, while the actual
// definition lives outside the circular value-import path (see grace.ts).
export { DEFAULT_GRACE } from '@/sourcequery/grace';

/** Per-source configuration for the Source Query Client. */
export interface SourceConfig {
  /** Source key; also the `repository-responses/<id>/` directory name. */
  id: string;
  /** Source origin. */
  baseUrl: string;
  /** Builds the native query URL for a source, optionally for a given page. */
  buildQueryUrl: (query: string, page?: number) => string;
  /** Selector proving a real result page rendered (block-detection anchor). */
  resultSelector: string;
  /** Parses count + first-page candidates from persisted HTML. */
  parseSummary: (html: string) => QuerySummary;
  /** Whether raw pages may be persisted, or only derived facts (FR-009). */
  retention: 'persist' | 'derived-facts-only';
  /** Required credit line for derived-facts-only sources. */
  attribution: string;
  /** ISO country preferred for geo-selecting an exit node. */
  preferredGeo?: string;
  /** Normal-pass pacing between navigations, in milliseconds. */
  minIntervalMs: number;
  /** Post-switch grace-window discipline. */
  grace: GraceWindowConfig;
}

/**
 * Source registry: source id -> SourceConfig.
 * Intentionally empty here; Papers Past and fixture configs are registered
 * by later tasks.
 */
const sourceRegistry: Record<string, SourceConfig> = {};

/** Registers a SourceConfig under its own `id`. */
export function registerSource(config: SourceConfig): void {
  sourceRegistry[config.id] = config;
}

/**
 * Looks up a registered SourceConfig by id.
 * Throws a clear error on an unknown id (fail-loud, Principle V) rather
 * than returning `undefined` or a fallback.
 */
export function getSourceConfig(id: string): SourceConfig {
  const config = sourceRegistry[id];
  if (!config) {
    throw new Error(
      `Unknown source id "${id}": no SourceConfig registered. Registered ids: [${Object.keys(sourceRegistry).join(', ')}]`
    );
  }
  return config;
}

// Auto-register known sources. papers-past.ts imports `SourceConfig` type-only
// (erased at runtime), so this value-level import here is not circular.
registerSource(PAPERS_PAST);
