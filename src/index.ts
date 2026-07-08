#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { parse } from '@/cli/parse';
import type { Command, ParsedArgs } from '@/cli/parse';
import { runCensus } from '@/cli/census';

/** A command handler: given the parsed invocation, performs the command. */
type Handler = (args: ParsedArgs) => Promise<void>;

/**
 * Handlers for census/fetch-issue/fetch-source/ocr are implemented in later
 * tasks. Until then, dispatch fails loud rather than silently doing nothing
 * -- this is intentional, not a fallback.
 */
function notImplemented(command: Command): Handler {
  return async () => {
    throw new Error(`command ${command} not yet implemented`);
  };
}

const HANDLERS: Record<Command, Handler> = {
  census: (args) => runCensus(args),
  'fetch-issue': notImplemented('fetch-issue'),
  'fetch-source': notImplemented('fetch-source'),
  ocr: notImplemented('ocr'),
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
    `gallica: could not read a valid "version" from ${url.pathname}`,
  );
}

const HELP_TEXT = `gallica - Mirror public-domain BnF Gallica sources

Usage:
  gallica <command> <ark> [options]

Commands:
  census <periodicalArk>        Build/refresh the per-source census
  fetch-issue <issueArk>        Fetch one issue's page images (private archive)
  fetch-source <periodicalArk>  Fetch every issue in a source's census
  ocr <issueArk>                OCR already-fetched images for an issue

Options:
  --help, -h     Show this help message
  --version, -v  Show version
  --dry-run      Report intended actions; write nothing
  --force        Re-fetch/regenerate assets that already exist
  --verify       Re-hash existing assets against recorded checksums
  --ocr          Opt into OCR during a fetch
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
  await handler(parsed);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`gallica: ${message}`);
  process.exitCode = 1;
});
