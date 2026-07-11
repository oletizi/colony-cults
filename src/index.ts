#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { parse } from '@/cli/parse';
import type { Command, ParsedArgs } from '@/cli/parse';
import { runBibliography } from '@/cli/bibliography';
import { runCensus } from '@/cli/census';
import { runFetchIssue, runFetchSource } from '@/cli/fetch';
import { runOcr } from '@/cli/ocr';
import { runRestoreImages } from '@/cli/restore-images';

/** A command handler: given the parsed invocation, performs the command. */
type Handler = (args: ParsedArgs) => Promise<void>;

// Partial: the shared `Command` union also carries the `translate` /
// `translate-source` verbs, which belong to the separate `translate` bin
// (src/translate-index.ts). The gallica bin does not wire them and fails
// loud (see main) if one is invoked here.
const HANDLERS: Partial<Record<Command, Handler>> = {
  census: (args) => runCensus(args),
  'fetch-issue': (args) => runFetchIssue(args),
  'fetch-source': (args) => runFetchSource(args),
  ocr: (args) => runOcr(args),
  'restore-images': (args) => runRestoreImages(args),
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
  bib <subaction>                Bibliography SSOT verbs: migrate, show,
                                 validate, regenerate; source-group pipeline:
                                 inventory, verify-member, promote,
                                 exclude-member, acquire, discover
  census <periodicalArk>        Build/refresh the per-source census
  fetch-issue <issueArk>        Fetch one issue's page images (private archive)
  fetch-source <periodicalArk>  Fetch every issue in a source's census
  ocr <issueArk>                OCR already-fetched images for an issue
  restore-images <issueArk>     Pull page images from the public B2 cache

Options:
  --help, -h             Show this help message
  --version, -v          Show version
  --dry-run              Report intended actions; write nothing
  --force                Re-fetch/regenerate assets that already exist
  --verify               Re-hash existing assets against recorded checksums
  --ocr                  Opt into OCR during a fetch
  --archive-root <path>  Override the private-archive root (else
                         COLONY_ARCHIVE_ROOT env, else the sibling clone)
  --object-store         Opt into the object-store (B2) backend for
                         page-image masters (else local-only)
`;

function wantsHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function wantsVersion(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === 'bib') {
    process.exitCode = await runBibliography(argv.slice(1));
    return;
  }

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
      `command "${parsed.command}" is not a gallica command ` +
        `(did you mean the "translate" bin?)`,
    );
  }
  await handler(parsed);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`gallica: ${message}`);
  process.exitCode = 1;
});
