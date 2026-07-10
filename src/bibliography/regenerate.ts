import { existsSync, readFileSync } from 'node:fs';

import type { CanonicalModel } from '@/bibliography/model';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/**
 * PURE view generators for the legacy representations US1 folded into the
 * SSOT (`bibliography/sources/PB-###.yml`). Each generator is
 * `(model: CanonicalModel) => string` and returns the EXACT file contents in
 * a fixed, deterministic field/column order -- calling a generator twice on
 * an unchanged model yields byte-identical output (FR-015/SC-008/SC-015).
 *
 * These generators are the SINGLE source of truth for view content: `bib
 * regenerate` writes them (`@/cli/bibliography.ts`) and `bib validate`'s
 * `view-drift` check (`@/bibliography/validate.ts`) diffs them against the
 * committed files. Neither the model nor these generators ever read back a
 * view's own prior content -- there is no fallback/reconstruction path; a
 * field the SSOT does not hold is emitted empty/`null`, never fabricated.
 *
 * See specs/004-canonical-source-metadata/research.md R-006 and
 * contracts/cli.md / contracts/source-record.md §Serialization.
 */

/** Quote a CSV cell per RFC-4180: only when it contains a comma, quote, or newline; `"` escapes as `""`. */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Join cells into one CSV record (no trailing newline). */
function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/** Render a header + data rows as CSV text, one trailing `\n` per line, including the last. */
function renderCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [csvRow(header), ...rows.map(csvRow)].map((line) => `${line}\n`).join('');
}

/**
 * A Source's canonical title, or its first title when none is marked
 * `role: 'canonical'` -- mirrors `bib show`'s treatment (no title is
 * authoritative per FR-003, but a view needs exactly one display string).
 * Throws (fail loud) for a Source with zero titles, which `load.ts` rule 2
 * never actually produces -- defensive, not reachable via the loader.
 */
function canonicalTitle(source: Source): string {
  if (source.titles.length === 0) {
    throw new Error(`canonicalTitle: Source "${source.sourceId}" has no titles`);
  }
  const canonical = source.titles.find((title) => title.role === 'canonical');
  return (canonical ?? source.titles[0]).text;
}

/** Sources sorted by `sourceId`, for deterministic row order regardless of the model's own array order. */
function sortedSources(model: CanonicalModel): Source[] {
  return model.sources.slice().sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1));
}

/** A Source's Repository Records, sorted by `sourceArchive`. */
function recordsForSource(model: CanonicalModel, sourceId: string): RepositoryRecord[] {
  return model.repositoryRecords
    .filter((record) => record.sourceId === sourceId)
    .slice()
    .sort((a, b) => (a.sourceArchive < b.sourceArchive ? -1 : a.sourceArchive > b.sourceArchive ? 1 : 0));
}

const SOURCES_CSV_HEADER = [
  'id',
  'case',
  'title',
  'creator',
  'year',
  'type',
  'language',
  'status',
  'access',
  'public_domain',
  'notes',
] as const;

/**
 * `bibliography/sources.csv` -- one row per Source, in the ORIGINAL legacy
 * column order (preserved for continuity even though several columns no
 * longer have a discrete SSOT field). `migrate.ts` folded `year`/`access`/
 * `public_domain` into `Source.notes` (see `buildNotes`) and dropped `type`
 * entirely; there is no per-Source `status` any more (acquisition status now
 * lives per-copy on `repositoryRecords[].status`). Per house rule (no
 * fallbacks/fabrication), those columns are emitted EMPTY rather than
 * reconstructed by parsing `notes` back apart.
 *
 * A `kind: 'source-group'` Source (specs/005-source-groups/research.md R-002)
 * gets a row here like any other Source -- it IS a catalogued Source, just
 * one with no repository records. None of this view's columns derive from
 * `repositoryRecords`, so a group's row is naturally well-formed with no
 * special-casing: `type` reflects `kind` directly (`source-group`), and the
 * acquisition-shaped columns (`status`/`access`/`public_domain`) are already
 * always empty for every Source, group or not.
 */
export function generateSourcesCsv(model: CanonicalModel): string {
  const rows = sortedSources(model).map((source) => [
    source.sourceId,
    source.case ?? '',
    canonicalTitle(source),
    source.creator ?? '',
    '', // year -- folded into notes by migrate; not a discrete SSOT field
    source.kind, // type <- SSOT kind (periodical/monograph); keeps migrate re-runnable
    source.language ?? '',
    '', // status -- now per-copy (repositoryRecords[].status), not per-Source
    '', // access -- folded into notes by migrate
    '', // public_domain -- folded into notes by migrate
    source.notes ?? '',
  ]);
  return renderCsv(SOURCES_CSV_HEADER, rows);
}

const TRACKER_CSV_HEADER = [
  'id',
  'title',
  'priority',
  'status',
  'next_action',
  'vendor_or_archive',
  'url_or_reference',
  'notes',
] as const;

