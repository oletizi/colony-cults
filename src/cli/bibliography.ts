import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import { deriveModel, gatherProvenance } from '@/bibliography/derive';
import { loadAllSources } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import { migrate } from '@/bibliography/migrate';
import { resolveArchiveRoot, sourceLayout } from '@/archive/location';
import type { ProvenanceFields } from '@/archive/provenance';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/** Subactions the `bib` verb group recognizes (contracts/cli.md). */
type Subaction = 'migrate' | 'show' | 'validate' | 'regenerate';
const SUBACTIONS: readonly Subaction[] = ['migrate', 'show', 'validate', 'regenerate'];

function isSubaction(value: string): value is Subaction {
  return (SUBACTIONS as readonly string[]).includes(value);
}

/** Exit code reserved for a recognized-but-unimplemented subaction. */
const NOT_IMPLEMENTED_EXIT = 3;

/** Flags/positionals shared by every `bib` subaction. */
interface BibArgs {
  positional: string[];
  json: boolean;
  archiveRoot?: string;
}

/**
 * Resolve the repo root from THIS module's location -- `src/cli/` is two
 * levels below the repo root -- so `bib` behaves the same regardless of the
 * caller's `process.cwd()`, matching how `src/index.ts` resolves
 * `package.json` relative to its own module URL.
 */
function resolveRepoRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '..', '..');
}

/** Parse a subaction's `rest` argv into positionals + the shared flags. Throws (fail loud) on an unknown flag. */
function parseBibArgs(rest: string[]): BibArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      json: { type: 'boolean', default: false },
      'archive-root': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    positional: positionals,
    json: Boolean(values.json),
    archiveRoot: values['archive-root'],
  };
}

