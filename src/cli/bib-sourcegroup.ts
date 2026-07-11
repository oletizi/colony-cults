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

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as nodeParseArgs } from 'node:util';

import { loadAllSources } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import { runFetchSource } from '@/cli/fetch';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { HttpClient } from '@/gallica/http-client';
import {
  gallicaArkIdentifierResolver,
  gallicaArkMetadataResolver,
} from '@/sourcegroup/gallica-ark-resolver';
import { runAcquire } from '@/sourcegroup/acquire';
import { BnfSruDiscoveryMechanism } from '@/sourcegroup/discovery/bnf-sru';
import { DiscoveryDispatcher } from '@/sourcegroup/discovery/discovery';
import type { DiscoveryCandidate } from '@/sourcegroup/discovery/discovery';
import { runExcludeMember } from '@/sourcegroup/exclude-member';
import { runInventory } from '@/sourcegroup/inventory';
import { runPromote } from '@/sourcegroup/promote';
import { buildExistingMembers, runVerifyMember } from '@/sourcegroup/verify-member-command';

/**
 * Resolve the repo root from THIS module's location -- `src/cli/` is two
 * levels below the repo root -- so a `bib` subaction behaves the same
 * regardless of the caller's `process.cwd()`. Shared by every handler here
 * and (re-imported) by `src/cli/bibliography.ts`.
 */
export function resolveRepoRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), '..', '..');
}

/** The one-file-per-source SSOT directory under the repo root. */
function sourcesDirOf(repoRoot: string): string {
  return path.join(repoRoot, 'bibliography', 'sources');
}

/** Narrow the `--kind` flag to the member-kind union (never `source-group`). */
function asMemberKind(value: string | undefined): 'monograph' | 'periodical' | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'monograph' || value === 'periodical') {
    return value;
  }
  throw new Error(`--kind must be "monograph" or "periodical" (got "${value}")`);
}

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

/** `bib inventory <ark> --group <id> [--kind] [--archive] [--dry-run]`. */
export async function runInventoryCli(rest: string[]): Promise<number> {
  let ark: string | undefined;
  let group: string | undefined;
  let kind: 'monograph' | 'periodical' | undefined;
  let archive: string | undefined;
  let dryRun = false;
  try {
    const { values, positionals } = nodeParseArgs({
      args: rest,
      options: {
        group: { type: 'string' },
        kind: { type: 'string' },
        archive: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    ark = positionals[0];
    group = values.group;
    kind = asMemberKind(values.kind);
    archive = values.archive;
    dryRun = Boolean(values['dry-run']);
  } catch (error) {
    console.error(`bib inventory: ${describeError(error)}`);
    return 2;
  }

  if (ark === undefined) {
    console.error('bib inventory: missing required argument <ark>');
    return 2;
  }
  if (group === undefined) {
    console.error('bib inventory: missing required flag --group <group-id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  const sourcesDir = sourcesDirOf(repoRoot);
  // GALLICA (not the BnF general-catalogue SRU): the acquisition targets are
  // Gallica digital documents (`bpt6k` arks), which the catalogue SRU does
  // not index -- see @/sourcegroup/gallica-ark-resolver.
  const resolveArk = gallicaArkMetadataResolver(new GallicaHttpClient(new HttpClient()));

  try {
    if (dryRun) {
      const metadata = await resolveArk(ark);
      if (metadata === null) {
        throw new Error(`ark "${ark}" could not be resolved -- nothing would be created`);
      }
      const sourceArchive = archive ?? metadata.archive;
      console.log(`bib inventory (dry-run): would create a member of "${group}" from ${ark}; wrote nothing`);
      console.log(`  kind: ${kind ?? 'monograph'}`);
      console.log(`  sourceArchive: ${sourceArchive ?? '(none -- pass --archive <name>)'}`);
      for (const title of metadata.titles) {
        console.log(`  title (${title.role}): ${title.text}`);
      }
      if (metadata.rightsRaw !== undefined) {
        console.log(`  rightsRaw: ${metadata.rightsRaw}`);
      }
      return 0;
    }

    const result = await runInventory({
      ark,
      groupId: group,
      kind,
      archive,
      sourcesDir,
      baseDir: repoRoot,
      resolveArk,
    });
    console.log(`bib inventory: created ${result.sourceId} (status: discovered, record: wanted)`);
    console.log(`  sourceArchive: ${result.record.sourceArchive}`);
    console.log(`  snapshot: ${result.snapshot.path}`);
    if (!result.acquirable) {
      console.log('  note: rights are not public-domain -- not yet acquirable (US1 scenario 5)');
    }
    return 0;
  } catch (error) {
    console.error(`bib inventory: ${describeError(error)}`);
    return 1;
  }
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

/** `bib acquire <id> [--archive] [--object-store] [--dry-run]`. */
export async function runAcquireCli(rest: string[]): Promise<number> {
  let id: string | undefined;
  let archive: string | undefined;
  let objectStore = false;
  let dryRun = false;
  try {
    const { values, positionals } = nodeParseArgs({
      args: rest,
      options: {
        archive: { type: 'string' },
        'object-store': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    id = positionals[0];
    archive = values.archive;
    objectStore = Boolean(values['object-store']);
    dryRun = Boolean(values['dry-run']);
  } catch (error) {
    console.error(`bib acquire: ${describeError(error)}`);
    return 2;
  }

  if (id === undefined) {
    console.error('bib acquire: missing required argument <id>');
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  try {
    const result = await runAcquire({
      sourcesDir: sourcesDirOf(repoRoot),
      sourceId: id,
      archive,
      objectStore,
      dryRun,
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