/** The distinct non-empty `status` values across a Source's records, sorted and `; `-joined (empty when none set). */
function joinedStatus(records: readonly RepositoryRecord[]): string {
  const distinct = [...new Set(records.map((record) => record.status).filter((status) => status.length > 0))].sort();
  return distinct.join('; ');
}

/** A Source's Repository Records' `sourceArchive` labels, ` / `-joined in sorted order (empty when there are none). */
function joinedArchives(records: readonly RepositoryRecord[]): string {
  return records.map((record) => record.sourceArchive).join(' / ');
}

/** A Source's work-level ISBN, if it carries one (empty when it does not). */
function isbnOf(source: Source): string {
  return source.identifiers.find((identifier) => identifier.type === 'isbn')?.value ?? '';
}

/**
 * `bibliography/acquisition-tracker.csv` -- one row per Source that is
 * actually acquirable. `vendor_or_archive` joins the Source's
 * `repositoryRecords[].sourceArchive` (the one column research R-006 / the
 * task spec calls out explicitly as SSOT-derivable). `priority`/`next_action`
 * have no discrete SSOT field (`migrate.ts` dropped them) and are emitted
 * empty -- not fabricated. `url_or_reference` round-trips a Source's
 * work-level `isbn` identifier when present (the only discrete SSOT value
 * that column carries today); it is empty for a Source with no ISBN.
 *
 * A `kind: 'source-group'` Source is EXCLUDED here (specs/005-source-groups/
 * research.md R-002): a group is a research-defined container, not
 * acquirable, and holds no repository records by construction (FR-004) -- it
 * has nothing to track. This is a row-level filter only; an ordinary
 * periodical/monograph with zero repository records (not yet acquired) still
 * gets a row here with empty acquisition columns, same as before.
 */
export function generateAcquisitionTrackerCsv(model: CanonicalModel): string {
  const rows = sortedSources(model)
    .filter((source) => source.kind !== 'source-group')
    .map((source) => {
      const records = recordsForSource(model, source.sourceId);
      return [
        source.sourceId,
        canonicalTitle(source),
        '', // priority -- not a discrete SSOT field
        joinedStatus(records),
        '', // next_action -- not a discrete SSOT field
        joinedArchives(records),
        isbnOf(source), // url_or_reference -- round-trips the work-level ISBN, else empty
        source.notes ?? '',
      ];
    });
  return renderCsv(TRACKER_CSV_HEADER, rows);
}

/** One materialized view: its relative path (resolved against the repo root) and its generated content. */
export interface ViewInstance {
  id: string;
  /** Every view this registry builds is `'public'` -- resolves against the repo root. */
  kind: 'public';
  relativePath: string;
  content: string;
}

/**
 * Build every view this model produces: the two PUBLIC CSVs
 * (`bibliography/sources.csv`, `bibliography/acquisition-tracker.csv`).
 *
 * The archive-side `acquisition-register.csv` + per-source `PB-P00X.yml`
 * stubs (under `<archiveRoot>/archive/cases/<case>/metadata/`) are NOT
 * views here, even though `migrate.ts` folds them INTO the SSOT as two of
 * its five source representations. They are curated migrate INPUT --
 * analogous to the frozen `bibliography/legacy/` CSVs `migrate.ts` also
 * reads -- not generated output this registry regenerates. Treating them as
 * generated views would mean diffing curated originals against a lossy
 * in-memory regeneration (the archive stub's `date_range`/`checksum_manifest`
 * /`next_actions` and the register's per-copy `notes`/`type` have no SSOT
 * field), which produces false-positive `view-drift` findings on files that
 * were never meant to round-trip. Treating them as read-only input is a
 * deliberate, documented deviation from FR-014's literal "generate every
 * folded representation" wording, in service of its actual intent -- one
 * SSOT, no drift -- without lossy cross-repo writes into a private archive
 * clone. `migrate.ts` (`readRegister`/`readStub`) still reads both as input;
 * this file no longer writes or diffs them.
 */
export function buildViewRegistry(model: CanonicalModel): ViewInstance[] {
  return [
    {
      id: 'sources-csv',
      kind: 'public',
      relativePath: 'bibliography/sources.csv',
      content: generateSourcesCsv(model),
    },
    {
      id: 'acquisition-tracker-csv',
      kind: 'public',
      relativePath: 'bibliography/acquisition-tracker.csv',
      content: generateAcquisitionTrackerCsv(model),
    },
  ];
}

/**
 * Read a committed view's current content, or `undefined` when it does not
 * exist yet -- a legitimate drift signal (an unwritten view differs from its
 * regeneration by definition), not a thrown error. Any OTHER read failure
 * (permissions, etc.) propagates.
 */
export function readViewIfExists(absPath: string): string | undefined {
  if (!existsSync(absPath)) {
    return undefined;
  }
  return readFileSync(absPath, 'utf-8');
}
