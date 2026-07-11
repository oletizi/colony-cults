/**
 * Resolves a source's on-disk newspapers directory and enumerates its issue
 * directories into ordered scaffolds (issueId / date / ark).
 *
 * The archive stores a periodical's issues under a fixed layout:
 *
 *   <archiveRoot>/archive/cases/<case>/newspapers/<slug>/<date>_<ark>/
 *
 * `<case>` comes from the SSOT (`Source.case`); `<slug>` is derived from the
 * SSOT Gallica repository record's `census:` pointer basename
 * (`data/census/PB-P001-la-nouvelle-france.json` -> `la-nouvelle-france`).
 * Enumeration then SCANS that directory: the set of issue directories present
 * on disk is the authoritative source->issues mapping (the census enumerates
 * the full intended set, but only collected issues are on disk). Fail-loud:
 * an unresolvable mapping or an empty newspapers directory throws
 * (corpus-loader G-4/G-6).
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { LoadedSource } from '@/bibliography/load';

/** The holding-archive label whose record carries the Gallica census pointer. */
const GALLICA_ARCHIVE_LABEL = 'Gallica / BnF';

/** ARK naming authority for Gallica issue arks (`ark:/12148/<id>`). */
const ARK_AUTHORITY = 'ark:/12148';

/** `<date>_<ark>` issue directory name, e.g. `1879-08-15_bpt6k56068358`. */
const ISSUE_DIR_PATTERN = /^(\d{4}-\d{2}-\d{2})_([A-Za-z0-9]+)$/;

/** One issue directory, scaffolded from its directory name. */
export interface IssueDir {
  /** Stable slug = the directory name (e.g. `1879-08-15_bpt6k56068358`). */
  issueId: string;
  /** Absolute path to the issue directory. */
  dir: string;
  /** ISO date parsed from the directory name (e.g. `1879-08-15`). */
  date: string;
  /** Issue-level ARK (e.g. `ark:/12148/bpt6k56068358`) for image resolution + provenance. */
  ark: string;
}

/**
 * Resolves the absolute newspapers directory for `loaded`'s source under
 * `archiveRoot`.
 *
 * @throws Error if the source has no `case`, no Gallica repository record, no
 *   `census:` pointer, or the resolved directory does not exist.
 */
export function resolveNewspapersDir(archiveRoot: string, loaded: LoadedSource): string {
  const { source, records } = loaded;
  const sourceId = source.sourceId;

  const sourceCase = source.case?.trim();
  if (!sourceCase) {
    throw new Error(
      `loadCorpus(${sourceId}): SSOT has no "case" -- cannot resolve the archive newspapers directory.`
    );
  }

  const gallicaRecord = records.find((r) => r.sourceArchive === GALLICA_ARCHIVE_LABEL);
  if (gallicaRecord === undefined) {
    throw new Error(
      `loadCorpus(${sourceId}): SSOT has no "${GALLICA_ARCHIVE_LABEL}" repository record -- ` +
        'cannot resolve the source->issues mapping.'
    );
  }

  const slug = deriveSlug(gallicaRecord.census, sourceId);
  const newspapersDir = path.join(
    archiveRoot,
    'archive',
    'cases',
    sourceCase,
    'newspapers',
    slug
  );

  if (!existsSync(newspapersDir)) {
    throw new Error(
      `loadCorpus(${sourceId}): newspapers directory does not exist: ${newspapersDir}. ` +
        'Verify CORPUS_ARCHIVE_PATH points to a clone containing this source.'
    );
  }

  return newspapersDir;
}

/**
 * Derives the newspaper slug from the Gallica record's `census:` pointer.
 * The census basename is `<sourceId>-<slug>.json`.
 *
 * @throws Error if `census` is absent or its basename is not
 *   `<sourceId>-<slug>.json`.
 */
function deriveSlug(census: string | undefined, sourceId: string): string {
  const censusPath = census?.trim();
  if (!censusPath) {
    throw new Error(
      `loadCorpus(${sourceId}): Gallica repository record has no "census" pointer -- ` +
        'cannot derive the newspapers directory slug.'
    );
  }

  const base = path.basename(censusPath, '.json');
  const prefix = `${sourceId}-`;
  if (!base.startsWith(prefix) || base.length === prefix.length) {
    throw new Error(
      `loadCorpus(${sourceId}): census pointer basename ${JSON.stringify(base)} ` +
        `does not match the expected "${sourceId}-<slug>.json" shape.`
    );
  }

  return base.slice(prefix.length);
}

/**
 * Scans `newspapersDir` for issue directories and returns them ordered by
 * date, then ark (deterministic -- corpus-loader G-6).
 *
 * @throws Error if no issue directory is found (the source->issues mapping
 *   resolved to an empty set).
 */
export function enumerateIssueDirs(newspapersDir: string, sourceId: string): IssueDir[] {
  const entries = readdirSync(newspapersDir);
  const issues: IssueDir[] = [];

  for (const name of entries) {
    const match = ISSUE_DIR_PATTERN.exec(name);
    if (match === null) {
      continue;
    }
    const dir = path.join(newspapersDir, name);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    issues.push({
      issueId: name,
      dir,
      date: match[1],
      ark: `${ARK_AUTHORITY}/${match[2]}`,
    });
  }

  if (issues.length === 0) {
    throw new Error(
      `loadCorpus(${sourceId}): no issue directories found under ${newspapersDir}. ` +
        'Expected directories named "<date>_<ark>" (e.g. 1879-08-15_bpt6k56068358).'
    );
  }

  issues.sort((a, b) => (a.date === b.date ? a.ark.localeCompare(b.ark) : a.date.localeCompare(b.date)));
  return issues;
}
