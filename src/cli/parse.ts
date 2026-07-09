import { parseArgs as nodeParseArgs } from 'node:util';

/** Commands recognized by the gallica CLI (see contracts/cli.md). */
export type Command = 'census' | 'fetch-issue' | 'fetch-source' | 'ocr';

const COMMANDS: readonly Command[] = [
  'census',
  'fetch-issue',
  'fetch-source',
  'ocr',
];

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

/** Name of each command's required positional, used in error messages. */
const REQUIRED_POSITIONAL_NAME: Record<Command, string> = {
  census: 'periodicalArk',
  'fetch-issue': 'issueArk',
  'fetch-source': 'periodicalArk',
  ocr: 'issueArk',
};

/** Global boolean flags shared by every command (contracts/cli.md). */
export interface ParsedFlags {
  /** Report intended actions; write nothing. */
  dryRun: boolean;
  /** Re-fetch/regenerate assets that already exist and are checksum-recorded. */
  force: boolean;
  /** Re-hash existing assets against recorded checksums; report mismatches. */
  verify: boolean;
  /** Opt into OCR during a fetch (default: images-only). */
  ocr: boolean;
  /**
   * Opt into the object-store (B2) backend for page-image masters (T016).
   * Default false -- legacy local-only behavior is unchanged when absent.
   * When set, the fetch commands resolve `resolveObjectStoreConfig()` and
   * fail loud if the required env/credentials are missing.
   */
  objectStore: boolean;
}

/**
 * Named string options. Not every command needs these; the census command
 * requires both and throws (fail loud) if either is missing -- there is no
 * magic default (see contracts/cli.md).
 */
export interface ParsedOptions {
  /** Colony Cults source ID, e.g. `PB-P001` (census: required). */
  sourceId?: string;
  /** Filename slug, e.g. `la-nouvelle-france` (census: required). */
  slug?: string;
  /**
   * Explicit override for the private-archive root (T016), passed as the
   * `override` arg to `resolveArchiveRoot`. Absent -> existing precedence
   * (`COLONY_ARCHIVE_ROOT` env, then the fixed sibling clone) is unchanged.
   */
  archiveRoot?: string;
}

/** Result of parsing argv into a single command invocation. */
export interface ParsedArgs {
  command: Command;
  /** Positional arguments after the command (e.g. the periodical/issue ark). */
  positional: string[];
  flags: ParsedFlags;
  options: ParsedOptions;
}

/**
 * Parse CLI argv (excluding the `node`/script entries) into a typed command
 * invocation.
 *
 * Throws a descriptive Error -- no fallbacks -- when:
 * - no command is given;
 * - the command is not one of the recognized commands;
 * - the command's required positional argument (the ark) is missing.
 */
export function parse(argv: string[]): ParsedArgs {
  const { values, positionals } = nodeParseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      verify: { type: 'boolean', default: false },
      ocr: { type: 'boolean', default: false },
      'object-store': { type: 'boolean', default: false },
      'source-id': { type: 'string' },
      slug: { type: 'string' },
      'archive-root': { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });

  const [commandArg, ...rest] = positionals;

  if (commandArg === undefined) {
    throw new Error(
      `gallica: missing command (expected one of: ${COMMANDS.join(', ')})`,
    );
  }

  if (!isCommand(commandArg)) {
    throw new Error(
      `gallica: unknown command "${commandArg}" (expected one of: ${COMMANDS.join(', ')})`,
    );
  }

  if (rest.length === 0) {
    throw new Error(
      `gallica ${commandArg}: missing required argument <${REQUIRED_POSITIONAL_NAME[commandArg]}>`,
    );
  }

  return {
    command: commandArg,
    positional: rest,
    flags: {
      dryRun: Boolean(values['dry-run']),
      force: Boolean(values.force),
      verify: Boolean(values.verify),
      ocr: Boolean(values.ocr),
      objectStore: Boolean(values['object-store']),
    },
    options: {
      sourceId: values['source-id'],
      slug: values.slug,
      archiveRoot: values['archive-root'],
    },
  };
}
