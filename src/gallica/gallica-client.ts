import { XMLParser } from 'fast-xml-parser';
import type { HttpClient } from '@/gallica/http-client';
import { assertValidArk } from '@/gallica/ark';
import {
  childNumber,
  childRecord,
  childString,
  requireRecord,
  toArray,
} from '@/gallica/xml';

const BASE = 'https://gallica.bnf.fr';

/** One issue as listed by the `Issues` service: ark + host's human date. */
export interface GallicaIssueRef {
  /** Issue ark, e.g. `bpt6k5603637g`. */
  ark: string;
  /** Host's human date label, e.g. `15 juillet 1879`. */
  label: string;
}

/** Year index from the `Issues` year-list response. */
export interface YearIndex {
  /** Host's authoritative total issue count (`@totalIssues`). */
  totalIssues: number;
  /** Ordered list of years the periodical was published, e.g. `["1879",…]`. */
  years: string[];
}

/** Full enumeration of a periodical's issues across every year. */
export interface IssuesEnumeration {
  totalIssues: number;
  years: string[];
  issues: GallicaIssueRef[];
}

/**
 * The Gallica capabilities the census builder depends on. Defined as an
 * interface so `buildCensus` can be exercised with a fake in unit tests
 * (interface-first DI, composition over inheritance).
 */
export interface GallicaClient {
  /** Year list + authoritative total for a periodical. */
  years(periodicalArk: string): Promise<YearIndex>;
  /** The issues published in one year. */
  issuesForYear(periodicalArk: string, year: string): Promise<GallicaIssueRef[]>;
  /** Every issue across every year, plus the authoritative total. */
  issues(periodicalArk: string): Promise<IssuesEnumeration>;
  /** Page count (`nbVueImages`) for one issue. */
  pagination(issueArk: string): Promise<number>;
}

/**
 * Parsed rights view of an issue's OAIRecord: the full raw XML (kept verbatim
 * for provenance, FR-005) plus the extracted `dc:rights` values the gate
 * inspects.
 */
export interface OaiRecordRights {
  /** The full OAIRecord XML response, byte-for-byte as fetched. */
  rawResponse: string;
  /** The parsed `dc:rights` values (empty when none are present). */
  dcRights: string[];
}

/**
 * The per-item rights capability the rights gate (`src/rights/gate.ts`)
 * depends on. Segregated from {@link GallicaClient} so the gate depends only
 * on what it uses.
 */
export interface OaiRecordClient {
  /** Raw OAIRecord XML for an issue (verbatim; stored in provenance). */
  oaiRecord(issueArk: string): Promise<string>;
  /** Raw OAIRecord XML plus its parsed `dc:rights` values. */
  oaiRights(issueArk: string): Promise<OaiRecordRights>;
}

/**
 * The per-issue date capability. Segregated so the fetch CLI can resolve an
 * issue's `YYYY-MM-DD` date (for its archive directory name) from the host when
 * a census is not on disk, depending only on what it uses.
 */
export interface IssueMetaClient {
  /** Normalized issue date (`YYYY-MM-DD`) from OAIRecord `dc:date`. */
  issueDate(issueArk: string): Promise<string>;
}

/** Dimensions reported by an IIIF `info.json` for one page image. */
export interface IiifInfo {
  width: number;
  height: number;
}

/**
 * The full-resolution image capability the fetch tasks depend on. `page`
 * is 1-based (`1..nbVueImages`).
 */
export interface IiifClient {
  /** IIIF `info.json` dimensions for a page. */
  iiifInfo(issueArk: string, page: number): Promise<IiifInfo>;
  /** Full native-resolution JPEG bytes for a page. */
  iiifImage(issueArk: string, page: number): Promise<Uint8Array>;
}

/**
 * Reduce a periodical ark to its bare identifier root (drops the
 * `ark:/12148/` namespace and a trailing `/date`), so URL construction is
 * uniform regardless of how the caller wrote the ark.
 *
 *   `ark:/12148/cb328261098/date` -> `cb328261098`
 *   `cb328261098/date`            -> `cb328261098`
 *   `cb328261098`                 -> `cb328261098`
 */
