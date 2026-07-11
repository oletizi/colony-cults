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

/**
 * Parse `--checkpoint-every`'s raw string value into a positive integer.
 * `undefined` (flag absent) passes through unchanged -- the default (1,
 * every page) is a use-site decision, not something invented here. Any
 * other non-positive-integer value throws a descriptive Error (no silent
 * fallback to a default).
 *
 * Exported so other CLI entry points that forward `--checkpoint`/
 * `--checkpoint-every` to the shipped fetcher (e.g. `bib acquire`, see
 * `@/cli/bib-sourcegroup`) validate it identically instead of duplicating
 * the rule.
 */
export function parseCheckpointEvery(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `gallica: --checkpoint-every must be a positive integer (got "${raw}")`,
    );
  }
  return n;
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
  /**
   * Opt into the object-store (B2) backend for page-image masters (T016).
   * Default false -- legacy local-only behavior is unchanged when absent.
   * When set, the fetch commands resolve `resolveObjectStoreConfig()` and
   * fail loud if the required env/credentials are missing.
   */
  objectStore: boolean;
  /**
   * Opt into reconciling the skip decision against B2 (a HEAD/ETag content-
   * verify + metadata backfill) instead of trusting local provenance. Spends
   * Class B transactions; use only to migrate externally-placed masters.
   * Default false -- a normal capture trusts the committed provenance.
   */
  reconcileRemote: boolean;
  /**
   * Opt into a per-issue git checkpoint (commit AND push) after each issue
   * completes (see `src/cli/archive-checkpoint.ts`). Default false -- the
   * fetch core stays git-free and this flag is the only way to wire the git
   * adapter into `FetchDeps.onIssueComplete` (`defaultFetchDeps`).
   */
  checkpoint: boolean;
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
  /**
   * Explicit override for the private-archive root (T016), passed as the
   * `override` arg to `resolveArchiveRoot`. Absent -> existing precedence
   * (`COLONY_ARCHIVE_ROOT` env, then the fixed sibling clone) is unchanged.
   */
  archiveRoot?: string;
  /**
   * Page-checkpoint cadence for a MONOGRAPH fetch (`--checkpoint-every <N>`):
   * commit+push every `N` pages instead of every page. Only meaningful
   * together with `--checkpoint`; a periodical source ignores it (its
   * checkpoint stays per-issue). Absent -> the use-site default is 1 (every
   * page); `N` must be a positive integer, else `parse` throws.
   */
  checkpointEvery?: number;
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
      'reconcile-remote': { type: 'boolean', default: false },
      checkpoint: { type: 'boolean', default: false },
      'source-id': { type: 'string' },
      slug: { type: 'string' },
      model: { type: 'string' },
      engine: { type: 'string' },
      'archive-root': { type: 'string' },
      'checkpoint-every': { type: 'string' },
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
      reconcileRemote: Boolean(values['reconcile-remote']),
      checkpoint: Boolean(values.checkpoint),
    },
    options: {
      sourceId: values['source-id'],
      slug: values.slug,
      model: values.model,
      engine: values.engine,
      archiveRoot: values['archive-root'],
      checkpointEvery: parseCheckpointEvery(values['checkpoint-every']),
    },
  };
}
