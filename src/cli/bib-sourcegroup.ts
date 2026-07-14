/**
 * CLI wiring for the six source-group `bib` subactions (T020/T023/T028/T031/
 * T034): `inventory`, `verify-member`, `promote`, `exclude-member`,
 * `acquire`, `discover`. Extracted from `src/cli/bibliography.ts` to keep both
 * files under the project's file-size guideline.
 *
 * Each handler parses its own flags per
 * specs/006-source-group-acquisition/contracts/cli-commands.md, constructs the
 * REAL injected dependencies (the concrete BnF SRU ark resolver, the shipped
 * `loadAllSources` member loader, the shipped `runFetchSource` fetcher, a real
 * polite `HttpClient`), calls the already-tested handler in
 * `src/sourcegroup/`, and maps the outcome to a process exit code + printed
 * output. Fail loud: a tooling/precondition failure prints to stderr and
 * returns a non-zero code; no fallbacks.
 */

import { parseArgs as nodeParseArgs } from 'node:util';

import { loadAllSources } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import { deriveSourceLayout, registerSourceLayout } from '@/archive/location';
import { runFetchSource } from '@/cli/fetch';
import { parseCheckpointEvery } from '@/cli/parse';
import { resolveRepoRoot, sourcesDirOf } from '@/cli/bib-sourcegroup-paths';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { HttpClient } from '@/gallica/http-client';
import { gallicaArkIdentifierResolver } from '@/sourcegroup/gallica-ark-resolver';
import { runAcquire } from '@/sourcegroup/acquire';
import { runReconcile } from '@/sourcegroup/reconcile';
import { gatherProvenance } from '@/bibliography/derive';
import { resolveArchiveRoot } from '@/archive/location';
import { BnfSruDiscoveryMechanism } from '@/sourcegroup/discovery/bnf-sru';
import { DiscoveryDispatcher } from '@/sourcegroup/discovery/discovery';
import type { DiscoveryCandidate } from '@/sourcegroup/discovery/discovery';
import { runExcludeMember } from '@/sourcegroup/exclude-member';
import { runPromote } from '@/sourcegroup/promote';
import { buildExistingMembers, runVerifyMember } from '@/sourcegroup/verify-member-command';

// `bib inventory` (T017-T020) is wired in its own module, `@/cli/bib-inventory`
// -- see that module's header for why -- and re-exported here so THIS
// module's existing external importers (e.g. `@/cli/bibliography`) are
// unaffected.
export {
  runInventoryCli,
  parseInventoryArgs,
  type InventoryCliArgs,
} from '@/cli/bib-inventory';

// `resolveRepoRoot` moved to `@/cli/bib-sourcegroup-paths` (shared with
// `@/cli/bib-inventory`, avoiding a circular import) but stays re-exported
// here for this module's existing external importers
// (`@/cli/bib-coverage`, `@/bibliography/coverage/load-coverage-report`,
// `@/cli/bibliography`).
export { resolveRepoRoot };

