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
 */
export function generateSourcesCsv(model: CanonicalModel): string {
  const rows = sortedSources(model).map((source) => [
    source.sourceId,
    source.case ?? '',
    canonicalTitle(source),
    source.creator ?? '',
    '', // year -- folded into notes by migrate; not a discrete SSOT field
    '', // type -- not a discrete SSOT field
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

/**
 * `bibliography/acquisition-tracker.csv` -- one row per Source.
 * `vendor_or_archive` joins the Source's `repositoryRecords[].sourceArchive`
 * (the one column research R-006 / the task spec calls out explicitly as
 * SSOT-derivable). `priority`/`next_action`/`url_or_reference` have no
 * discrete SSOT field (`migrate.ts` dropped them) and are emitted empty --
 * not fabricated.
 */
export function generateAcquisitionTrackerCsv(model: CanonicalModel): string {
  const rows = sortedSources(model).map((source) => {
    const records = recordsForSource(model, source.sourceId);
    return [
      source.sourceId,
      canonicalTitle(source),
      '', // priority -- not a discrete SSOT field
      joinedStatus(records),
      '', // next_action -- not a discrete SSOT field
      joinedArchives(records),
      '', // url_or_reference -- not a discrete SSOT field
      source.notes ?? '',
    ];
  });
  return renderCsv(TRACKER_CSV_HEADER, rows);
}

const REGISTER_CSV_HEADER = [
  'id',
  'title',
  'type',
  'rights_status',
  'mirror_status',
  'source_archive',
  'source_url',
  'local_path',
  'notes',
] as const;

/**
 * The archive-side `acquisition-register.csv` -- ONE ROW PER Repository
 * Record (not per Source), so a multi-copy Source (e.g. PB-P001) emits one
 * row per held copy -- this is the register that preserved the SLQ copy
 * (SC-005). `type` and per-copy `notes` have no discrete SSOT field and are
 * emitted empty. `local_path` prefers the derived manifest's `localPath`,
 * falling back to the object-store `key` (which mirrors the archive-relative
 * path, per `@/archive/provenance`'s `ObjectStoreLocation` doc comment).
 */
export function generateAcquisitionRegisterCsv(model: CanonicalModel): string {
  const sourceById = new Map(model.sources.map((source) => [source.sourceId, source]));
  const records = model.repositoryRecords.slice().sort((a, b) => {
    if (a.sourceId !== b.sourceId) {
      return a.sourceId < b.sourceId ? -1 : 1;
    }
    return a.sourceArchive < b.sourceArchive ? -1 : a.sourceArchive > b.sourceArchive ? 1 : 0;
  });
  const rows = records.map((record) => {
    const source = sourceById.get(record.sourceId);
    if (source === undefined) {
      throw new Error(
        `generateAcquisitionRegisterCsv: repository record references unknown sourceId "${record.sourceId}"`,
      );
    }
    return [
      record.sourceId,
      canonicalTitle(source),
      '', // type -- not a discrete SSOT field
      record.rights?.status ?? '',
      record.status,
      record.sourceArchive,
      record.catalogUrl ?? record.originalUrl ?? '',
      record.manifest?.localPath ?? record.manifest?.objectStore?.key ?? '',
      '', // notes -- per-copy notes are not modeled (Source.notes is work-level)
    ];
  });
  return renderCsv(REGISTER_CSV_HEADER, rows);
}

/** Fixed emission order of a source stub's fields (a subset of the shape used by the pre-SSOT archive stub -- see `regenerate.ts` module doc). */
const STUB_KEY_ORDER = [
  'id',
  'title',
  'case',
  'language',
  'source_archive',
  'catalog_url',
  'rights_status',
  'mirror_status',
  'retrieved',
  'local_path',
  'notes',
] as const;

type StubKey = (typeof STUB_KEY_ORDER)[number];

/** A single-line, always-double-quoted YAML scalar -- same discipline as `@/archive/provenance`'s `quotedScalar`. */
function quotedScalar(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** A YAML literal block scalar (`|2`), two-space-indented -- same discipline as `@/archive/provenance`'s `blockScalar`. */
function blockScalar(key: string, text: string): string {
  const body = text
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `  ${line}`))
    .join('\n');
  return `${key}: |2\n${body}`;
}

/** Emit one stub field: `key: null` when absent, a block scalar for multi-line text, else a quoted scalar. */
function emitStubField(key: StubKey, value: string | undefined): string {
  if (value === undefined) {
    return `${key}: null`;
  }
  return value.includes('\n') ? blockScalar(key, value) : `${key}: ${quotedScalar(value)}`;
}

/**
 * A `PB-P00X.yml` archive metadata stub for ONE Source -- the fields the
 * canonical model actually holds, in the archive stub's field order. When a
 * Source has more than one Repository Record (e.g. PB-P001's Gallica + SLQ
 * copies), the record whose `sourceArchive` sorts first is the stub's
 * "primary" copy (per-record enumeration is the register's job, not the
 * stub's -- see `generateAcquisitionRegisterCsv`). Fields with no SSOT value
 * are emitted `null`, never fabricated (the legacy stub's `date_range` /
 * `checksum_manifest` / `next_actions` have no SSOT equivalent -- the first
 * two are dropped rather than reintroducing the single-checksum
 * representation FR-006 retires; the third is free-form planning text with
 * no model field).
 */
export function generateSourceStub(model: CanonicalModel, sourceId: string): string {
  const source = model.sources.find((candidate) => candidate.sourceId === sourceId);
  if (source === undefined) {
    throw new Error(`generateSourceStub: unknown sourceId "${sourceId}"`);
  }
  const primary = recordsForSource(model, sourceId)[0];

  const fields: Record<StubKey, string | undefined> = {
    id: source.sourceId,
    title: canonicalTitle(source),
    case: source.case,
    language: source.language,
    source_archive: primary?.sourceArchive,
    catalog_url: primary?.catalogUrl,
    rights_status: primary?.rights?.status,
    mirror_status: primary !== undefined && primary.status.length > 0 ? primary.status : undefined,
    retrieved: primary?.retrievedAt,
    local_path: primary?.manifest?.localPath ?? primary?.manifest?.objectStore?.key,
    notes: source.notes,
  };

  const body = STUB_KEY_ORDER.map((key) => emitStubField(key, fields[key])).join('\n');
  return `${body}\n`;
}

/** A Source that carries a `case` (needed to place its stub under `archive/cases/<case>/metadata/`). */
function hasCase(source: Source): source is Source & { case: string } {
  return source.case !== undefined;
}

/** One enumerated stub: its archive-relative path + generated content. */
export interface SourceStubView {
  sourceId: string;
  relativePath: string;
  content: string;
}

/**
 * Enumerate a `PB-P00X.yml` stub for every Source that carries a `case`
 * (needed for the path). A Source with no `case` is skipped -- not an error,
 * just a Source that cannot be placed under `archive/cases/<case>/metadata/`
 * (none of the current corpus hits this; callers may report the skip).
 */
export function enumerateSourceStubs(model: CanonicalModel): SourceStubView[] {
  return model.sources
    .filter(hasCase)
    .slice()
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1))
    .map((source) => ({
      sourceId: source.sourceId,
      relativePath: `archive/cases/${source.case}/metadata/${source.sourceId}.yml`,
      content: generateSourceStub(model, source.sourceId),
    }));
}