/** Whether a source id has a registered archive layout (absence, not failure). */
function hasArchiveLayout(sourceId: string): boolean {
  try {
    sourceLayout(sourceId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gather provenance for every loaded source when the archive root exists,
 * tolerating sources with no registered archive layout (genuine absence).
 * Any OTHER failure (unreadable/malformed provenance YAML) propagates.
 */
async function gatherProvenanceForAll(
  sources: Source[],
  archiveRoot: string,
): Promise<Map<string, ProvenanceFields[]>> {
  const provenanceBySource = new Map<string, ProvenanceFields[]>();
  if (!existsSync(archiveRoot)) {
    return provenanceBySource;
  }
  for (const source of sources) {
    if (!hasArchiveLayout(source.sourceId)) {
      continue;
    }
    const provenance = await gatherProvenance(source.sourceId, archiveRoot);
    if (provenance.length > 0) {
      provenanceBySource.set(source.sourceId, provenance);
    }
  }
  return provenanceBySource;
}

/** `bib migrate [--archive-root <path>]`: fold the legacy representations into the SSOT. */
async function runMigrate(rest: string[]): Promise<number> {
  let args: BibArgs;
  try {
    args = parseBibArgs(rest);
  } catch (error) {
    console.error(`bib migrate: ${describeError(error)}`);
    return 2;
  }
  const repoRoot = resolveRepoRoot();
  try {
    const result = await migrate({ repoRoot, archiveRoot: args.archiveRoot, write: true });
    console.log(`bib migrate: wrote ${result.written.length} SSOT file(s):`);
    for (const file of result.written) {
      console.log(`  ${file}`);
    }
    return 0;
  } catch (error) {
    console.error(`bib migrate: ${describeError(error)}`);
    return 2;
  }
}

/** Render one Source's headline fields as human-readable lines. */
function formatSource(source: Source): string[] {
  const lines: string[] = [
    `Source: ${source.sourceId}`,
    `Kind: ${source.kind}`,
  ];
  for (const title of source.titles) {
    const lang = title.language !== undefined ? `, ${title.language}` : '';
    lines.push(`Title (${title.role}${lang}): ${title.text}`);
  }
  if (source.creator !== undefined) {
    lines.push(`Creator: ${source.creator}`);
  }
  if (source.language !== undefined) {
    lines.push(`Language: ${source.language}`);
  }
  if (source.case !== undefined) {
    lines.push(`Case: ${source.case}`);
  }
  if (source.identifiers.length > 0) {
    lines.push(`Identifiers: ${source.identifiers.map((id) => `${id.type}:${id.value}`).join(', ')}`);
  }
  if (source.notes !== undefined) {
    lines.push(`Notes: ${source.notes}`);
  }
  return lines;
}

/** Render one RepositoryRecord as human-readable lines. */
function formatRecord(record: RepositoryRecord): string[] {
  const lines: string[] = [
    `- ${record.sourceArchive}`,
    `    status: ${record.status === '' ? '(unset)' : record.status}`,
  ];
  if (record.catalogUrl !== undefined) {
    lines.push(`    catalogUrl: ${record.catalogUrl}`);
  }
  if (record.originalUrl !== undefined) {
    lines.push(`    originalUrl: ${record.originalUrl}`);
  }
  if (record.retrievedAt !== undefined) {
    lines.push(`    retrievedAt: ${record.retrievedAt}`);
  }
  if (record.identifiers !== undefined && record.identifiers.length > 0) {
    lines.push(
      `    identifiers: ${record.identifiers.map((id) => `${id.type}:${id.value}`).join(', ')}`,
    );
  }
  if (record.manifest !== undefined) {
    const location =
      record.manifest.objectStore !== null
        ? `object-store:${record.manifest.objectStore.key}`
        : `local:${record.manifest.localPath ?? '(unknown)'}`;
    lines.push(`    manifest: assetCount=${record.manifest.assetCount} ${location}`);
  }
  return lines;
}

/** Print `bib show`'s human (non-JSON) table for one source + its records. */
function printShow(source: Source, records: RepositoryRecord[]): void {
  console.log(formatSource(source).join('\n'));
  console.log('');
  console.log(`Repository Records (${records.length}):`);
  for (const record of records) {
    console.log(formatRecord(record).join('\n'));
  }
}

/** `bib show <sourceId> [--json] [--archive-root <path>]`: the canonical model for one source. */
async function runShow(rest: string[]): Promise<number> {
  let args: BibArgs;
  try {
    args = parseBibArgs(rest);
  } catch (error) {
    console.error(`bib show: ${describeError(error)}`);
    return 2;
  }
  const sourceId = args.positional[0];
  if (sourceId === undefined) {
    console.error('bib show: missing required argument <sourceId>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = path.join(repoRoot, 'bibliography', 'sources');

  let source: Source | undefined;
  let records: RepositoryRecord[];
  try {
    const loaded = loadAllSources(sourcesDir);
    const archiveRoot = resolveArchiveRoot(repoRoot, args.archiveRoot);
    const provenanceBySource = await gatherProvenanceForAll(
      loaded.map((entry) => entry.source),
      archiveRoot,
    );
    const model = deriveModel(loaded, provenanceBySource);
    source = model.sources.find((s) => s.sourceId === sourceId);
    records = model.repositoryRecords.filter((r) => r.sourceId === sourceId);
  } catch (error) {
    console.error(`bib show: ${describeError(error)}`);
    return 2;
  }

  if (source === undefined) {
    console.error(`bib show: unknown sourceId "${sourceId}"`);
    return 1;
  }

  if (args.json) {
    console.log(JSON.stringify({ source, repositoryRecords: records }, null, 2));
  } else {
    printShow(source, records);
  }
  return 0;
}

/** `bib validate` / `bib regenerate`: not implemented in this task (T018/T021/T028). */
function runNotImplemented(subaction: 'validate' | 'regenerate'): number {
  const seeAlso = subaction === 'validate' ? 'T018' : 'T021/T028';
  console.error(`bib ${subaction}: not yet implemented (see ${seeAlso})`);
  return NOT_IMPLEMENTED_EXIT;
}

/**
 * Dispatch a `bib <subaction> [args] [flags]` invocation (contracts/cli.md).
 * Returns a process exit code -- never throws -- so `src/index.ts` can wire
 * it in ahead of the existing flat `<command> <ark>` parser without disturbing it.
 */
export async function runBibliography(argv: string[]): Promise<number> {
  const [subaction, ...rest] = argv;
  if (subaction === undefined || !isSubaction(subaction)) {
    console.error(
      `bib: unknown subaction "${subaction ?? ''}" (expected one of: ${SUBACTIONS.join(', ')})`,
    );
    return 2;
  }
  switch (subaction) {
    case 'migrate':
      return runMigrate(rest);
    case 'show':
      return runShow(rest);
    case 'validate':
      return runNotImplemented('validate');
    case 'regenerate':
      return runNotImplemented('regenerate');
  }
}
