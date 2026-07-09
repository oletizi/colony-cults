import { parseArgs as nodeParseArgs } from 'node:util';

/** Commands recognized by the gallica CLI (see contracts/cli.md). */
export type Command =
  | 'census'
  | 'fetch-issue'
  | 'fetch-source'
  | 'ocr'
  | 'translate'
  | 'translate-source';

const COMMANDS: readonly Command[] = [
  'census',
  'fetch-issue',
  'fetch-source',
  'ocr',
  'translate',
  'translate-source',
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
  translate: 'issueArk',
  'translate-source': 'sourceId',
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
  /** Claude model alias/id to pin for a translation run (contracts/cli.md). */
  model?: string;
  /** Translation engine selector (`claude`/`codex`); CLI flag beats config beats the built-in default. */
  engine?: string;
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
      'source-id': { type: 'string' },
      slug: { type: 'string' },
      model: { type: 'string' },
      engine: { type: 'string' },
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
    },
    options: {
      sourceId: values['source-id'],
      slug: values.slug,
      model: values.model,
      engine: values.engine,
    },
  };
}