/** Parse `--limit` into a positive integer (no silent fallback to a default). */
function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--limit must be a positive integer (got "${raw}")`);
  }
  return n;
}

/** `bib verify-member <id> [--archive] [--json]`. */
export async function runVerifyMemberCli(rest: string[]): Promise<number> {
  let id: string | undefined;
  let archive: string | undefined;
  let json = false;
  try {
    const { values, positionals } = nodeParseArgs({
      args: rest,
      options: {
        archive: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    id = positionals[0];
    archive = values.archive;
    json = Boolean(values.json);
  } catch (error) {
    console.error(`bib verify-member: ${describeError(error)}`);
    return 2;
  }

  if (id === undefined) {
    console.error('bib verify-member: missing required argument <id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const result = await runVerifyMember({
    id,
    archive,
    json,
    sourcesDir: sourcesDirOf(repoRoot),
    loadMembers: loadAllSources,
    resolveArk: gallicaArkIdentifierResolver(new GallicaHttpClient(new HttpClient())),
  });
  // A verdict (pass or fail) is data -> exit 0; a tooling error -> non-zero.
  return result.exitCode;
}

/** `bib promote <id> [--archive] [--group]`. */
export async function runPromoteCli(rest: string[]): Promise<number> {
  let id: string | undefined;
  let archive: string | undefined;
  let group: string | undefined;
  try {
    const { values, positionals } = nodeParseArgs({
      args: rest,
      options: {
        archive: { type: 'string' },
        group: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
    id = positionals[0];
    archive = values.archive;
    group = values.group;
  } catch (error) {
    console.error(`bib promote: ${describeError(error)}`);
    return 2;
  }

  if (id === undefined) {
    console.error('bib promote: missing required argument <id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = sourcesDirOf(repoRoot);
  try {
    const existingMembers = buildExistingMembers(loadAllSources(sourcesDir), id);
    const result = await runPromote({
      sourcesDir,
      sourceId: id,
      archive,
      group,
      resolveArk: gallicaArkIdentifierResolver(new GallicaHttpClient(new HttpClient())),
      existingMembers,
      verifiedAt: new Date().toISOString(),
    });
    console.log(
      `bib promote: ${result.sourceId} -> ${result.status} ` +
        `(copy "${result.sourceArchive}": ${result.recordStatus})`,
    );
    return 0;
  } catch (error) {
    console.error(`bib promote: ${describeError(error)}`);
    return 1;
  }
}

/** `bib exclude-member <id> --reason <text>`. */
export async function runExcludeMemberCli(rest: string[]): Promise<number> {
  let id: string | undefined;
  let reason: string | undefined;
  try {
    const { values, positionals } = nodeParseArgs({
      args: rest,
      options: {
        reason: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
    id = positionals[0];
    reason = values.reason;
  } catch (error) {
    console.error(`bib exclude-member: ${describeError(error)}`);
    return 2;
  }

  if (id === undefined) {
    console.error('bib exclude-member: missing required argument <id>');
    return 2;
  }
  if (reason === undefined) {
    console.error('bib exclude-member: missing required flag --reason <text>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  try {
    const result = await runExcludeMember({
      sourcesDir: sourcesDirOf(repoRoot),
      sourceId: id,
      reason,
    });
    console.log(`bib exclude-member: ${result.sourceId} -> ${result.status} (reason: ${result.reason})`);
    return 0;
  } catch (error) {
    console.error(`bib exclude-member: ${describeError(error)}`);
    return 1;
  }
}

/**
 * Auto-register `id`'s archive layout (`@/archive/location`'s runtime
 * overlay) BEFORE `bib acquire` drives the shipped fetcher -- the fetcher
 * resolves a layout deep inside via the synchronous, sourceId-only
 * `sourceLayout(sourceId)`, which throws for a source-group member (created
 * by `bib inventory`) that was never hand-added to the static registry. Loads
 * the member Source (and, when it has one, its owning group, for the
 * fallback `case`) via the shipped `loadAllSources` -- fails loud if either
 * cannot be resolved, since a layout cannot be derived from nothing.
 *
 * Exported (not just used internally by `runAcquireCli`) so this wiring is
 * directly unit-testable without standing up the full CLI (real repo root,
 * real network-backed fetcher).
 */
export function registerMemberArchiveLayout(sourcesDir: string, id: string): void {
  const loaded = loadAllSources(sourcesDir);
  const memberEntry = loaded.find((entry) => entry.source.sourceId === id);
  if (memberEntry === undefined) {
    throw new Error(`bib acquire: unknown sourceId "${id}" -- cannot resolve its archive layout`);
  }
  const memberSource = memberEntry.source;

  let groupCase: string | undefined;
  if (memberSource.partOf !== undefined) {
    const groupEntry = loaded.find((entry) => entry.source.sourceId === memberSource.partOf);
    if (groupEntry === undefined) {
      throw new Error(
        `bib acquire: member "${id}"'s group "${memberSource.partOf}" does not resolve to an ` +
          `existing Source -- cannot derive its archive layout's fallback case`,
      );
    }
    groupCase = groupEntry.source.case;
  }

  registerSourceLayout(id, deriveSourceLayout(memberSource, groupCase));
}

