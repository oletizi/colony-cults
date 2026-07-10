import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import { deriveModel, gatherCensusForAll, gatherProvenance } from '@/bibliography/derive';
import { loadAllSources } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import { migrate } from '@/bibliography/migrate';
import { buildViewRegistry, readViewIfExists } from '@/bibliography/regenerate';
import type { ViewInstance } from '@/bibliography/regenerate';
import { validate } from '@/bibliography/validate';
import type { ValidationFinding } from '@/bibliography/validate';
import { resolveArchiveRoot, sourceLayout } from '@/archive/location';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import type { CanonicalModel } from '@/bibliography/model';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/** Subactions the `bib` verb group recognizes (contracts/cli.md). */
type Subaction = 'migrate' | 'show' | 'validate' | 'regenerate' | 'inventory' | 'verify-member' | 'promote' | 'exclude-member' | 'acquire' | 'discover';
const SUBACTIONS: readonly Subaction[] = ['migrate', 'show', 'validate', 'regenerate', 'inventory', 'verify-member', 'promote', 'exclude-member', 'acquire', 'discover'];

function isSubaction(value: string): value is Subaction {
  return (SUBACTIONS as readonly string[]).includes(value);
}

/** Flags/positionals shared by every `bib` subaction. */
interface BibArgs {
  positional: string[];
  json: boolean;
  archiveRoot?: string;
  /** `bib regenerate --check`: write nothing, report drift only. */
  check: boolean;
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
      check: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    positional: positionals,
    json: Boolean(values.json),
    archiveRoot: values['archive-root'],
    check: Boolean(values.check),
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
): Promise<Map<string, AssetProvenance[]>> {
  const provenanceBySource = new Map<string, AssetProvenance[]>();
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
    const censusByKey = gatherCensusForAll(loaded, repoRoot);
    const model = deriveModel(loaded, provenanceBySource, censusByKey);
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

/** Render one {@link ValidationFinding} as a human-readable line. */
function formatFinding(finding: ValidationFinding): string {
  const parts = [`[${finding.kind}]`];
  if (finding.sourceId !== undefined) {
    parts.push(finding.sourceId);
  }
  parts.push(finding.detail);
  if (finding.path !== undefined) {
    parts.push(`(${finding.path})`);
  }
  return parts.join(' ');
}

/**
 * `bib validate [--archive-root <path>] [--json]`: build the canonical model
 * (mirroring `runShow`'s SSOT + provenance gathering) and run every
 * implemented check over it (contracts/cli.md).
 *
 * Exit codes: `0` clean (no findings), `1` findings exist, `2` malformed /
 * unreadable SSOT (a thrown load error) -- findings themselves never throw.
 */
async function runValidate(rest: string[]): Promise<number> {
  let args: BibArgs;
  try {
    args = parseBibArgs(rest);
  } catch (error) {
    console.error(`bib validate: ${describeError(error)}`);
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = path.join(repoRoot, 'bibliography', 'sources');

  let findings: ValidationFinding[];
  try {
    const loaded = loadAllSources(sourcesDir);
    const archiveRoot = resolveArchiveRoot(repoRoot, args.archiveRoot);
    const provenanceBySource = await gatherProvenanceForAll(
      loaded.map((entry) => entry.source),
      archiveRoot,
    );
    const censusByKey = gatherCensusForAll(loaded, repoRoot);
    const model = deriveModel(loaded, provenanceBySource, censusByKey);
    findings = validate(model, { repoRoot });
  } catch (error) {
    console.error(`bib validate: ${describeError(error)}`);
    return 2;
  }

  const ok = findings.length === 0;
  if (args.json) {
    console.log(JSON.stringify({ ok, findings }, null, 2));
  } else if (ok) {
    console.log('bib validate: clean -- no findings');
  } else {
    console.log(`bib validate: ${findings.length} finding(s):`);
    for (const finding of findings) {
      console.log(`  ${formatFinding(finding)}`);
    }
  }
  return ok ? 0 : 1;
}

/** Build the canonical model the same way `runShow`/`runValidate` do. */
async function buildCanonicalModel(repoRoot: string, archiveRootOverride: string | undefined): Promise<CanonicalModel> {
  const sourcesDir = path.join(repoRoot, 'bibliography', 'sources');
  const loaded = loadAllSources(sourcesDir);
  const archiveRoot = resolveArchiveRoot(repoRoot, archiveRootOverride);
  const provenanceBySource = await gatherProvenanceForAll(
    loaded.map((entry) => entry.source),
    archiveRoot,
  );
  const censusByKey = gatherCensusForAll(loaded, repoRoot);
  return deriveModel(loaded, provenanceBySource, censusByKey);
}

/** Absolute path a view resolves to under the repo root. */
function viewAbsPath(view: ViewInstance, repoRoot: string): string {
  return path.join(repoRoot, view.relativePath);
}

/** `bib regenerate --check`: write nothing; report which views (if any) have drifted. */
function runRegenerateCheck(views: readonly ViewInstance[], repoRoot: string): number {
  const drifted: string[] = [];
  for (const view of views) {
    const absPath = viewAbsPath(view, repoRoot);
    const committed = readViewIfExists(absPath);
    if (committed !== view.content) {
      drifted.push(view.relativePath);
    }
  }
  if (drifted.length === 0) {
    console.log('bib regenerate --check: all views in sync');
    return 0;
  }
  console.log(`bib regenerate --check: ${drifted.length} view(s) drifted:`);
  for (const relativePath of drifted) {
    console.log(`  ${relativePath}`);
  }
  return 1;
}

/** `bib regenerate` (write mode): write every view. */
function runRegenerateWrite(views: readonly ViewInstance[], repoRoot: string): number {
  for (const view of views) {
    const absPath = viewAbsPath(view, repoRoot);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, view.content, 'utf-8');
    console.log(`bib regenerate: wrote ${absPath}`);
  }
  return 0;
}

/**
 * `bib regenerate [--check] [--archive-root <path>]`: build the canonical
 * model (mirroring `runShow`/`runValidate`) and materialize the two PUBLIC
 * views (`@/bibliography/regenerate`'s `buildViewRegistry`) against the repo
 * root. The archive-side register + stubs are curated migrate INPUT, not
 * generated views (see `buildViewRegistry`'s doc comment), so this command
 * never writes into the archive root; `--archive-root` is still accepted and
 * forwarded to model-building (provenance gathering) for parity with `bib
 * show`/`bib validate`. Default mode WRITES each view and exits `0`.
 * `--check` writes nothing, diffs each view against its committed file, and
 * exits `1` if any view would change (drift) or `0` if both are already in
 * sync (contracts/cli.md).
 */
async function runRegenerate(rest: string[]): Promise<number> {
  let args: BibArgs;
  try {
    args = parseBibArgs(rest);
  } catch (error) {
    console.error(`bib regenerate: ${describeError(error)}`);
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  let model: CanonicalModel;
  try {
    model = await buildCanonicalModel(repoRoot, args.archiveRoot);
  } catch (error) {
    console.error(`bib regenerate: ${describeError(error)}`);
    return 2;
  }

  const views = buildViewRegistry(model);
  return args.check ? runRegenerateCheck(views, repoRoot) : runRegenerateWrite(views, repoRoot);
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
      return runValidate(rest);
    case 'regenerate':
      return runRegenerate(rest);
    case 'inventory':
      console.error('bib inventory: not yet implemented (task T019)');
      return 2;
    case 'verify-member':
      console.error('bib verify-member: not yet implemented (task T019)');
      return 2;
    case 'promote':
      console.error('bib promote: not yet implemented (task T019)');
      return 2;
    case 'exclude-member':
      console.error('bib exclude-member: not yet implemented (task T019)');
      return 2;
    case 'acquire':
      console.error('bib acquire: not yet implemented (task T019)');
      return 2;
    case 'discover':
      console.error('bib discover: not yet implemented (task T019)');
      return 2;
  }
}
