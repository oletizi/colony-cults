/**
 * Resolves a MONOGRAPH source's single on-disk unit -- its book directory --
 * into one {@link IssueDir} (the same scaffold a periodical issue produces, so
 * every downstream step reuses unchanged).
 *
 * A monograph's on-disk layout is IDENTICAL to a single periodical issue:
 *
 *   <archiveRoot>/archive/cases/<case>/books/<slug>/
 *     issue.txt                 -- form-feed OCR (one segment per folio)
 *     translation/pNNN.{fr,en}.txt (+ .yml sidecars)
 *     fNNN.yml                  -- per-folio image sidecars
 *
 * Unlike a periodical (whose `newspapers/<slug>` directory is derived from the
 * SSOT Gallica `census:` pointer), a monograph's SSOT is minimal: it carries
 * NO census pointer and NO slug. So the book directory is resolved by SCANNING
 * each subdirectory of `books/`, reading a folio sidecar (`fNNN.yml`) in each, and matching its
 * `id:` field to the source id -- each folio sidecar of the source's book
 * carries `id: "<sourceId>"`. Fail-loud: no `books/` directory, or no book
 * whose sidecar id matches, throws naming the source.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { LoadedSource } from '@/bibliography/load';
import type { IssueDir } from '@/browser/load/issues';

/** `fNNN.yml` per-folio image sidecar name. */
const FOLIO_SIDECAR_PATTERN = /^f(\d+)\.yml$/;

/**
 * Extracts a four-digit publication year from a Gallica OAI `rights_raw` XML
 * blob (`<dc:date>1879</dc:date>` or `<date ...>1879</date>`). A targeted
 * match, not a full XML parse -- the sidecar carries the record verbatim.
 */
const DC_DATE_PATTERN = /<(?:dc:)?date\b[^>]*>\s*(\d{4})\s*<\/(?:dc:)?date>/;

/** The fields a folio sidecar must carry for monograph unit resolution. */
interface FolioSidecar {
  /** The source id this folio belongs to (e.g. `PB-P002`). */
  id: string;
  /** The Gallica catalog URL the book/issue ark is parsed from. */
  catalogUrl: string;
  /** The verbatim Gallica OAI record XML (carries the publication `<dc:date>`), when present. */
  rightsRaw: string | null;
  /** The ISO retrieval timestamp (e.g. `2026-07-09T06:08:07.842Z`), when present. */
  retrieved: string | null;
}

/**
 * Resolves the single book-directory unit for `loaded`'s monograph source
 * under `archiveRoot`, returning it as one {@link IssueDir}:
 *
 *  - `issueId` = the book directory basename (the slug),
 *  - `dir`     = the absolute book directory path,
 *  - `ark`     = the book/issue ark parsed from the matched folio sidecar's
 *    `catalog_url` (the same derivation the periodical loader uses, so the
 *    per-page provenance ark -- also parsed from the sidecar `catalog_url` --
 *    agrees),
 *  - `date`    = the book's date (see {@link deriveBookDate}),
 *  - `sequence` = 1 (a monograph has exactly one unit).
 *
 * @throws Error naming the source if it has no `case`, no `books/` directory,
 *   or no book directory whose folio sidecar `id` matches the source id.
 */
export function resolveMonographUnit(archiveRoot: string, loaded: LoadedSource): IssueDir {
  const { source } = loaded;
  const sourceId = source.sourceId;

  const sourceCase = source.case?.trim();
  if (!sourceCase) {
    throw new Error(
      `loadCorpus(${sourceId}): SSOT has no "case" -- cannot resolve the archive books directory.`
    );
  }

  const booksDir = path.join(archiveRoot, 'archive', 'cases', sourceCase, 'books');
  if (!existsSync(booksDir)) {
    throw new Error(
      `loadCorpus(${sourceId}): books directory does not exist: ${booksDir}. ` +
        'Verify CORPUS_ARCHIVE_PATH points to a clone containing this monograph.'
    );
  }

  // SCAN each book subdirectory, matching its folio-sidecar id to the source id.
  // Deterministic: entries are sorted so the same clone always resolves the
  // same book directory.
  for (const name of readdirSync(booksDir).sort()) {
    const dir = path.join(booksDir, name);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    const sidecar = readFolioSidecar(dir);
    if (sidecar === null || sidecar.id !== sourceId) {
      continue;
    }

    return {
      issueId: name,
      dir,
      date: deriveBookDate(source.notes, sidecar),
      ark: parseArkFromCatalogUrl(sidecar.catalogUrl, dir),
    };
  }

  throw new Error(
    `loadCorpus(${sourceId}): no book directory under ${booksDir} has a folio sidecar ` +
      `whose "id" matches ${JSON.stringify(sourceId)}. ` +
      'A monograph unit is the books/<slug>/ directory whose fNNN.yml sidecars carry id: "<sourceId>".'
  );
}

