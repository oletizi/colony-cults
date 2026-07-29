import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  composeCorpus,
  corporaRootFor,
  envCorpusFor,
  findPackageJsonUpward,
  type CliEnvironment,
  type CorpusComposition,
} from '@/cli/composition-root';
import { extractCorpusFlag } from '@/cli/corpus-flag';
import { parse } from '@/cli/parse';
import type { Command, ParsedArgs } from '@/cli/parse';
import { runTranslate, runTranslateSource } from '@/cli/translate';

/**
 * The COMPOSITION ROOT for the separate `translate` bin (T009), split out of
 * `src/translate-index.ts` so the root is importable and testable the same way
 * `@/cli/dispatch`'s `runCli` is; `src/translate-index.ts` is now a thin
 * process wrapper, matching `src/index.ts`.
 *
 * Per the FR-014 table, BOTH of this bin's verbs (`translate`,
 * `translate-source`) are corpus-dependent — they compute archive paths and
 * write translation provenance — so selection is unconditional once a verb has
 * been recognized. Generic help/version are the only exceptions.
 */

/**
 * A command handler: given the parsed invocation AND the corpus composed at
 * the composition root. The `corpus` parameter is the T009 injection point
 * (FR-004); each handler threads the NARROW policy its command needs down from
 * here, never the record itself.
 */
type Handler = (args: ParsedArgs, corpus: CorpusComposition) => Promise<void>;

// Both handlers thread `corpus.sourceFilenames` (AUDIT-02/16/27): these
// lambdas used to DROP the injected composition, leaving `runTranslate`/
// `runTranslateSource` to reach for the ambient deferred composition
// (`committedSourceFilenamePolicy`) instead. FR-018 authorizes that reach only
// on chains with no composition-root parameter available; a dispatch handler
// is not one of them — the corpus is right here.
const HANDLERS: Partial<Record<Command, Handler>> = {
  translate: (args, corpus) => runTranslate(args, corpus.sourceFilenames),
  'translate-source': (args, corpus) => runTranslateSource(args, corpus.sourceFilenames),
};

/**
 * Read this package's version from package.json (no hardcoded duplicate).
 * Uses the shared depth-agnostic walk so it resolves identically under `tsx`
 * (`src/cli/`) and in the esbuild bundle (`dist/`).
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
  throw new Error(`translate: could not read a valid "version" from ${packageJsonPath}`);
}

export const HELP_TEXT = `translate - Turn archived French OCR into corrected French + English (via the Claude Code CLI)

Usage:
  translate <command> <id> [options]

Commands:
  translate <issueArk>        Translate one archived issue
  translate-source <sourceId> Translate every archived issue of a source

Options:
  --corpus <id>   Select the corpus to operate on (else COLONY_CORPUS).
                  Required by both commands; there is no default.
  --help, -h      Show this help message
  --version, -v   Show version
  --dry-run       Report intended work + rights; write nothing
  --force         Re-translate artifacts that already exist
  --model <name>  Model to pin (recorded in provenance)
  --engine <name> Translation engine to use (claude|codex; default: claude, or translate.config.json)
  --checkpoint    Commit + push the archive as pages complete (monograph: every
                  --checkpoint-every pages, plus a final flush)
  --checkpoint-every <N>  Page cadence for --checkpoint on a monograph (default 1)
`;

function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function wantsVersion(argv: readonly string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

/**
 * Run the `translate` bin. Throws (fail loud) on a usage error, on a failed
 * corpus selection, or on any handler failure; `src/translate-index.ts` turns
 * a throw into a non-zero exit code.
 *
 * Corpus selection happens HERE, once, before any command work: `--corpus` is
 * stripped from argv, help/version short-circuit as FR-014 exceptions, the
 * verb is recognized, and only then is the corpus composed — with
 * `corporaRoot` resolved here (`<repoRoot>/corpora`) and `COLONY_CORPUS` read
 * here (FR-016).
 */
export async function runTranslateCli(
  argv: string[],
  environment: CliEnvironment = {},
): Promise<void> {
  const { corpus: cliCorpus, rest } = extractCorpusFlag(argv);

  if (wantsHelp(rest)) {
    console.log(HELP_TEXT);
    return;
  }

  if (wantsVersion(rest)) {
    console.log(readPackageVersion());
    return;
  }

  const parsed = parse([...rest]);
  const handler = HANDLERS[parsed.command];
  if (handler === undefined) {
    throw new Error(`translate: command "${parsed.command}" is not wired to a handler yet`);
  }

  const corpus = composeCorpus({
    corporaRoot: corporaRootFor(environment),
    cliCorpus,
    envCorpus: envCorpusFor(environment),
  });

  await handler(parsed, corpus);
}
