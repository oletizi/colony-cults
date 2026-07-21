import { readFileSync } from 'node:fs';
import { parse } from '@/cli/parse';
import type { Command, ParsedArgs } from '@/cli/parse';
import { runTranslate, runTranslateSource } from '@/cli/translate';

/** A command handler: given the parsed invocation, performs the command. */
type Handler = (args: ParsedArgs) => Promise<void>;

const HANDLERS: Partial<Record<Command, Handler>> = {
  translate: (args) => runTranslate(args),
  'translate-source': (args) => runTranslateSource(args),
};

/** Read this package's version from package.json (no hardcoded duplicate). */
function readPackageVersion(): string {
  const url = new URL('../package.json', import.meta.url);
  const raw = readFileSync(url, 'utf-8');
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
  throw new Error(
    `translate: could not read a valid "version" from ${url.pathname}`,
  );
}

const HELP_TEXT = `translate - Turn archived French OCR into corrected French + English (via the Claude Code CLI)

Usage:
  translate <command> <id> [options]

Commands:
  translate <issueArk>        Translate one archived issue
  translate-source <sourceId> Translate every archived issue of a source

Options:
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

function wantsHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function wantsVersion(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

async function main(argv: string[]): Promise<void> {
  if (wantsHelp(argv)) {
    console.log(HELP_TEXT);
    return;
  }

  if (wantsVersion(argv)) {
    console.log(readPackageVersion());
    return;
  }

  const parsed = parse(argv);
  const handler = HANDLERS[parsed.command];
  if (handler === undefined) {
    throw new Error(
      `translate: command "${parsed.command}" is not wired to a handler yet`,
    );
  }
  await handler(parsed);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`translate: ${message}`);
  process.exitCode = 1;
});
