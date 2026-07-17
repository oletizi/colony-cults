/**
 * CLI wiring for the source-group `bib` subactions (T020/T023/T028/T031/
 * T034): `inventory`, `verify-member`, `promote`, `exclude-member`,
 * `acquire`, `reconcile`, `discover`. Extracted from `src/cli/bibliography.ts`
 * to keep both files under the project's file-size guideline. `inventory` is
 * wired in `@/cli/bib-inventory` and `acquire`/`reconcile` are wired in
 * `@/cli/bib-sourcegroup-acquire` -- both re-exported below -- for the same
 * file-size reason; the rest (`verify-member`, `promote`, `exclude-member`,
 * `discover`) are wired directly in this file.
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
import { resolveRepoRoot, sourcesDirOf } from '@/cli/bib-sourcegroup-paths';
import { GallicaHttpClient } from '@/gallica/gallica-client';
import { HttpClient } from '@/gallica/http-client';
import { gallicaArkIdentifierResolver } from '@/sourcegroup/gallica-ark-resolver';
import { BnfSruDiscoveryMechanism } from '@/sourcegroup/discovery/bnf-sru';
import { DiscoveryDispatcher } from '@/sourcegroup/discovery/discovery';
import type { DiscoveryCandidate } from '@/sourcegroup/discovery/discovery';
import { runExcludeMember } from '@/sourcegroup/exclude-member';
import { runPromote } from '@/sourcegroup/promote';
import { buildExistingMembers, runVerifyMember } from '@/sourcegroup/verify-member-command';

// `bib acquire` and `bib reconcile` (T031/T034, TASK-20/TASK-21/TASK-30) are
// wired in their own module, `@/cli/bib-sourcegroup-acquire` -- see that
// module's header for why -- and re-exported here so THIS module's existing
// external importers (e.g. `@/cli/bibliography`) are unaffected.
export {
  registerMemberArchiveLayout,
  type AcquireCliArgs,
  parseApprovedRange,
  parseAcquireArgs,
  runAcquireCli,
  type ReconcileCliArgs,
  parseReconcileArgs,
  runReconcileCli,
} from '@/cli/bib-sourcegroup-acquire';

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
