import { parseArgs as nodeParseArgs } from 'node:util';

import { describeError } from '@/bibliography/load-primitives';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';
import { realClock, realSleep } from '@/sourcequery/clock';
import { SourceQueryClient } from '@/sourcequery/source-query-client';
import type { TailscaleRunner } from '@/sourcequery/tailscale-runner';

/** Parsed `bib query-source` argv. */
interface QuerySourceArgs {
  sourceId: string;
  query: string;
  pages: number;
}

/**
 * A `TailscaleRunner` whose every method throws (fail-loud, Principle V): US1
 * never calls it (a hard block throws in `SourceQueryClient.query()` before
 * any tailscale use), so this is a hard boundary, not a fallback. Real
 * exit-node escalation is wired by US2 (T019--T022).
 */
const unavailableTailscaleRunner: TailscaleRunner = {
  listExitNodes(): Promise<never> {
    return Promise.reject(
      new Error('Tailscale exit-node escalation is not available until US2 (T019–T022)'),
    );
  },
  currentExitNode(): Promise<never> {
    return Promise.reject(
      new Error('Tailscale exit-node escalation is not available until US2 (T019–T022)'),
    );
  },
  setExitNode(): Promise<never> {
    return Promise.reject(
      new Error('Tailscale exit-node escalation is not available until US2 (T019–T022)'),
    );
  },
};

/**
 * Parse `bib query-source <source-id> --query "<text>" [--pages <n>]`'s argv
 * slice. Throws (fail loud) on an unknown flag, a missing `--query`, a
 * missing `<source-id>` positional, or a non-numeric `--pages`.
 */
function parseQuerySourceArgs(rest: string[]): QuerySourceArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      query: { type: 'string' },
      pages: { type: 'string', default: '1' },
    },
    allowPositionals: true,
    strict: true,
  });

  const sourceId = positionals[0];
  if (sourceId === undefined) {
    throw new Error('missing required argument <source-id>');
  }

  if (values.query === undefined) {
    throw new Error('missing required flag --query');
  }

  const pagesRaw = values.pages ?? '1';
  const pages = Number.parseInt(pagesRaw, 10);
  if (!Number.isInteger(pages) || String(pages) !== pagesRaw.trim() || pages < 1) {
    throw new Error(`--pages must be a positive integer, got "${pagesRaw}"`);
  }

  return { sourceId, query: values.query, pages };
}

/**
 * `bib query-source <source-id> --query "<text>" [--pages <n>]`: the
 * agent-facing entry point (specs/014-source-query-client/contracts/cli-query-source.md,
 * US1 subset only -- `--approve-exit-node` and exit code 3 are wired by a
 * later task, T022).
 *
 * Argument parsing happens FIRST, before any client/browser construction, so
 * a usage error never launches a real browser.
 */
export async function runQuerySourceCli(rest: string[]): Promise<number> {
  let args: QuerySourceArgs;
  try {
    args = parseQuerySourceArgs(rest);
  } catch (error) {
    console.error(`bib query-source: ${describeError(error)}`);
    return 2;
  }

  const client = new SourceQueryClient({
    browser: new PlaywrightBrowserSession(),
    tailscale: unavailableTailscaleRunner,
    clock: realClock,
    sleep: realSleep,
  });

  try {
    const result = await client.query(args.sourceId, args.query, { pages: args.pages });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    console.error(`bib query-source: ${describeError(error)}`);
    return 1;
  }
}