/** Typed result of parsing `bib acquire`'s argv (see {@link parseAcquireArgs}). */
export interface AcquireCliArgs {
  id: string | undefined;
  archive: string | undefined;
  objectStore: boolean;
  dryRun: boolean;
  checkpoint: boolean;
  checkpointEvery: number | undefined;
}

/**
 * Parse `bib acquire <id> [--archive] [--object-store] [--dry-run]
 * [--checkpoint] [--checkpoint-every <N>]`'s argv into typed flags.
 *
 * Exported (not just used internally by `runAcquireCli`) so this parsing is
 * directly unit-testable without driving the real network-backed fetcher
 * (`runAcquireCli` always injects the real, unmocked `runFetchSource`).
 * `--checkpoint-every` is validated by the same `parseCheckpointEvery`
 * (`@/cli/parse`) the shipped fetcher's own `--checkpoint-every` uses, so a
 * malformed value fails identically here and there (fail loud, no
 * fallback).
 */
export function parseAcquireArgs(rest: string[]): AcquireCliArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      archive: { type: 'string' },
      'object-store': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      checkpoint: { type: 'boolean', default: false },
      'checkpoint-every': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    id: positionals[0],
    archive: values.archive,
    objectStore: Boolean(values['object-store']),
    dryRun: Boolean(values['dry-run']),
    checkpoint: Boolean(values.checkpoint),
    checkpointEvery: parseCheckpointEvery(values['checkpoint-every']),
  };
}

/** `bib acquire <id> [--archive] [--object-store] [--dry-run] [--checkpoint] [--checkpoint-every <N>]`. */
export async function runAcquireCli(rest: string[]): Promise<number> {
  let parsed: AcquireCliArgs;
  try {
    parsed = parseAcquireArgs(rest);
  } catch (error) {
    console.error(`bib acquire: ${describeError(error)}`);
    return 2;
  }
  const { id, archive, objectStore, dryRun, checkpoint, checkpointEvery } = parsed;

  if (id === undefined) {
    console.error('bib acquire: missing required argument <id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = sourcesDirOf(repoRoot);
  try {
    // Auto-register this member's archive layout BEFORE the fetcher (below)
    // resolves it -- see `registerMemberArchiveLayout`'s doc comment.
    registerMemberArchiveLayout(sourcesDir, id);

    const result = await runAcquire({
      sourcesDir,
      sourceId: id,
      archive,
      objectStore,
      dryRun,
      checkpoint,
      checkpointEvery,
      // The shipped fetcher, injected unchanged (D-08): no new fetch code here.
      fetch: runFetchSource,
    });
    const mode = dryRun ? ' (dry-run)' : '';
    console.log(
      `bib acquire${mode}: ${result.sourceId} -> fetched ${result.ark} ` +
        `from "${result.sourceArchive}"`,
    );
    return 0;
  } catch (error) {
    console.error(`bib acquire: ${describeError(error)}`);
    return 1;
  }
}

/** Typed result of parsing `bib reconcile`'s argv (see {@link parseReconcileArgs}). */
export interface ReconcileCliArgs {
  id: string | undefined;
  archive: string | undefined;
  archiveRoot: string | undefined;
}

/**
 * Parse `bib reconcile <id> [--archive <sourceArchive>] [--archive-root
 * <path>]`'s argv into typed flags. Exported so this parsing is directly
 * unit-testable without touching a real archive on disk.
 */
export function parseReconcileArgs(rest: string[]): ReconcileCliArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      archive: { type: 'string' },
      'archive-root': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    id: positionals[0],
    archive: values.archive,
    archiveRoot: values['archive-root'],
  };
}