function periodicalRoot(periodicalArk: string): string {
  const root = periodicalArk
    .trim()
    .replace(/^ark:\/12148\//, '')
    .replace(/\/date$/, '');
  if (root.length === 0) {
    throw new Error(
      `GallicaClient: empty periodical ark from "${periodicalArk}"`,
    );
  }
  return assertValidArk(root);
}

/** Reduce an issue ark to its bare identifier (drops `ark:/12148/`). */
function issueRoot(issueArk: string): string {
  const root = issueArk.trim().replace(/^ark:\/12148\//, '');
  if (root.length === 0) {
    throw new Error(`GallicaClient: empty issue ark from "${issueArk}"`);
  }
  return assertValidArk(root);
}

/** Reject a non-positive or non-integer page ordinal (fail loud, no clamp). */
function requirePage(page: number, issueArk: string): number {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(
      `GallicaClient: page must be a 1-based integer, got ${page} ` +
        `(issue ${issueArk})`,
    );
  }
  return page;
}

/**
 * The documented full-native IIIF JPEG URL for one page of an issue. Exported
 * so the fetch layer can record it verbatim as an asset's `original_url`
 * (FR-007) -- a single source of truth shared with {@link GallicaHttpClient.iiifImage}.
 */
export function iiifImageUrl(issueArk: string, page: number): string {
  const root = issueRoot(issueArk);
  const n = requirePage(page, issueArk);
  return `${BASE}/iiif/ark:/12148/${root}/f${n}/full/full/0/native.jpg`;
}

/**
 * The issue's human landing / catalog URL, e.g.
 * `https://gallica.bnf.fr/ark:/12148/bpt6k5603637g` -- recorded as an asset's
 * `catalog_url` in provenance.
 */
export function issueLandingUrl(issueArk: string): string {
  const root = issueRoot(issueArk);
  return `${BASE}/ark:/12148/${root}`;
}

/**
 * Extract the `dc:rights` values from a parsed OAIRecord document.
 *
 * Navigation: `results > notice > record > metadata > oai_dc:dc > dc:rights`.
 * A `dc:rights` element carries an `xml:lang` attribute, so fast-xml-parser
 * models it as `{ '@_xml:lang': ..., '#text': value }`; a bare string is also
 * tolerated. Absent `dc:rights` yields `[]` (the gate then treats it as not
 * public-domain -- FR-004), never a throw.
 */
function extractDcRights(
  doc: Record<string, unknown>,
  url: string,
): string[] {
  const results = childRecord(doc, 'results', `OAIRecord ${url}`);
  const notice = childRecord(results, 'notice', `OAIRecord ${url}`);
  const record = childRecord(notice, 'record', `OAIRecord ${url}`);
  const metadata = childRecord(record, 'metadata', `OAIRecord ${url}`);
  const dc = childRecord(metadata, 'oai_dc:dc', `OAIRecord ${url}`);
  return toArray(dc['dc:rights']).map((raw, index) => {
    if (typeof raw === 'string' && raw.length > 0) {
      return raw;
    }
    const element = requireRecord(
      raw,
      `OAIRecord ${url} > dc:rights[${index}]`,
    );
    return childString(
      element,
      '#text',
      `OAIRecord ${url} > dc:rights[${index}]`,
    );
  });
}

/**
 * Extract the single `dc:date` value from a parsed OAIRecord document. Gallica
 * emits it already normalized to `YYYY-MM-DD` (e.g. `1879-07-15`). Fails loud
 * when absent or malformed -- there is no fallback date.
 */
function extractDcDate(doc: Record<string, unknown>, url: string): string {
  const results = childRecord(doc, 'results', `OAIRecord ${url}`);
  const notice = childRecord(results, 'notice', `OAIRecord ${url}`);
  const record = childRecord(notice, 'record', `OAIRecord ${url}`);
  const metadata = childRecord(record, 'metadata', `OAIRecord ${url}`);
  const dc = childRecord(metadata, 'oai_dc:dc', `OAIRecord ${url}`);
  const value = childString(dc, 'dc:date', `OAIRecord ${url}`).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `OAIRecord ${url} > dc:date: expected YYYY-MM-DD, got "${value}"`,
    );
  }
  return value;
}

/**
 * Live Gallica client: builds the documented service URLs, fetches through the
 * injected {@link HttpClient} (which owns User-Agent, pacing, and backoff), and
 * parses the XML with `fast-xml-parser`. Malformed/empty payloads throw.
 *
 * No inheritance: the HttpClient is injected via the constructor.
 */
