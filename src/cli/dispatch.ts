import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@/cli/parse';
import type { Command, ParsedArgs } from '@/cli/parse';
import { runBibliography, isBibSubaction } from '@/cli/bibliography';
import {
  composeCorpus,
  corporaRootFor,
  envCorpusFor,
  findPackageJsonUpward,
  type CliEnvironment,
  type CorpusComposition,
} from '@/cli/composition-root';
import { isBibExceptionSubaction } from '@/cli/corpus-exceptions';
import { extractCorpusFlag } from '@/cli/corpus-flag';
import { runCensus } from '@/cli/census';
import { runFetchIssue, runFetchSource } from '@/cli/fetch';
import { runOcr } from '@/cli/ocr';
import { runRestoreImages } from '@/cli/restore-images';
import { runSummarize, runSummarizeSource } from '@/cli/summarize';
import { describeError } from '@/bibliography/load-primitives';

/**
 * A command handler: given the parsed invocation AND the corpus composed at
 * the composition root, performs the command.
 *
 * The `corpus` parameter is the INJECTION POINT established by T009 (FR-004):
 * every verb in `HANDLERS` is corpus-dependent per the FR-014 table, so it is
 * always a real composition here — never `null`, never optional. Today's
 * handlers ignore it; the hotspot tasks (T011 `bibliography/scope.ts`, T012
 * `sourcegroup/id-alloc.ts`, T013 `archive/location.ts`) thread the narrow
 * policy they need down from here, rather than re-resolving a corpus deeper in
 * the call stack.
 */
type Handler = (args: ParsedArgs, corpus: CorpusComposition) => Promise<void>;

// Partial: the shared `Command` union also carries `translate` /
// `translate-source`, which belong to the separate `translate` bin
// (src/translate-index.ts). This bin does not wire them and reports a
// helpful pointer instead.
//
// `summarize` (the per-issue generation flow, US1, T019) and `summarize-source`
// (the per-source rollup, US4, T030) are both wired here.
const HANDLERS: Partial<Record<Command, Handler>> = {
  census: (args) => runCensus(args),
  'fetch-issue': (args) => runFetchIssue(args),
  'fetch-source': (args) => runFetchSource(args),
  ocr: (args) => runOcr(args),
  'restore-images': (args) => runRestoreImages(args),
  summarize: (args) => runSummarize(args),
  'summarize-source': (args) => runSummarizeSource(args),
};

/**
 * Read this package's version from package.json (no hardcoded duplicate).
 * The depth-agnostic `package.json` walk now lives in
 * `@/cli/composition-root` so both bins share one implementation.
 */
export function readPackageVersion(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = findPackageJsonUpward(moduleDir);
  const raw = readFileSync(packageJsonPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof parsed.version === 'string' &&
    parsed.version.length > 0
  ) {
    return parsed.version;
  }
  throw new Error(`bib: could not read a valid "version" from ${packageJsonPath}`);
}

export const HELP_TEXT = `bib - Corpus bibliography SSOT + acquisition CLI

Usage:
  bib <command> [args] [options]

Bibliography / acquisition:
  query-source <source-id> --query <text>   Governed source query (persist-first)
  acquire <id>                              Acquire a source into the held corpus
  coverage                                  Corpus coverage report
  discover                                  Discovery over configured sources
  migrate | show | validate | regenerate    Bibliography SSOT verbs
  inventory | verify-member | promote | exclude-member | reconcile | rights-assess

Gallica mirroring:
  census <periodicalArk>        Build/refresh a Gallica per-source census
  fetch-issue <issueArk>        Fetch one issue's page images (private archive)
  fetch-source <periodicalArk>  Fetch a Gallica source's census (or --pages range)
  ocr <issueArk>                OCR already-fetched images for an issue
  restore-images <issueArk>     Pull page images from the public B2 cache

Summarization (two-depth LLM):
  summarize <sourceId> [issueArk]      Generate thorough + concise summary (or all issues)
  summarize-source <sourceId>          Per-source rollup summary

Options:
  --corpus <id>          Select the corpus to operate on (else COLONY_CORPUS).
                         Required by every command except help/version,
                         discover, and query-source. There is no default.
  --help, -h             Show this help message
  --version, -v          Show version
  --dry-run              Report intended actions; write nothing
  --force                Re-fetch/regenerate assets that already exist
  --verify               Re-hash existing assets against recorded checksums
  --ocr                  Opt into OCR during a fetch
  --ocr-lang <codes>     Tesseract language(s) for the ocr command, e.g. eng,
                         fra, or eng+fra (default: fra)
  --enhance-contrast     Grayscale + normalize page images before OCR (for
                         faded/low-contrast scans; ocr command)
  --archive-root <path>  Override the private-archive root (else COLONY_ARCHIVE_ROOT)
  --object-store         Opt into the object-store (B2) backend for masters
`;