/**
 * `bib reconcile <id> [--archive <sourceArchive>] [--archive-root <path>]`
 * (TASK-21): fold the archive's per-page object_store provenance into the
 * member's SSOT `repositoryRecords[].status`, closing the spec/impl gap
 * TASK-20 found (contract cli-commands.md line 64). Idempotent; re-runnable on
 * members acquired out-of-band. Registers the member's archive layout first
 * (same overlay `bib acquire` needs) so `gatherProvenance`'s `sourceLayout`
 * resolves a source-group member, then delegates to the tested
 * `runReconcile`, injecting the real `gatherProvenance`.
 */
export async function runReconcileCli(rest: string[]): Promise<number> {
  let parsed: ReconcileCliArgs;
  try {
    parsed = parseReconcileArgs(rest);
  } catch (error) {
    console.error(`bib reconcile: ${describeError(error)}`);
    return 2;
  }
  const { id, archive, archiveRoot: archiveRootOverride } = parsed;

  if (id === undefined) {
    console.error('bib reconcile: missing required argument <id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = sourcesDirOf(repoRoot);
  const archiveRoot = resolveArchiveRoot(repoRoot, archiveRootOverride);
  try {
    // Register this member's archive layout BEFORE gathering provenance --
    // `gatherProvenance` resolves the source's slug via the synchronous,
    // sourceId-only `sourceLayout(sourceId)`, which throws for a source-group
    // member absent this runtime overlay (same reason `bib acquire` registers).
    registerMemberArchiveLayout(sourcesDir, id);

    const result = await runReconcile({
      sourcesDir,
      archiveRoot,
      sourceId: id,
      archive,
      gather: gatherProvenance,
    });
    const verb = result.changed ? 'reconciled' : 'already reconciled';
    console.log(
      `bib reconcile: ${verb} ${result.sourceId} at "${result.sourceArchive}" -> ` +
        `${result.status} (${result.storedCount}/${result.pageCount} master(s) in object store)`,
    );
    return 0;
  } catch (error) {
    console.error(`bib reconcile: ${describeError(error)}`);
    return 1;
  }
}

/** Render one discovery candidate as human-readable lines. */
function formatCandidate(candidate: DiscoveryCandidate): string[] {
  const lines = [`- ${candidate.identifier} (${candidate.endpoint})`];
  if (candidate.titleHint !== undefined) {
    lines.push(`    title: ${candidate.titleHint}`);
  }
  if (candidate.creatorHint !== undefined) {
    lines.push(`    creator: ${candidate.creatorHint}`);
  }
  if (candidate.dateHint !== undefined) {
    lines.push(`    date: ${candidate.dateHint}`);
  }
  return lines;
}

/** `bib discover <query> [--limit N]`. */
export async function runDiscoverCli(rest: string[]): Promise<number> {
  let query: string | undefined;
  let limit: number | undefined;
  try {
    const { values, positionals } = nodeParseArgs({
      args: rest,
      options: {
        limit: { type: 'string' },
      },
      allowPositionals: true,
      strict: true,
    });
    // A multi-word query passed unquoted arrives as several positionals; join
    // them back so `bib discover Marquis de Rays` works as well as quoted.
    query = positionals.length > 0 ? positionals.join(' ') : undefined;
    limit = parseLimit(values.limit);
  } catch (error) {
    console.error(`bib discover: ${describeError(error)}`);
    return 2;
  }

  if (query === undefined) {
    console.error('bib discover: missing required argument <query>');
    return 2;
  }

  const dispatcher = new DiscoveryDispatcher(new BnfSruDiscoveryMechanism(new HttpClient()));
  try {
    const candidates = await dispatcher.discover(
      query,
      limit === undefined ? undefined : { maxResults: limit },
    );
    console.log(`bib discover: ${candidates.length} candidate(s) for "${query}" via ${dispatcher.endpoint}:`);
    for (const candidate of candidates) {
      console.log(formatCandidate(candidate).join('\n'));
    }
    return 0;
  } catch (error) {
    // Fail loud, no fallback: a `DiscoveryUnavailableError` (or any other
    // failure) is surfaced verbatim; the pipeline may instead be driven from
    // operator-supplied candidate arks (FR-019).
    console.error(`bib discover: ${describeError(error)}`);
    return 1;
  }
}
