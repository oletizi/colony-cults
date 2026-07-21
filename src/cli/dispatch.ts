import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@/cli/parse';
import type { Command, ParsedArgs } from '@/cli/parse';
import { runBibliography, isBibSubaction } from '@/cli/bibliography';
import { runCensus } from '@/cli/census';
import { runFetchIssue, runFetchSource } from '@/cli/fetch';
import { runOcr } from '@/cli/ocr';
import { runRestoreImages } from '@/cli/restore-images';
import { describeError } from '@/bibliography/load-primitives';

/** A command handler: given the parsed invocation, performs the command. */
type Handler = (args: ParsedArgs) => Promise<void>;

// Partial: the shared `Command` union also carries `translate` /
// `translate-source`, which belong to the separate `translate` bin
// (src/translate-index.ts). This bin does not wire them and reports a
// helpful pointer instead.
const HANDLERS: Partial<Record<Command, Handler>> = {
  census: (args) => runCensus(args),
  'fetch-issue': (args) => runFetchIssue(args),
  'fetch-source': (args) => runFetchSource(args),
  ocr: (args) => runOcr(args),
  'restore-images': (args) => runRestoreImages(args),
};

/**
 * Walk up from `startDir` to the nearest ancestor containing a
 * `package.json`, stopping at the filesystem root. This is depth-agnostic:
 * it works whether this module runs from `src/cli/` (tsx/source, depth 2
 * below the repo root) or from `dist/` (the esbuild bundle, depth 1) — a
 * single hardcoded relative path cannot be correct for both.
 */
function findPackageJsonUpward(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`bib: could not locate package.json above ${startDir}`);
    }
    dir = parent;
  }
}

/** Read this package's version from package.json (no hardcoded duplicate). */
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

Options:
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

function wantsHelp(argv: string[]): boolean {
  return argv.length === 0 || argv.includes('--help') || argv.includes('-h');
}

function wantsVersion(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

/**
 * Flat top-level dispatch for the `bib` CLI. Every verb is a sibling:
 * bibliography SSOT subactions route to `runBibliography`; the Gallica
 * mirroring verbs route to the `parse` + `HANDLERS` path. Returns a process
 * exit code and never throws, so `src/index.ts` stays a thin wrapper.
 */
export async function runCli(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) {
    console.log(HELP_TEXT);
    return 0;
  }
  if (wantsVersion(argv)) {
    console.log(readPackageVersion());
    return 0;
  }

  const verb = argv[0];
  if (verb !== undefined && isBibSubaction(verb)) {
    return runBibliography(argv);
  }

  try {
    const parsed = parse(argv);
    const handler = HANDLERS[parsed.command];
    if (handler === undefined) {
      console.error(
        `bib: "${parsed.command}" is handled by the separate "translate" bin, not here`,
      );
      return 2;
    }
    await handler(parsed);
    return 0;
  } catch (error) {
    console.error(`bib: ${describeError(error)}`);
    return 2;
  }
}