function wantsHelp(argv: readonly string[]): boolean {
  return argv.length === 0 || argv.includes('--help') || argv.includes('-h');
}

function wantsVersion(argv: readonly string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

/**
 * Flat top-level dispatch for the `bib` CLI — and the CLI COMPOSITION ROOT
 * (T009). Every verb is a sibling: bibliography SSOT subactions route to
 * `runBibliography`; the Gallica mirroring verbs route to the `parse` +
 * `HANDLERS` path. Returns a process exit code and never throws, so
 * `src/index.ts` stays a thin wrapper.
 *
 * CORPUS SELECTION (FR-003, FR-009, FR-016) happens here, once, BEFORE any
 * command work begins:
 *
 * 1. The global `--corpus <id>` flag is stripped from argv (see
 *    `@/cli/corpus-flag` for why it cannot be a `parseArgs` option).
 * 2. Help/version short-circuit first — FR-014 exceptions, no corpus needed.
 * 3. The verb is classified against the FR-014 table: the exception
 *    subactions (`@/cli/corpus-exceptions`) bypass selection entirely; every
 *    other registered command requires it.
 * 4. `composeCorpus` resolves `--corpus` → `COLONY_CORPUS` → **fail loud**,
 *    with `corporaRoot` resolved here (`<repoRoot>/corpora`) and
 *    `COLONY_CORPUS` read here — the only place either may happen — and
 *    derives the narrow policies, which are injected downward.
 * 5. Any failure in step 4 returns exit code 2 with a descriptive message and
 *    no command has run (SC-002).
 *
 * An UNRECOGNIZED verb is deliberately NOT gated: it falls through to the
 * existing usage errors (`parse`'s "unknown command", or the `translate`-bin
 * redirect), which do no work and already exit non-zero. Demanding a corpus
 * before telling an operator the verb does not exist would be a worse error.
 *
 * `environment` exists so a test can inject a fixture `corporaRoot` and a
 * known `COLONY_CORPUS` (FR-016, SC-003); production passes nothing.
 */
export async function runCli(argv: string[], environment: CliEnvironment = {}): Promise<number> {
  let cliCorpus: string | undefined;
  let rest: readonly string[];
  try {
    const extracted = extractCorpusFlag(argv);
    cliCorpus = extracted.corpus;
    rest = extracted.rest;
  } catch (error) {
    console.error(`bib: ${describeError(error)}`);
    return 2;
  }

  if (wantsHelp(rest)) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (wantsVersion(rest)) {
    console.log(readPackageVersion());
    return 0;
  }

  const compose = (): CorpusComposition =>
    composeCorpus({
      corporaRoot: corporaRootFor(environment),
      cliCorpus,
      envCorpus: envCorpusFor(environment),
    });

  const argvRest = [...rest];
  const verb = argvRest[0];

  if (verb !== undefined && isBibSubaction(verb)) {
    let corpus: CorpusComposition | null = null;
    if (!isBibExceptionSubaction(verb)) {
      try {
        corpus = compose();
      } catch (error) {
        console.error(`bib ${verb}: ${describeError(error)}`);
        return 2;
      }
    }
    return runBibliography(argvRest, corpus);
  }

  try {
    const parsed = parse(argvRest);
    const handler = HANDLERS[parsed.command];
    if (handler === undefined) {
      console.error(
        `bib: "${parsed.command}" is handled by the separate "translate" bin, not here`,
      );
      return 2;
    }
    // Every verb reachable here is corpus-dependent (FR-014 table), so the
    // composition is unconditional — and it happens AFTER parsing (which is
    // pure and does no command work) purely so the failure can name the verb.
    let corpus: CorpusComposition;
    try {
      corpus = compose();
    } catch (error) {
      console.error(`bib ${parsed.command}: ${describeError(error)}`);
      return 2;
    }
    await handler(parsed, corpus);
    return 0;
  } catch (error) {
    console.error(`bib: ${describeError(error)}`);
    return 2;
  }
}
