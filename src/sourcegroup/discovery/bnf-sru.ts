/**
 * Concrete BnF general-catalogue SRU discovery mechanism (T032/T033).
 *
 * Implements the `DiscoveryMechanism` interface scaffolded in
 * `src/sourcegroup/discovery/discovery.ts` against the single mechanism
 * selected by the T004 spike (see "## Spike outcome (T004)" in
 * specs/006-source-group-acquisition/research.md): the documented,
 * unauthenticated BnF general-catalogue SRU at
 * `https://catalogue.bnf.fr/api/SRU` -- distinct from the anti-bot-blocked
 * Gallica web search.
 *
 * Reuses the repo's existing HTTP (`src/gallica/http-client.ts` -- injected
 * fetch, politeness/backoff, descriptive throws) and the shared SRU parsing
 * helpers (`src/sourcegroup/discovery/bnf-sru-parse.ts` -- also used by the
 * ark resolver, so the response shape is navigated in exactly one place)
 * rather than reinventing them.
 *
 * PROJECT PRINCIPLE -- FAIL LOUD, NO FALLBACKS: this client never swallows
 * an HTTP/parse error or manufactures a placeholder candidate. Failures
 * propagate as thrown `Error`s; `isAvailable` reports `false` on failure so
 * the dispatcher's fail-loud boundary (`DiscoveryUnavailableError`) fires
 * instead of a fallback. Relevance judgment stays with the human/agent --
 * this client only surfaces candidates, it never filters or ranks them.
 */

import type { XMLParser } from 'fast-xml-parser';
import type { HttpClient } from '@/gallica/http-client';
import {
  BNF_SRU_BASE,
  buildSruSearchUrl,
  createSruParser,
  extractArk,
  firstTextValue,
  parseSearchRetrieveResponse,
  parseSruXml,
  textValues,
  type SruDcRecord,
} from '@/sourcegroup/discovery/bnf-sru-parse';
import type {
  DiscoveryCandidate,
  DiscoveryEndpoint,
  DiscoveryMechanism,
  DiscoverySearchOptions,
} from '@/sourcegroup/discovery/discovery';

/** Base URL for the BnF general-catalogue SRU (re-exported for callers/tests). */
export { BNF_SRU_BASE };

const ENDPOINT: DiscoveryEndpoint = 'bnf-catalogue-sru';

/**
 * Build the CQL clause for a free-text query over `bib.anywhere` (the
 * general index the spike validated). Double quotes in the operator's query
 * text are escaped so they cannot break out of the CQL string literal.
 */
export function buildCql(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    throw new Error('BnfSruDiscoveryMechanism: query must not be empty');
  }
  const escaped = trimmed.replace(/"/g, '\\"');
  return `bib.anywhere all "${escaped}"`;
}

/**
 * Build the documented `searchRetrieve` URL over `bib.anywhere` (T004 spike,
 * research.md): delegates the fixed-parameter/pagination assembly to the
 * shared `buildSruSearchUrl`.
 */
export function buildSearchRetrieveUrl(
  query: string,
  opts?: DiscoverySearchOptions,
): string {
  return buildSruSearchUrl(buildCql(query), opts);
}

/** The lightweight `explain` probe URL used for the availability check. */
export function buildExplainUrl(): string {
  return `${BNF_SRU_BASE}?operation=explain&version=1.2`;
}

/**
 * Resolve the candidate's stable identifier: prefer `srw:recordIdentifier`
 * (the BnF SRU response's bare ark, e.g. `ark:/12148/cb38493463r`), falling
 * back to an `ark:/...` token embedded in one of the record's `dc:identifier`
 * values (which BnF emits as a full catalogue URL). Throws when neither
 * yields an ark -- there is no non-ark placeholder identifier.
 */
function resolveIdentifier(
  record: Record<string, unknown>,
  dc: Record<string, unknown>,
  ctx: string,
): string {
  const recordIdentifier = record['srw:recordIdentifier'];
  if (typeof recordIdentifier === 'string' && recordIdentifier.length > 0) {
    const ark = extractArk(recordIdentifier);
    if (ark !== undefined) {
      return ark;
    }
  }
  for (const candidate of textValues(dc['dc:identifier'])) {
    const ark = extractArk(candidate);
    if (ark !== undefined) {
      return ark;
    }
  }
  throw new Error(
    `${ctx}: no ark identifier found in srw:recordIdentifier or dc:identifier`,
  );
}

/** Parse one navigated `srw:record` into a `DiscoveryCandidate`. */
function toCandidate(
  { record, dc }: SruDcRecord,
  index: number,
  url: string,
): DiscoveryCandidate {
  const ctx = `BnF SRU response (${url}) > srw:record[${index}]`;
  return {
    identifier: resolveIdentifier(record, dc, ctx),
    titleHint: firstTextValue(dc['dc:title']),
    creatorHint: firstTextValue(dc['dc:creator']),
    dateHint: firstTextValue(dc['dc:date']),
    endpoint: ENDPOINT,
  };
}

/**
 * Live BnF-general-catalogue-SRU discovery mechanism: builds the documented
 * `searchRetrieve` URL, fetches through the injected `HttpClient` (which
 * owns User-Agent, pacing, and backoff), and parses the Dublin Core XML.
 * No inheritance: the `HttpClient` is injected via the constructor.
 */
export class BnfSruDiscoveryMechanism implements DiscoveryMechanism {
  readonly endpoint: DiscoveryEndpoint = ENDPOINT;

  private readonly http: HttpClient;
  private readonly parser: XMLParser;

  constructor(http: HttpClient) {
    this.http = http;
    this.parser = createSruParser();
  }

  /**
   * Lightweight reachability probe via the SRU `explain` operation (no
   * query, minimal payload). Returns `false` -- never throws -- on any
   * HTTP/network/parse failure, so the dispatcher's fail-loud boundary
   * (`DiscoveryUnavailableError`) fires instead of an uncaught exception.
   */
  async isAvailable(): Promise<boolean> {
    const url = buildExplainUrl();
    try {
      const xml = await this.http.getText(url);
      const doc = parseSruXml(this.parser, xml, url);
      return 'srw:explainResponse' in doc;
    } catch {
      return false;
    }
  }

  /**
   * Run a `searchRetrieve` query and return candidates. Never judges
   * relevance -- it surfaces exactly what the SRU response contains. Throws
   * (does not swallow) on HTTP failure or a malformed response; there is no
   * fabricated result set.
   */
  async search(
    query: string,
    opts?: DiscoverySearchOptions,
  ): Promise<readonly DiscoveryCandidate[]> {
    const url = buildSearchRetrieveUrl(query, opts);
    const xml = await this.http.getText(url);
    const doc = parseSruXml(this.parser, xml, url);
    const { records } = parseSearchRetrieveResponse(doc, url);
    return records.map((dcRecord, index) => toCandidate(dcRecord, index, url));
  }
}
