/**
 * Shared BnF general-catalogue SRU parsing/URL helpers, extracted so both the
 * candidate-discovery mechanism (`@/sourcegroup/discovery/bnf-sru`) and the
 * ark resolver (`@/sourcegroup/ark-resolver`) navigate the same
 * `srw:searchRetrieveResponse` / Dublin Core shape without duplicating it.
 *
 * PROJECT PRINCIPLE -- FAIL LOUD, NO FALLBACKS: every accessor here throws a
 * descriptive Error on a malformed shape (via `@/gallica/xml`); nothing
 * fabricates a placeholder value.
 *
 * @see specs/006-source-group-acquisition/research.md -- Spike outcome (T004)
 */

import { XMLParser } from 'fast-xml-parser';
import {
  childNumber,
  childRecord,
  isRecord,
  requireRecord,
  toArray,
} from '@/gallica/xml';
import type { DiscoverySearchOptions } from '@/sourcegroup/discovery/discovery';

/** Base URL for the BnF general-catalogue SRU (T004 spike outcome). */
export const BNF_SRU_BASE = 'https://catalogue.bnf.fr/api/SRU';

/** Default `maximumRecords` when the caller does not specify one. */
const DEFAULT_MAX_RECORDS = 20;

/** Default `startRecord` (SRU is 1-based). */
const DEFAULT_START_RECORD = 1;

const ARK_PATTERN = /ark:\/[0-9]+\/[A-Za-z0-9]+/;

/** Extract the bare `ark:/.../...` token from a value that may be a full URL. */
export function extractArk(value: string): string | undefined {
  const match = value.match(ARK_PATTERN);
  return match === null ? undefined : match[0];
}

/**
 * Build a documented `searchRetrieve` URL for a caller-supplied CQL clause
 * (T004 spike, research.md): `operation=searchRetrieve&version=1.2&query=<CQL>
 * &recordSchema=dublincore&maximumRecords=&startRecord=`. The CQL is the ONLY
 * thing that varies between the free-text discovery search
 * (`bib.anywhere all "..."`) and the ark resolve (`bib.persistentid all
 * "..."`).
 */
export function buildSruSearchUrl(
  cql: string,
  opts?: DiscoverySearchOptions,
): string {
  const params = new URLSearchParams();
  params.set('operation', 'searchRetrieve');
  params.set('version', '1.2');
  params.set('query', cql);
  params.set('recordSchema', 'dublincore');
  params.set('maximumRecords', String(opts?.maxResults ?? DEFAULT_MAX_RECORDS));
  params.set('startRecord', String(opts?.startRecord ?? DEFAULT_START_RECORD));
  return `${BNF_SRU_BASE}?${params.toString()}`;
}

/**
 * A `fast-xml-parser` configured to keep leaf text verbatim (dates stay
 * strings; no numeric coercion) -- shared by every SRU consumer so the parse
 * shape never diverges.
 */
export function createSruParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    trimValues: true,
  });
}

/** Parse SRU XML into a record, failing loud on empty/malformed payloads. */
export function parseSruXml(
  parser: XMLParser,
  xml: string,
  url: string,
): Record<string, unknown> {
  if (xml.trim().length === 0) {
    throw new Error(`BnF SRU: empty response body from ${url}`);
  }
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`BnF SRU: malformed XML from ${url}: ${message}`);
  }
  return requireRecord(parsed, `BnF SRU response from ${url}`);
}

/**
 * Read a one-or-many Dublin Core element as plain text. A localized element
 * (e.g. `dc:subject` with `xml:lang`) is modeled by `fast-xml-parser` as
 * `{ '@_xml:lang': ..., '#text': value }`; a bare string is also tolerated.
 * Returns `[]` when absent -- callers decide whether that is fatal.
 */
export function textValues(value: unknown): string[] {
  return toArray(value)
    .map((raw) => {
      if (typeof raw === 'string') {
        return raw.trim();
      }
      if (isRecord(raw) && typeof raw['#text'] === 'string') {
        return raw['#text'].trim();
      }
      return '';
    })
    .filter((text) => text.length > 0);
}

/** First non-empty value of a one-or-many Dublin Core element, if any. */
export function firstTextValue(value: unknown): string | undefined {
  const values = textValues(value);
  return values.length > 0 ? values[0] : undefined;
}

/**
 * One parsed SRU record: the `srw:record` wrapper (which carries
 * `srw:recordIdentifier`) plus its `oai_dc:dc` Dublin Core payload.
 */
export interface SruDcRecord {
  /** The `srw:record` element. */
  record: Record<string, unknown>;
  /** The `oai_dc:dc` Dublin Core payload under `srw:recordData`. */
  dc: Record<string, unknown>;
}

/** The navigated `srw:searchRetrieveResponse`: its count + Dublin Core records. */
export interface SruResponse {
  /** `srw:numberOfRecords`. */
  numberOfRecords: number;
  /** One entry per `srw:record` (empty when `numberOfRecords === 0`). */
  records: SruDcRecord[];
}

/**
 * Navigate a full `srw:searchRetrieveResponse` document into its Dublin Core
 * records. `numberOfRecords = 0` (including the empty-`<srw:records/>` shape
 * BnF returns for a no-hit or diagnostic-only response) yields `records: []`.
 * Fails loud (throws) on any other malformed shape.
 */
export function parseSearchRetrieveResponse(
  doc: Record<string, unknown>,
  url: string,
): SruResponse {
  const ctx = `BnF SRU response (${url})`;
  const response = childRecord(doc, 'srw:searchRetrieveResponse', ctx);
  const numberOfRecords = childNumber(response, 'srw:numberOfRecords', ctx);
  if (numberOfRecords === 0) {
    return { numberOfRecords, records: [] };
  }

  const container = response['srw:records'];
  if (container === undefined || !isRecord(container)) {
    return { numberOfRecords, records: [] };
  }

  const rawRecords = toArray(container['srw:record']);
  const records = rawRecords.map((raw, index) => {
    const rctx = `${ctx} > srw:record[${index}]`;
    const record = requireRecord(raw, rctx);
    const recordData = childRecord(record, 'srw:recordData', rctx);
    const dc = childRecord(recordData, 'oai_dc:dc', rctx);
    return { record, dc };
  });
  return { numberOfRecords, records };
}
