import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { parseCsv } from '@/bibliography/csv';
import { deriveModel, gatherCensusForAll, gatherProvenance } from '@/bibliography/derive';
import { loadAllSources } from '@/bibliography/load';
import type { LoadedSource } from '@/bibliography/load';
import type { AuthoredRepositoryRecord, CanonicalModel } from '@/bibliography/model';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { MigratedSource } from '@/bibliography/migrate-serialize';
import { resolveArchiveRoot } from '@/archive/location';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import type { CopyIdentifier } from '@/model/repository-record';
import type { Source } from '@/model/source';
import {
  ACTIVE_STATUSES,
  CANONICAL_GALLICA,
  MIRROR_STATUS,
  TRACKER_STATUS,
  canonicalizeArchive,
  detectKind,
  extractArk,
  extractSlqIds,
  mapStatus,
  nonEmpty,
  requireCell,
  safeSlug,
  splitArchives,
} from '@/bibliography/migrate-helpers';

/** Options for {@link migrate}. */
export interface MigrateOptions {
  /** Public repo root holding `bibliography/sources.csv` + `acquisition-tracker.csv`. */
  repoRoot: string;
  /** Private archive root; defaults via {@link resolveArchiveRoot}. */
  archiveRoot?: string;
  /** Persist the SSOT files to disk (default `true`). */
  write?: boolean;
}

/** Result of a migration run. */
export interface MigrateResult {
  /** Absolute paths of the SSOT files written (empty when `write` is `false`). */
  written: string[];
  /** The rebuilt canonical model. */
  model: CanonicalModel;
}

/** A mutable per-archive accumulator during the join. */
interface RecordBuilder {
  sourceArchive: string;
  status?: string;
  catalogUrl?: string;
  identifiers: CopyIdentifier[];
  census?: string;
}

function getBuilder(builders: Map<string, RecordBuilder>, archive: string): RecordBuilder {
  const existing = builders.get(archive);
  if (existing !== undefined) {
    return existing;
  }
  const created: RecordBuilder = { sourceArchive: archive, identifiers: [] };
  builders.set(archive, created);
  return created;
}

/** Fold a parsed stub YAML object's Gallica/mirror fields into a builder. */
function foldStub(
  builders: Map<string, RecordBuilder>,
  stub: Record<string, unknown>,
): void {
  const archiveRaw = stub.source_archive;
  if (typeof archiveRaw !== 'string' || archiveRaw.trim().length === 0) {
    return;
  }
  const builder = getBuilder(builders, canonicalizeArchive(archiveRaw));
  const mirror = stub.mirror_status;
  if (builder.status === undefined && typeof mirror === 'string' && mirror.trim().length > 0) {
    builder.status = mapStatus(MIRROR_STATUS, mirror, 'stub mirror');
  }
  const catalog = stub.catalog_url;
  if (builder.catalogUrl === undefined && typeof catalog === 'string' && catalog.trim().length > 0) {
    builder.catalogUrl = catalog.trim();
    const ark = extractArk(catalog);
    if (ark !== undefined && !builder.identifiers.some((id) => id.type === 'ark')) {
      builder.identifiers.push({ type: 'ark', value: ark });
    }
  }
}

/** Fold an archive register row's acquisition fields into a builder. */
function foldRegister(
  builders: Map<string, RecordBuilder>,
  register: Record<string, string>,
): void {
  const archive = nonEmpty(register.source_archive);
  if (archive === undefined) {
    return;
  }
  const builder = getBuilder(builders, canonicalizeArchive(archive));
  const mirror = nonEmpty(register.mirror_status);
  if (builder.status === undefined && mirror !== undefined) {
    builder.status = mapStatus(MIRROR_STATUS, mirror, 'register mirror');
  }
  const sourceUrl = nonEmpty(register.source_url);
  if (builder.catalogUrl === undefined && sourceUrl !== undefined) {
    builder.catalogUrl = sourceUrl;
  }
}

/** Fold the tracker's combined vendor label + status into the builders. */
function foldTracker(
  builders: Map<string, RecordBuilder>,
  tracker: Record<string, string>,
): void {
  const vendor = nonEmpty(tracker.vendor_or_archive);
  if (vendor === undefined) {
    return;
  }
  const status = mapStatus(TRACKER_STATUS, requireCell(tracker, 'status', 'tracker row'), 'tracker');
  const active = ACTIVE_STATUSES.has(status);
  for (const archive of splitArchives(vendor)) {
    // A tracker vendor only MANUFACTURES a record when acquisition is active
    // (collecting/collected/archived); a wanted/to-collect source with no
    // archive-side row stays record-free (the zero-records edge case). An
    // archive already established by the register/stub is always enriched.
    if (active || builders.has(archive)) {
      const builder = getBuilder(builders, archive);
      if (builder.status === undefined) {
        builder.status = status;
      }
    }
  }
}

