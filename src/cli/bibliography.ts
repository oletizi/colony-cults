import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs as nodeParseArgs } from 'node:util';

import {
  resolveRepoRoot,
  runAcquireCli,
  runReconcileCli,
  runDiscoverCli,
  runExcludeMemberCli,
  runInventoryCli,
  runPromoteCli,
  runVerifyMemberCli,
} from '@/cli/bib-sourcegroup';
import { runCoverageCli } from '@/cli/bib-coverage';
import { runRightsAssessCli } from '@/cli/bib-rights-assess';
import { deriveModel, gatherCensusForAll, gatherProvenance } from '@/bibliography/derive';
import { loadAllSources } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import { migrate } from '@/bibliography/migrate';
import { buildViewRegistry, readViewIfExists } from '@/bibliography/regenerate';
import type { ViewInstance } from '@/bibliography/regenerate';
import { validate } from '@/bibliography/validate';
import type { ValidationFinding } from '@/bibliography/validate';
import { loadSearchLogForValidate } from '@/bibliography/validate-search-log';
import { resolveArchiveRoot, sourceLayout } from '@/archive/location';
import type { AssetProvenance } from '@/bibliography/provenance-read';
import type { CanonicalModel } from '@/bibliography/model';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/** Subactions the `bib` verb group recognizes (contracts/cli.md). */
type Subaction = 'migrate' | 'show' | 'validate' | 'regenerate' | 'inventory' | 'verify-member' | 'promote' | 'exclude-member' | 'acquire' | 'reconcile' | 'discover' | 'coverage' | 'rights-assess';
const SUBACTIONS: readonly Subaction[] = ['migrate', 'show', 'validate', 'regenerate', 'inventory', 'verify-member', 'promote', 'exclude-member', 'acquire', 'reconcile', 'discover', 'coverage', 'rights-assess'];

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

/** A source's canonical (else first) title text, for a compact member listing. */
export function sourceTitle(source: Source): string {
  const canonical = source.titles.find((t) => t.role === 'canonical') ?? source.titles[0];
  return canonical?.text ?? '(untitled)';
}

/**
 * Derive a source-group's members from the `partOf` edges (a group holds no
 * member list; FR-006), sorted by id for a stable listing. Returns `[]` for a
 * non-group id or a group with no members.
 */
export function deriveGroupMembers(
  sources: readonly Source[],
  groupId: string,
): Source[] {
  return sources
    .filter((s) => s.partOf === groupId)
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

/**
 * Render a source-group's derived members as human-readable lines. Membership
 * is the members' `partOf` edge (a group holds no member list; FR-006), so the
 * list is DERIVED rather than stored on the group.
 */
export function formatMembers(members: readonly Source[]): string[] {
  const lines = [`Members (${members.length}):`];
  for (const m of members) {
    lines.push(`- ${m.sourceId}  [${m.status ?? 'no-status'}]  ${sourceTitle(m)}`);
  }
  return lines;
}

/** Print `bib show`'s human (non-JSON) table for one source + its records (+ members for a group). */
function printShow(source: Source, records: RepositoryRecord[], members: readonly Source[]): void {
  console.log(formatSource(source).join('\n'));
  console.log('');
  if (source.kind === 'source-group') {
    console.log(formatMembers(members).join('\n'));
    console.log('');
  }
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
  let members: Source[] = [];
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
    // A source-group's members are DERIVED from the `partOf` edges (the group
    // holds no member list; FR-006), sorted by id for a stable listing.
    if (source?.kind === 'source-group') {
      members = deriveGroupMembers(model.sources, sourceId);
    }
  } catch (error) {
    console.error(`bib show: ${describeError(error)}`);
    return 2;
  }

  if (source === undefined) {
    console.error(`bib show: unknown sourceId "${sourceId}"`);
    return 1;
  }

  if (args.json) {
    const memberView = members.map((m) => ({
      sourceId: m.sourceId,
      title: sourceTitle(m),
      status: m.status ?? null,
      kind: m.kind,
    }));
    console.log(
      JSON.stringify(
        source.kind === 'source-group'
          ? { source, members: memberView, repositoryRecords: records }
          : { source, repositoryRecords: records },
        null,
        2,
      ),
    );
  } else {
    printShow(source, records, members);
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
 * implemented check over it (contracts/cli.md). Also loads
 * `bibliography/search-log.yml` (`@/bibliography/validate-search-log`'s
 * `loadSearchLogForValidate`) alongside the SSOT sources -- a malformed
 * search-log (duplicate id / missing required field, V6/V7) fails loud here
 * the same way a malformed SSOT source file already does, rather than only
 * surfacing later via `bib coverage`. The loaded entries are not folded into
 * `findings` (the search-log-driven coverage projection is `bib coverage`'s
 * concern); this call exists purely to enforce V6/V7 as part of `bib
 * validate`.
 *
 * Exit codes: `0` clean (no findings), `1` findings exist, `2` malformed /
 * unreadable SSOT or search-log (a thrown load error) -- findings themselves
 * never throw.
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
    const searchLog = loadSearchLogForValidate(repoRoot);
    const archiveRoot = resolveArchiveRoot(repoRoot, args.archiveRoot);
    const provenanceBySource = await gatherProvenanceForAll(
      loaded.map((entry) => entry.source),
      archiveRoot,
    );
    const censusByKey = gatherCensusForAll(loaded, repoRoot);
    const model = deriveModel(loaded, provenanceBySource, censusByKey);
    findings = validate(model, { repoRoot, searchLog });
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
      return runInventoryCli(rest);
    case 'verify-member':
      return runVerifyMemberCli(rest);
    case 'promote':
      return runPromoteCli(rest);
    case 'exclude-member':
      return runExcludeMemberCli(rest);
    case 'acquire':
      return runAcquireCli(rest);
    case 'reconcile':
      return runReconcileCli(rest);
    case 'discover':
      return runDiscoverCli(rest);
    case 'coverage':
      return runCoverageCli(rest);
    case 'rights-assess':
      return runRightsAssessCli(rest);
  }
}
