/**
 * Concrete ARK resolver over GALLICA's own OAIRecord service.
 *
 * BUG FIX: the source-group acquisition pipeline's inventory step previously
 * resolved every ark through the BnF GENERAL-CATALOGUE SRU
 * (`@/sourcegroup/ark-resolver`, since removed -- `catalogue.bnf.fr`,
 * bibliographic `cb` arks). The acquisition targets are GALLICA digital
 * documents (`bpt6k` arks, `gallica.bnf.fr`), which that catalogue SRU does
 * NOT index -- it returns zero records for them, so inventory always failed
 * on the real target. Gallica's OWN `services/OAIRecord` endpoint (already
 * depended on by the rights gate, `@/rights/gate`, via `@/gallica/gallica-
 * client`'s `OaiRecordClient`) DOES resolve these arks, and is fetched
 * through the shipped `HttpClient` -- which is what gets past Gallica's
 * anti-bot 403 that a bare `curl` hits (descriptive User-Agent + polite
 * backoff, see `@/gallica/http-client`).
 *
 * Two shapes, mirroring the removed BnF-catalogue resolver's pair:
 * 1. {@link resolveArkViaGallica} -- the RICH resolver `inventory` needs: it
 *    fetches the ark's OAIRecord, parses the single Dublin Core record, and
 *    maps it to the {@link ArkMetadata} shape. Returns `null` when Gallica
 *    reports no record for the ark (see {@link navigateOaiRecordDc}).
 * 2. {@link gallicaArkIdentifierResolver} -- the THIN adapter `verify-member`
 *    and `promote` need (their `ArkResolver` only cares whether the ark
 *    resolves to SOMETHING): delegates to the rich resolver and collapses the
 *    result to `{ ark } | null`.
 *
 * PROJECT PRINCIPLE -- FAIL LOUD, NO FALLBACKS: an HTTP or parse failure
 * propagates verbatim (via the injected client + the fail-loud `@/gallica/xml`
 * navigation helpers); only a genuine "no OAI record for this ark" (Gallica's
 * `countResults="0"`, no `<notice>` element) maps to `null`. Nothing is
 * fabricated.
 */

import { XMLParser } from 'fast-xml-parser';
import { oaiRecordUrl } from '@/gallica/gallica-client';
import { childNumber, childRecord, requireRecord } from '@/gallica/xml';
import { firstTextValue, textValues } from '@/sourcegroup/discovery/bnf-sru-parse';
import type { ArkMetadata, ArkResolver } from '@/sourcegroup/inventory';
import type {
  ArkResolver as IdentifierArkResolver,
  ResolvedIdentifier,
} from '@/sourcegroup/verify-member';
import type { Title } from '@/model/source';

/**
 * The normalization scheme version applied when mapping a Gallica OAIRecord
 * Dublin Core payload to {@link ArkMetadata}. Independent of (and unrelated
 * to) the removed BnF-catalogue resolver's own versioning; bumped only if the
 * mapping below changes in a way that affects downstream re-normalization
 * (D-07).
 */
export const GALLICA_NORMALIZATION_VERSION = 1;

/** Display name for the Gallica/BnF holding archive, used as the record's `sourceArchive`. */
export const GALLICA_ARCHIVE_NAME = 'Gallica / BnF';

/**
 * The narrow Gallica capability this resolver depends on -- just the raw
 * OAIRecord fetch. `@/gallica/gallica-client`'s `GallicaHttpClient` (and its
 * `OaiRecordClient` interface) satisfy this structurally; kept separate
 * (interface segregation) so a test double need not also implement
 * `oaiRights`.
 */
export interface GallicaOaiRecordSource {
  /** Raw OAIRecord XML for an ark (verbatim; fails loud on network/HTTP error). */
  oaiRecord(ark: string): Promise<string>;
}

/** Dependencies for {@link resolveArkViaGallica} (injected -- no direct network). */
export interface ResolveArkViaGallicaDeps {
  /** The Gallica OAIRecord capability (e.g. a `GallicaHttpClient`). */
  gallica: GallicaOaiRecordSource;
  /**
   * ISO retrieval timestamp stamped onto the metadata (and its snapshot).
   * Injected for determinism; defaults to `new Date().toISOString()` at the
   * network boundary when omitted.
   */
  retrievedAt?: string;
}