/**
 * Reads the first (lowest-numbered) `fNNN.yml` folio sidecar in `bookDir` and
 * extracts the fields monograph resolution needs, or `null` when the directory
 * has no folio sidecar or the sidecar does not parse to a mapping with a
 * usable `id`. A book directory without a readable folio sidecar simply is not
 * a match candidate (it is skipped, not thrown on) -- the fail-loud "no match"
 * throw fires in {@link resolveMonographUnit} once every candidate is scanned.
 */
function readFolioSidecar(bookDir: string): FolioSidecar | null {
  const folioNames = readdirSync(bookDir)
    .filter((name) => FOLIO_SIDECAR_PATTERN.test(name))
    .sort();
  if (folioNames.length === 0) {
    return null;
  }

  const parsed: unknown = parseYaml(readFileSync(path.join(bookDir, folioNames[0]), 'utf-8'));
  if (!isRecord(parsed)) {
    return null;
  }

  const id = parsed.id;
  const catalogUrl = parsed.catalog_url;
  if (typeof id !== 'string' || id.trim().length === 0) {
    return null;
  }
  if (typeof catalogUrl !== 'string' || catalogUrl.trim().length === 0) {
    return null;
  }

  return {
    id,
    catalogUrl,
    rightsRaw: typeof parsed.rights_raw === 'string' ? parsed.rights_raw : null,
    retrieved: typeof parsed.retrieved === 'string' ? parsed.retrieved : null,
  };
}

/**
 * Derives the book's single ISO date, in a documented order of preference
 * (each candidate is REAL data -- this is a derivation preference, not a
 * placeholder fallback):
 *
 *  1. the SSOT `notes` "Years: YYYY" hint (the only structured-ish date the
 *     minimal monograph SSOT carries), when present;
 *  2. else the publication year from the folio sidecar's Gallica catalog
 *     metadata (`rights_raw` `<dc:date>YYYY</dc:date>`);
 *  3. else the folio sidecar's `retrieved` timestamp (its date portion) -- the
 *     acquisition date, a last resort when no publication date is recorded.
 *
 * @throws Error if none of the three yields a date (the book has no derivable
 *   date at all -- fail loud rather than invent one).
 */
function deriveBookDate(notes: string | undefined, sidecar: FolioSidecar): string {
  const ssotYear = notes?.match(/\bYears?:\s*(\d{4})/i);
  if (ssotYear !== null && ssotYear !== undefined) {
    return ssotYear[1];
  }

  if (sidecar.rightsRaw !== null) {
    const dcDate = sidecar.rightsRaw.match(DC_DATE_PATTERN);
    if (dcDate !== null) {
      return dcDate[1];
    }
  }

  if (sidecar.retrieved !== null) {
    const isoDate = sidecar.retrieved.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate !== null) {
      return isoDate[1];
    }
  }

  throw new Error(
    `loadCorpus(${sidecar.id}): cannot derive the book's date -- no "Years:" note in the SSOT, ` +
      'no <dc:date> in the folio sidecar catalog metadata, and no parseable "retrieved" timestamp.'
  );
}

/**
 * Parses the book/issue ark from a Gallica `catalog_url`
 * (`https://gallica.bnf.fr/ark:/12148/bpt6k58039518` -> `ark:/12148/bpt6k58039518`).
 * The SAME derivation the per-page provenance uses (see
 * `@/browser/load/translation`), so the resolved unit ark and the page
 * provenance ark agree.
 *
 * @throws Error if `catalogUrl` contains no parseable ark.
 */
function parseArkFromCatalogUrl(catalogUrl: string, bookDir: string): string {
  const match = catalogUrl.match(/ark:\/\S+/);
  if (match === null) {
    throw new Error(
      `loadCorpus: folio sidecar in ${bookDir} has a "catalog_url" ` +
        `(${JSON.stringify(catalogUrl)}) with no parseable ark.`
    );
  }
  return match[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