/** One materialized view: which root it resolves against, its relative path, and its generated content. */
export interface ViewInstance {
  id: string;
  /** `'public'` resolves against the repo root; `'archive'` resolves against the archive root. */
  kind: 'public' | 'archive';
  relativePath: string;
  content: string;
}

/**
 * The single `case` shared by every Source that has at least one Repository
 * Record -- the archive register's path is `archive/cases/<case>/metadata/
 * acquisition-register.csv`, and today's corpus has exactly one case
 * (`port-breton`). Throws (fail loud) rather than guessing when zero or more
 * than one case is present; multi-case archive-register generation is out of
 * scope for this generator (YAGNI -- no multi-case corpus exists yet).
 */
function resolveRegisterCase(model: CanonicalModel): string {
  const sourceById = new Map(model.sources.map((source) => [source.sourceId, source]));
  const cases = new Set<string>();
  for (const record of model.repositoryRecords) {
    const source = sourceById.get(record.sourceId);
    if (source?.case !== undefined) {
      cases.add(source.case);
    }
  }
  if (cases.size !== 1) {
    throw new Error(
      `resolveRegisterCase: expected exactly one distinct case among sources with ` +
        `repository records, got ${cases.size} (${[...cases].sort().join(', ')}) -- ` +
        `multi-case archive register generation is not supported`,
    );
  }
  return [...cases][0];
}

/**
 * Build every view this model produces: the two PUBLIC CSVs (always
 * present), the ARCHIVE register (present when the model has at least one
 * Repository Record), and one ARCHIVE stub per `case`-bearing Source. The
 * caller (`bib regenerate` / `validateViewDrift`) decides which root each
 * `kind` resolves against and whether archive views are reachable at all
 * (the archive clone may not exist on disk).
 */
export function buildViewRegistry(model: CanonicalModel): ViewInstance[] {
  const views: ViewInstance[] = [
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
  if (model.repositoryRecords.length > 0) {
    const registerCase = resolveRegisterCase(model);
    views.push({
      id: 'acquisition-register-csv',
      kind: 'archive',
      relativePath: `archive/cases/${registerCase}/metadata/acquisition-register.csv`,
      content: generateAcquisitionRegisterCsv(model),
    });
  }
  for (const stub of enumerateSourceStubs(model)) {
    views.push({
      id: `source-stub-${stub.sourceId}`,
      kind: 'archive',
      relativePath: stub.relativePath,
      content: stub.content,
    });
  }
  return views;
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
