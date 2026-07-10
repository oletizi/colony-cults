/**
 * Concrete ARK resolver over the BnF general-catalogue SRU (T020 support).
 *
 * The source-group pipeline injects an ark resolver into every stage so those
 * stages never reach the network directly and stay testable
 * (`@/sourcegroup/inventory`, `@/sourcegroup/verify-member`,
 * `@/sourcegroup/promote`). This module is the ONE concrete implementation the
 * CLI wires in, in two shapes:
 *
 * 1. {@link resolveArkViaBnfSru} -- the RICH resolver `inventory` needs: it
 *    queries the SRU by `bib.persistentid all "<ark>"` (the ark CQL index, per
 *    research.md § Spike outcome T004), parses the single Dublin Core record,
 *    and maps it to the {@link ArkMetadata} shape (titles/creator/rights-raw/
 *    original-url/raw-response/endpoint/retrievedAt/normalizationVersion/
 *    archive). Returns `null` when the ark resolves to zero records.
 * 2. {@link bnfArkIdentifierResolver} -- the THIN adapter `verify-member` and
 *    `promote` need (their `ArkResolver` only cares whether the ark resolves to
 *    SOMETHING): it delegates to the rich resolver and collapses the result to
 *    `{ ark } | null`.
 *
 * PROJECT PRINCIPLE -- FAIL LOUD, NO FALLBACKS: an HTTP or parse failure
 * propagates verbatim (via the shared parse helpers + the injected
 * `HttpClient`); only a genuinely empty result set (zero records) maps to
 * `null`. Nothing is fabricated.
 *
 * @see specs/006-source-group-acquisition/research.md -- Spike outcome (T004)
 */

import type { HttpClient } from '@/gallica/http-client';
import {
  buildSruSearchUrl,
  createSruParser,
  extractArk,
  firstTextValue,
  parseSearchRetrieveResponse,
  parseSruXml,
  textValues,
  type SruDcRecord,
} from '@/sourcegroup/discovery/bnf-sru-parse';
import type { ArkMetadata, ArkResolver } from '@/sourcegroup/inventory';
import type {
  ArkResolver as IdentifierArkResolver,
  ResolvedIdentifier,
} from '@/sourcegroup/verify-member';
import type { Title } from '@/model/source';

/**
 * The normalization scheme version applied when mapping an SRU Dublin Core
 * record to {@link ArkMetadata}. Bumped only if the mapping below changes in a
 * way that affects downstream re-normalization (D-07); stored on every
 * snapshot so an old snapshot can be re-read against the scheme that produced
 * it.
 */
export const BNF_NORMALIZATION_VERSION = 1;

/** Display name for the BnF holding archive, used as the record's `sourceArchive`. */
export const BNF_ARCHIVE_NAME = 'Gallica / BnF';

/** Dependencies for {@link resolveArkViaBnfSru} (injected -- no direct network). */
export interface ResolveArkDeps {
  /** The shared polite HTTP client (owns User-Agent, pacing, backoff). */
  http: HttpClient;
  /**
   * ISO retrieval timestamp stamped onto the metadata (and its snapshot).
   * Injected for determinism; defaults to `new Date().toISOString()` at the
   * network boundary when omitted.
   */
  retrievedAt?: string;
}

/**
 * Build the CQL clause resolving an ark against the BnF `bib.persistentid`
 * index (research.md § Spike outcome: `bib.persistentid` is the ARK CQL
 * index). Double quotes in the ark are escaped so they cannot break out of the
 * CQL string literal.
 */
export function buildArkPersistentIdCql(ark: string): string {
  const trimmed = ark.trim();
  if (trimmed.length === 0) {
    throw new Error('resolveArkViaBnfSru: ark must not be empty');
  }
  const escaped = trimmed.replace(/"/g, '\\"');
  return `bib.persistentid all "${escaped}"`;
}

/** First `dc:identifier` value that is an absolute http(s) URL, if any. */
function firstUrlIdentifier(dc: Record<string, unknown>): string | undefined {
  return textValues(dc['dc:identifier']).find((value) => /^https?:\/\//.test(value));
}

/** Map every `dc:title` value to an archive-supplied {@link Title}. */
function titlesOf(dc: Record<string, unknown>): Title[] {
  return textValues(dc['dc:title']).map((text) => ({ text, role: 'archive' }));
}

/** Map one navigated SRU Dublin Core record to {@link ArkMetadata}. */
function toArkMetadata(
  { dc }: SruDcRecord,
  rawResponse: string,
  endpoint: string,
  retrievedAt: string,
): ArkMetadata {
  const metadata: ArkMetadata = {
    titles: titlesOf(dc),
    rawResponse,
    endpoint,
    retrievedAt,
    normalizationVersion: BNF_NORMALIZATION_VERSION,
    archive: BNF_ARCHIVE_NAME,
  };

  const creator = firstTextValue(dc['dc:creator']);
  if (creator !== undefined) {
    metadata.creator = creator;
  }
  const rightsRaw = firstTextValue(dc['dc:rights']);
  if (rightsRaw !== undefined) {
    metadata.rightsRaw = rightsRaw;
  }
  const originalUrl = firstUrlIdentifier(dc);
  if (originalUrl !== undefined) {
    metadata.originalUrl = originalUrl;
  }
  return metadata;
}

/**
 * Rich resolver: query the BnF general-catalogue SRU by the ark's
 * `bib.persistentid` index and map the single Dublin Core record to
 * {@link ArkMetadata}. Returns `null` when the ark resolves to zero records (a
 * dead/unknown ark); throws (fail loud) on any HTTP or parse failure.
 */
export async function resolveArkViaBnfSru(
  ark: string,
  deps: ResolveArkDeps,
): Promise<ArkMetadata | null> {
  const retrievedAt = deps.retrievedAt ?? new Date().toISOString();
  const url = buildSruSearchUrl(buildArkPersistentIdCql(ark), { maxResults: 1 });
  const xml = await deps.http.getText(url);
  const doc = parseSruXml(createSruParser(), xml, url);
  const { records } = parseSearchRetrieveResponse(doc, url);
  const first = records[0];
  if (first === undefined) {
    return null;
  }
  return toArkMetadata(first, xml, url, retrievedAt);
}

/**
 * Bind the rich resolver to an {@link HttpClient}, producing the
 * {@link ArkResolver} `inventory` injects (`(ark) => Promise<ArkMetadata |
 * null>`).
 */
export function bnfArkMetadataResolver(http: HttpClient): ArkResolver {
  return (ark: string) => resolveArkViaBnfSru(ark, { http });
}

/**
 * Thin adapter: the {@link IdentifierArkResolver} `verify-member`/`promote`
 * inject only asks whether an ark resolves to SOMETHING. Delegate to the rich
 * resolver and collapse a hit to `{ ark }` (the resolved DC record is opaque
 * to those callers), a miss to `null`.
 */
export function bnfArkIdentifierResolver(http: HttpClient): IdentifierArkResolver {
  return async (ark: string): Promise<ResolvedIdentifier | null> => {
    const metadata = await resolveArkViaBnfSru(ark, { http });
    return metadata === null ? null : { ark };
  };
}