export class GallicaHttpClient
  implements GallicaClient, OaiRecordClient, IiifClient, IssueMetaClient
{
  private readonly http: HttpClient;
  private readonly parser: XMLParser;

  constructor(http: HttpClient) {
    this.http = http;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      // Keep leaf text verbatim (dates stay strings; no numeric coercion).
      parseTagValue: false,
      trimValues: true,
    });
  }

  async years(periodicalArk: string): Promise<YearIndex> {
    const root = periodicalRoot(periodicalArk);
    const url = `${BASE}/services/Issues?ark=${root}/date`;
    const xml = await this.http.getText(url);
    const doc = this.parse(xml, url);
    const issues = childRecord(doc, 'issues', 'Issues year list');
    const totalIssues = childNumber(
      issues,
      '@_totalIssues',
      'Issues year list',
    );
    const years = toArray(issues.year).map((year, index) => {
      if (typeof year === 'string' && year.length > 0) {
        return year;
      }
      if (typeof year === 'number' && Number.isFinite(year)) {
        return String(year);
      }
      throw new Error(
        `Issues year list > year[${index}]: expected a year string (${url})`,
      );
    });
    if (years.length === 0) {
      throw new Error(`Issues year list: no <year> elements (${url})`);
    }
    return { totalIssues, years };
  }

  async issuesForYear(
    periodicalArk: string,
    year: string,
  ): Promise<GallicaIssueRef[]> {
    const root = periodicalRoot(periodicalArk);
    const url = `${BASE}/services/Issues?ark=${root}/date&date=${year}`;
    const xml = await this.http.getText(url);
    const doc = this.parse(xml, url);
    const issues = childRecord(doc, 'issues', `Issues ${year}`);
    const rawIssues = toArray(issues.issue);
    if (rawIssues.length === 0) {
      throw new Error(`Issues ${year}: no <issue> elements (${url})`);
    }
    return rawIssues.map((raw, index) => {
      const record = requireRecord(raw, `Issues ${year} > issue[${index}]`);
      return {
        ark: childString(record, '@_ark', `Issues ${year} > issue[${index}]`),
        label: childString(
          record,
          '#text',
          `Issues ${year} > issue[${index}]`,
        ),
      };
    });
  }

  async issues(periodicalArk: string): Promise<IssuesEnumeration> {
    const { totalIssues, years } = await this.years(periodicalArk);
    const all: GallicaIssueRef[] = [];
    for (const year of years) {
      const yearIssues = await this.issuesForYear(periodicalArk, year);
      all.push(...yearIssues);
    }
    return { totalIssues, years, issues: all };
  }

  async pagination(issueArk: string): Promise<number> {
    const root = issueRoot(issueArk);
    const url = `${BASE}/services/Pagination?ark=${root}`;
    const xml = await this.http.getText(url);
    const doc = this.parse(xml, url);
    const livre = childRecord(doc, 'livre', 'Pagination');
    const structure = childRecord(livre, 'structure', 'Pagination');
    return childNumber(structure, 'nbVueImages', 'Pagination');
  }

  async oaiRecord(issueArk: string): Promise<string> {
    const root = issueRoot(issueArk);
    const url = `${BASE}/services/OAIRecord?ark=${root}`;
    const xml = await this.http.getText(url);
    if (xml.trim().length === 0) {
      throw new Error(`OAIRecord: empty response body from ${url}`);
    }
    return xml;
  }

  async oaiRights(issueArk: string): Promise<OaiRecordRights> {
    const root = issueRoot(issueArk);
    const url = `${BASE}/services/OAIRecord?ark=${root}`;
    const rawResponse = await this.oaiRecord(issueArk);
    const doc = this.parse(rawResponse, url);
    return { rawResponse, dcRights: extractDcRights(doc, url) };
  }

  async iiifInfo(issueArk: string, page: number): Promise<IiifInfo> {
    const root = issueRoot(issueArk);
    const n = requirePage(page, issueArk);
    const url = `${BASE}/iiif/ark:/12148/${root}/f${n}/info.json`;
    const body = await this.http.getText(url);
    if (body.trim().length === 0) {
      throw new Error(`IIIF info.json: empty response body from ${url}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`IIIF info.json: malformed JSON from ${url}: ${message}`);
    }
    const record = requireRecord(parsed, `IIIF info.json from ${url}`);
    return {
      width: childNumber(record, 'width', `IIIF info.json from ${url}`),
      height: childNumber(record, 'height', `IIIF info.json from ${url}`),
    };
  }

  async issueDate(issueArk: string): Promise<string> {
    const root = issueRoot(issueArk);
    const url = `${BASE}/services/OAIRecord?ark=${root}`;
    const rawResponse = await this.oaiRecord(issueArk);
    const doc = this.parse(rawResponse, url);
    return extractDcDate(doc, url);
  }

  async iiifImage(issueArk: string, page: number): Promise<Uint8Array> {
    const url = iiifImageUrl(issueArk, page);
    const bytes = await this.http.getBytes(url);
    if (bytes.byteLength === 0) {
      throw new Error(`IIIF image: empty response body from ${url}`);
    }
    return bytes;
  }

  /** Parse XML into a record, failing loud on empty/malformed payloads. */
  private parse(xml: string, url: string): Record<string, unknown> {
    if (xml.trim().length === 0) {
      throw new Error(`GallicaClient: empty response body from ${url}`);
    }
    let parsed: unknown;
    try {
      parsed = this.parser.parse(xml);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`GallicaClient: malformed XML from ${url}: ${message}`);
    }
    return requireRecord(parsed, `GallicaClient response from ${url}`);
  }
}
