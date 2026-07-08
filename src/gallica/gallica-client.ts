import { XMLParser } from 'fast-xml-parser';
import type { HttpClient } from '@/gallica/http-client';
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
  return root;
}

/** Reduce an issue ark to its bare identifier (drops `ark:/12148/`). */
function issueRoot(issueArk: string): string {
  const root = issueArk.trim().replace(/^ark:\/12148\//, '');
  if (root.length === 0) {
    throw new Error(`GallicaClient: empty issue ark from "${issueArk}"`);
  }
  return root;
}

/**
 * Live Gallica client: builds the documented service URLs, fetches through the
 * injected {@link HttpClient} (which owns User-Agent, pacing, and backoff), and
 * parses the XML with `fast-xml-parser`. Malformed/empty payloads throw.
 *
 * No inheritance: the HttpClient is injected via the constructor.
 */
export class GallicaHttpClient implements GallicaClient {
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