/** True for a plain object (a YAML mapping), narrowing away null/array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a stub YAML file into a plain object, or `undefined` if unreadable. */
function readStub(archiveRoot: string, sourceCase: string, sourceId: string): Record<string, unknown> | undefined {
  const stubPath = path.join(
    archiveRoot,
    'archive',
    'cases',
    sourceCase,
    'metadata',
    `${sourceId}.yml`,
  );
  if (!existsSync(stubPath)) {
    return undefined;
  }
  const parsed: unknown = parseYaml(readFileSync(stubPath, 'utf-8'));
  if (!isRecord(parsed)) {
    throw new Error(`migrate: stub "${stubPath}" is not a YAML mapping`);
  }
  return parsed;
}

/** Index an archive case's `acquisition-register.csv` by source id (may be empty). */
function readRegister(archiveRoot: string, sourceCase: string): Map<string, Record<string, string>> {
  const registerPath = path.join(
    archiveRoot,
    'archive',
    'cases',
    sourceCase,
    'metadata',
    'acquisition-register.csv',
  );
  const index = new Map<string, Record<string, string>>();
  if (!existsSync(registerPath)) {
    return index;
  }
  for (const row of parseCsv(readFileSync(registerPath, 'utf-8')).rows) {
    const id = nonEmpty(row.id);
    if (id !== undefined) {
      index.set(id, row);
    }
  }
  return index;
}

/** Finalize a builder into an authored record, failing loud on a missing status. */
function toAuthoredRecord(sourceId: string, builder: RecordBuilder): AuthoredRepositoryRecord {
  if (builder.status === undefined) {
    throw new Error(
      `migrate: internal error -- record for (${sourceId}, ${builder.sourceArchive}) has no status`,
    );
  }
  const record: AuthoredRepositoryRecord = {
    sourceArchive: builder.sourceArchive,
    status: builder.status,
  };
  if (builder.catalogUrl !== undefined) {
    record.catalogUrl = builder.catalogUrl;
  }
  if (builder.identifiers.length > 0) {
    record.identifiers = builder.identifiers;
  }
  if (builder.census !== undefined) {
    record.census = builder.census;
  }
  return record;
}

/** Compose the Source `notes` from the sources.csv row + captured SLQ ids. */
function buildNotes(
  row: Record<string, string>,
  trackerRow: Record<string, string> | undefined,
): string | undefined {
  const parts: string[] = [];
  const year = nonEmpty(row.year);
  if (year !== undefined) {
    parts.push(`Years: ${year}`);
  }
  const access = nonEmpty(row.access);
  if (access !== undefined) {
    parts.push(`Access: ${access}`);
  }
  const publicDomain = nonEmpty(row.public_domain);
  if (publicDomain !== undefined) {
    parts.push(`Public domain: ${publicDomain}`);
  }
  const csvNotes = nonEmpty(row.notes);
  if (csvNotes !== undefined) {
    parts.push(csvNotes);
  }
  const slq = extractSlqIds(trackerRow === undefined ? undefined : nonEmpty(trackerRow.notes));
  if (slq !== undefined) {
    parts.push(slq);
  }
  return parts.length > 0 ? parts.join(' | ') : undefined;
}

/** Build one Source (spine) row + its joined repository records. */
function migrateSource(
  row: Record<string, string>,
  trackerRow: Record<string, string> | undefined,
  register: Map<string, Record<string, string>>,
  stub: Record<string, unknown> | undefined,
): MigratedSource {
  const sourceId = requireCell(row, 'id', 'sources.csv row');
  const kind = detectKind(requireCell(row, 'type', `sources.csv ${sourceId}`));

  const source: Source = {
    sourceId,
    titles: [{ text: requireCell(row, 'title', `sources.csv ${sourceId}`), role: 'canonical' }],
    kind,
    identifiers: [],
  };
  const creator = nonEmpty(row.creator);
  if (creator !== undefined) {
    source.creator = creator;
  }
  const language = nonEmpty(row.language);
  if (language !== undefined) {
    source.language = language;
  }
  const sourceCase = nonEmpty(row.case);
  if (sourceCase !== undefined) {
    source.case = sourceCase;
  }
  const notes = buildNotes(row, trackerRow);
  if (notes !== undefined) {
    source.notes = notes;
  }

  const builders = new Map<string, RecordBuilder>();
  if (stub !== undefined) {
    foldStub(builders, stub);
  }
  const registerRow = register.get(sourceId);
  if (registerRow !== undefined) {
    foldRegister(builders, registerRow);
  }
  if (trackerRow !== undefined) {
    foldTracker(builders, trackerRow);
  }

  // The census pointer lives on the Gallica copy for a periodical source.
  if (kind === 'periodical') {
    const slug = safeSlug(sourceId);
    const gallica = builders.get(CANONICAL_GALLICA);
    if (slug !== undefined && gallica !== undefined && gallica.census === undefined) {
      gallica.census = `data/census/${sourceId}-${slug}.json`;
    }
  }

  const records = [...builders.values()].map((builder) => toAuthoredRecord(sourceId, builder));
  return { source, records };
}