/**
 * A `fast-xml-parser` configured identically to `@/gallica/gallica-client`'s
 * internal parser (kept in sync deliberately: leaf text stays verbatim, dates
 * are never numerically coerced) so the two consumers of Gallica's OAIRecord
 * XML never diverge in shape.
 */
function oaiRecordParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: true,
  });
}

/** Parse OAIRecord XML into a record, failing loud on empty/malformed payloads. */
function parseOaiRecordXml(xml: string, url: string): Record<string, unknown> {
  if (xml.trim().length === 0) {
    throw new Error(`OAIRecord ${url}: empty response body`);
  }
  let parsed: unknown;
  try {
    parsed = oaiRecordParser().parse(xml);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OAIRecord ${url}: malformed XML: ${message}`);
  }
  return requireRecord(parsed, `OAIRecord response from ${url}`);
}

/**
 * Navigate `results > notice > record > metadata > oai_dc:dc` -- the same
 * path `@/gallica/gallica-client`'s private `extractDcRights`/`extractDcDate`
 * helpers use for an issue whose existence is already assumed. Gallica
 * signals "no OAI record for this ark" with `results/@countResults="0"` and
 * no `<notice>` child (never an HTTP 404) -- that shape yields `null` here;
 * any OTHER failure to navigate this path is a genuine malformed-response
 * error and fails loud via `@/gallica/xml`'s accessors.
 */
function navigateOaiRecordDc(
  doc: Record<string, unknown>,
  url: string,
): Record<string, unknown> | null {
  const results = childRecord(doc, 'results', `OAIRecord ${url}`);
  const countResults = childNumber(results, '@_countResults', `OAIRecord ${url}`);
  if (countResults === 0) {
    return null;
  }
  const notice = childRecord(results, 'notice', `OAIRecord ${url}`);
  const record = childRecord(notice, 'record', `OAIRecord ${url}`);
  const metadata = childRecord(record, 'metadata', `OAIRecord ${url}`);
  return childRecord(metadata, 'oai_dc:dc', `OAIRecord ${url}`);
}

/** Map every `dc:title` value to an archive-supplied {@link Title}. */
function titlesOf(dc: Record<string, unknown>): Title[] {
  return textValues(dc['dc:title']).map((text) => ({ text, role: 'archive' }));
}

/** First `dc:identifier` value that is an absolute http(s) URL, if any. */
function firstUrlIdentifier(dc: Record<string, unknown>): string | undefined {
  return textValues(dc['dc:identifier']).find((value) => /^https?:\/\//.test(value));
}

/**
 * Human-readable names {@link normalizeLanguage} maps a raw `dc:language`
 * value onto, keyed by the raw value lowercased -- covering Gallica's ISO-3
 * codes (`fre`/`fra`, `eng`) and the human-readable variants it also emits
 * (`français`/`francais`, `english`/`anglais`). Deliberately matches the
 * human-readable convention already used by `bibliography/sources/*.yml`
 * (`language: French`, `language: English`), never an ISO code.
 */
const LANGUAGE_NAMES_BY_RAW: ReadonlyMap<string, string> = new Map([
  ['fre', 'French'],
  ['fra', 'French'],
  ['français', 'French'],
  ['francais', 'French'],
  ['eng', 'English'],
  ['english', 'English'],
  ['anglais', 'English'],
]);

/**
 * Map a raw `dc:language` value to the human-readable name convention
 * `bibliography/sources/*.yml` uses (`French`, `English`, ...) -- never an
 * ISO code. An unrecognized value is never dropped: it passes through
 * capitalized reasonably (first letter upper, rest lower) rather than being
 * silently discarded, per the project's no-fallback/no-fabrication stance --
 * this is a display-casing transform of the archive's own value, not an
 * invented one.
 */
export function normalizeLanguage(raw: string): string {
  const trimmed = raw.trim();
  const known = LANGUAGE_NAMES_BY_RAW.get(trimmed.toLowerCase());
  if (known !== undefined) {
    return known;
  }
  return trimmed.length === 0
    ? trimmed
    : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1).toLowerCase()}`;
}

/** Map one navigated OAIRecord Dublin Core payload to {@link ArkMetadata}. */
function toArkMetadata(
  dc: Record<string, unknown>,
  rawResponse: string,
  endpoint: string,
  retrievedAt: string,
): ArkMetadata {
  const metadata: ArkMetadata = {
    titles: titlesOf(dc),
    rawResponse,
    endpoint,
    retrievedAt,
    normalizationVersion: GALLICA_NORMALIZATION_VERSION,
    archive: GALLICA_ARCHIVE_NAME,
  };

  const creator = firstTextValue(dc['dc:creator']);
  if (creator !== undefined) {
    metadata.creator = creator;
  }
  // Kept verbatim (no YYYY-MM-DD format assertion, unlike gallica-client's
  // issue-specific `extractDcDate`): a monograph's `dc:date` may be a bare
  // year, e.g. `1889`.
  const date = firstTextValue(dc['dc:date']);
  if (date !== undefined) {
    metadata.date = date;
  }
  const rightsRaw = firstTextValue(dc['dc:rights']);
  if (rightsRaw !== undefined) {
    metadata.rightsRaw = rightsRaw;
  }
  const originalUrl = firstUrlIdentifier(dc);
  if (originalUrl !== undefined) {
    metadata.originalUrl = originalUrl;
  }
  // Multiple dc:language values may be present (e.g. `fre` and `français`
  // side by side) -- prefer the first, matching `firstTextValue`'s existing
  // convention for every other repeated DC element here.
  const languageRaw = firstTextValue(dc['dc:language']);
  if (languageRaw !== undefined) {
    metadata.language = normalizeLanguage(languageRaw);
  }
  return metadata;
}

/**
 * Rich resolver: fetch the ark's OAIRecord from Gallica and map its single
 * Dublin Core record to {@link ArkMetadata}. Returns `null` when Gallica
 * reports no record for the ark (a dead/unknown ark); throws (fail loud) on
 * any HTTP or parse failure.
 */
export async function resolveArkViaGallica(
  ark: string,
  deps: ResolveArkViaGallicaDeps,
): Promise<ArkMetadata | null> {
  const trimmed = ark.trim();
  if (trimmed.length === 0) {
    throw new Error('resolveArkViaGallica: ark must not be empty');
  }
  const retrievedAt = deps.retrievedAt ?? new Date().toISOString();
  const endpoint = oaiRecordUrl(trimmed);
  const rawResponse = await deps.gallica.oaiRecord(trimmed);
  const doc = parseOaiRecordXml(rawResponse, endpoint);
  const dc = navigateOaiRecordDc(doc, endpoint);
  if (dc === null) {
    return null;
  }
  return toArkMetadata(dc, rawResponse, endpoint, retrievedAt);
}

/**
 * Bind the rich resolver to a {@link GallicaOaiRecordSource}, producing the
 * {@link ArkResolver} `inventory` injects (`(ark) => Promise<ArkMetadata |
 * null>`).
 */
export function gallicaArkMetadataResolver(gallica: GallicaOaiRecordSource): ArkResolver {
  return (ark: string) => resolveArkViaGallica(ark, { gallica });
}

/**
 * Thin adapter: the {@link IdentifierArkResolver} `verify-member`/`promote`
 * inject only asks whether an ark resolves to SOMETHING. Delegate to the rich
 * resolver and collapse a hit to `{ ark }` (the resolved DC record is opaque
 * to those callers), a miss to `null`.
 */
export function gallicaArkIdentifierResolver(
  gallica: GallicaOaiRecordSource,
): IdentifierArkResolver {
  return async (ark: string): Promise<ResolvedIdentifier | null> => {
    const metadata = await resolveArkViaGallica(ark, { gallica });
    return metadata === null ? null : { ark };
  };
}
