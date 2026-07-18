/**
 * Reusable local-fixture-server SourceConfig builder (Phase 1 Polish, T027,
 * research.md R3).
 *
 * `tests/integration/sourcequery/fixture.test.ts` needs a `SourceConfig`
 * whose `buildQueryUrl` targets a fixture HTTP server bound to an EPHEMERAL
 * port (`server.listen(0, ...)`). The port is only known once the server has
 * actually started (inside `beforeAll`), so a single static, module-level
 * `SourceConfig` -- registered once at import time, the way `PAPERS_PAST` is
 * -- is impossible: there is no `baseUrl` to close over until runtime. A
 * BUILDER that takes the runtime `baseUrl` (and the other per-fixture knobs)
 * and returns a fresh `SourceConfig` is therefore the faithful realization
 * of "one source of truth" for the fixture config shape; callers still
 * `registerSource(...)` the built config once the port is known.
 *
 * NOTE on the import below: `SourceConfig` is imported type-only so this
 * module has no runtime dependency on `@/sourcequery/source-config` (the
 * type import is erased by the compiler), matching the pattern in
 * `papers-past.ts`. Unlike `papers-past.ts`, this module is NOT imported by
 * `source-config.ts` for auto-registration -- fixture configs are built and
 * registered on demand by tests, not shipped as a live source.
 */

import type { SourceConfig } from '@/sourcequery/source-config';
import { DEFAULT_GRACE } from '@/sourcequery/source-config';
import type { Candidate, QuerySummary } from '@/sourcequery/types';
import { parse } from 'node-html-parser';

/** Default result-row selector, matching the fixture pages' markup. */
const DEFAULT_RESULT_SELECTOR = '.search-results .result';
const COUNT_SELECTOR = '.results-count';

/**
 * Default fixture parser (fail-loud, no fallbacks): reads the plain-digit
 * count from `.results-count` and the title/ref of each result row matching
 * `resultSelector`. Throws rather than guessing when the count element, its
 * digits, a row link, or an href is missing, and when the parsed count is not
 * grounded in the served HTML bytes (research R7).
 */
function buildDefaultParseSummary(resultSelector: string): (html: string) => QuerySummary {
  return function parseFixtureSummary(html: string): QuerySummary {
    const root = parse(html);
    const countEl = root.querySelector(COUNT_SELECTOR);
    if (!countEl) {
      throw new Error(
        `fixture parseSummary: no element matching "${COUNT_SELECTOR}" found; cannot determine result count.`
      );
    }
    const match = countEl.text.match(/\d+/);
    if (!match) {
      throw new Error(
        `fixture parseSummary: no digit sequence found in count element text "${countEl.text}".`
      );
    }
    const count = Number.parseInt(match[0], 10);
    if (!html.includes(String(count))) {
      throw new Error(
        `fixture parseSummary: ungrounded count "${count}" - its String(count) form is not a ` +
          `literal substring of the parsed HTML.`
      );
    }
    const rows = root.querySelectorAll(resultSelector);
    const candidates: Candidate[] = rows.map((row): Candidate => {
      const link = row.querySelector('a');
      if (!link) {
        throw new Error('fixture parseSummary: result row is missing its title/ref <a> link.');
      }
      const ref = link.getAttribute('href');
      if (!ref) {
        throw new Error('fixture parseSummary: result link is missing an href.');
      }
      return { title: link.text.trim(), ref };
    });
    return { count, candidates };
  };
}

/** Arguments for {@link buildFixtureSourceConfig}. */
export interface BuildFixtureSourceConfigArgs {
  /** Source key; also the `repository-responses/<id>/` directory name. */
  id: string;
  /** Runtime base URL of the fixture server, e.g. `http://127.0.0.1:<port>`. */
  baseUrl: string;
  /** Route path queried on the fixture server. Defaults to `/results`. */
  path?: string;
  /** Result-row selector. Defaults to `.search-results .result`. */
  resultSelector?: string;
  /** Summary parser. Defaults to a plain-digit-count + `.result` parser. */
  parseSummary?: (html: string) => QuerySummary;
  /** Persistence policy. Defaults to `'persist'`. */
  retention?: 'persist' | 'derived-facts-only';
  /** ISO country preferred for geo-selecting an exit node. */
  preferredGeo?: string;
  /** Normal-pass pacing between navigations, in milliseconds. Defaults to 50. */
  minIntervalMs?: number;
}

/**
 * Builds a `SourceConfig` targeting a local fixture HTTP server, given its
 * runtime `baseUrl` (known only once the server has bound its ephemeral
 * port). See the file header for why this must be a builder rather than a
 * static registered config.
 */
export function buildFixtureSourceConfig(args: BuildFixtureSourceConfigArgs): SourceConfig {
  const path = args.path ?? '/results';
  const resultSelector = args.resultSelector ?? DEFAULT_RESULT_SELECTOR;
  const parseSummary = args.parseSummary ?? buildDefaultParseSummary(resultSelector);

  function buildQueryUrl(query: string, page?: number): string {
    const base = `${args.baseUrl}${path}?q=${encodeURIComponent(query)}`;
    return page !== undefined && page > 1 ? `${base}&page=${page}` : base;
  }

  return {
    id: args.id,
    baseUrl: args.baseUrl,
    buildQueryUrl,
    resultSelector,
    parseSummary,
    retention: args.retention ?? 'persist',
    attribution: '',
    preferredGeo: args.preferredGeo,
    minIntervalMs: args.minIntervalMs ?? 50,
    grace: DEFAULT_GRACE,
  };
}