/** Gather a source's provenance, tolerating an unregistered (no-layout) source. */
async function safeGather(sourceId: string, archiveRoot: string): Promise<AssetProvenance[]> {
  if (safeSlug(sourceId) === undefined) {
    return [];
  }
  return gatherProvenance(sourceId, archiveRoot);
}

/**
 * Fold the five legacy representations into the canonical SSOT (T013):
 *
 *  1. `bibliography/sources.csv`            -- the Source spine (required).
 *  2. `bibliography/acquisition-tracker.csv`-- status / combined vendor / notes.
 *  3. archive `acquisition-register.csv`    -- per-archive acquisition fields.
 *  4. archive `PB-###.yml` stubs            -- Gallica catalog/mirror overrides.
 *  5. per-asset provenance YAML             -- the derived manifest roll-up.
 *
 * PB-P001 folds into TWO distinct Repository Records -- `Gallica / BnF` and the
 * RESTORED `State Library of Queensland` copy (SC-005). Serialization is
 * deterministic, so a re-run writes byte-identical files (idempotent).
 *
 * When `archiveRoot` does not exist, only the PUBLIC representations (1-2) are
 * folded and archive-side enrichment (3-5) is skipped -- an explicit branch,
 * logged, never a silent fallback.
 */
export async function migrate(opts: MigrateOptions): Promise<MigrateResult> {
  const write = opts.write ?? true;
  const sourcesPath = path.join(opts.repoRoot, 'bibliography', 'sources.csv');
  if (!existsSync(sourcesPath)) {
    throw new Error(`migrate: required spine "${sourcesPath}" does not exist`);
  }
  const sources = parseCsv(readFileSync(sourcesPath, 'utf-8')).rows;

  const trackerPath = path.join(opts.repoRoot, 'bibliography', 'acquisition-tracker.csv');
  const trackerIndex = new Map<string, Record<string, string>>();
  if (existsSync(trackerPath)) {
    for (const row of parseCsv(readFileSync(trackerPath, 'utf-8')).rows) {
      const id = nonEmpty(row.id);
      if (id !== undefined) {
        trackerIndex.set(id, row);
      }
    }
  }

  const archiveRoot = resolveArchiveRoot(opts.repoRoot, opts.archiveRoot);
  const archiveAvailable = existsSync(archiveRoot);
  if (!archiveAvailable) {
    console.warn(
      `migrate: archive root "${archiveRoot}" does not exist -- folding public ` +
        `representations (sources.csv + acquisition-tracker.csv) only; archive-side ` +
        `enrichment (register, stubs, provenance) is unavailable`,
    );
  }

  const registerByCase = new Map<string, Map<string, Record<string, string>>>();
  const getRegister = (sourceCase: string): Map<string, Record<string, string>> => {
    const cached = registerByCase.get(sourceCase);
    if (cached !== undefined) {
      return cached;
    }
    const index = archiveAvailable ? readRegister(archiveRoot, sourceCase) : new Map();
    registerByCase.set(sourceCase, index);
    return index;
  };

  const migrated: MigratedSource[] = sources.map((row) => {
    const sourceId = requireCell(row, 'id', 'sources.csv row');
    const sourceCase = nonEmpty(row.case) ?? '';
    const register = archiveAvailable && sourceCase.length > 0 ? getRegister(sourceCase) : new Map<string, Record<string, string>>();
    const stub =
      archiveAvailable && sourceCase.length > 0
        ? readStub(archiveRoot, sourceCase, sourceId)
        : undefined;
    return migrateSource(row, trackerIndex.get(sourceId), register, stub);
  });
  migrated.sort((a, b) => (a.source.sourceId < b.source.sourceId ? -1 : 1));

  const sourcesDir = path.join(opts.repoRoot, 'bibliography', 'sources');
  const written: string[] = [];
  if (write) {
    mkdirSync(sourcesDir, { recursive: true });
    for (const entry of migrated) {
      const filePath = path.join(sourcesDir, `${entry.source.sourceId}.yml`);
      writeFileSync(filePath, serializeSource(entry), 'utf-8');
      written.push(filePath);
    }
  }

  const loaded: LoadedSource[] = write
    ? loadAllSources(sourcesDir)
    : migrated.map((entry) => ({ source: entry.source, records: entry.records, identifierLeaks: [] }));

  const provenanceBySource = new Map<string, AssetProvenance[]>();
  if (archiveAvailable) {
    for (const entry of loaded) {
      const provenance = await safeGather(entry.source.sourceId, archiveRoot);
      if (provenance.length > 0) {
        provenanceBySource.set(entry.source.sourceId, provenance);
      }
    }
  }

  const censusByKey = gatherCensusForAll(loaded, opts.repoRoot);
  const model = deriveModel(loaded, provenanceBySource, censusByKey);
  return { written, model };
}
