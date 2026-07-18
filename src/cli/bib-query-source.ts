import { parseArgs as nodeParseArgs } from 'node:util';

import { describeError } from '@/bibliography/load-primitives';
import { PlaywrightBrowserSession } from '@/sourcequery/browser-session-playwright';
import { realClock, realSleep } from '@/sourcequery/clock';
import { SourceQueryClient } from '@/sourcequery/source-query-client';
import type { TailscaleRunner } from '@/sourcequery/tailscale-runner';
import type { OperatorPermissionRequest, QueryResult } from '@/sourcequery/types';

/** Parsed `bib query-source` argv. */
export interface QuerySourceArgs {
  sourceId: string;
  query: string;
  pages: number;
  /** Operator-approved exit node (ip or hostname) for the escalation re-invocation (FR-012). */
  approveExitNode?: string;
}

/**
 * A `TailscaleRunner` whose every method throws (fail-loud, Principle V).
 * `SourceQueryClient`'s escalation path (T019–T021) and this CLI's
 * `--approve-exit-node` wiring (T022) are both in place, but no production
 * `TailscaleRunner` that shells out to the real `tailscale` binary exists yet
 * in this codebase (only `FakeTailscaleRunner` in tests) — that CLI-facing
 * implementation is not covered by any task in tasks.md and is a tracked gap.
 * Until it lands, any real hard block surfaces as an honest "Tailscale
 * unavailable" failure (exit 1) rather than the exit-3 escalation.
 */
const unavailableTailscaleRunner: TailscaleRunner = {
  listExitNodes(): Promise<never> {
    return Promise.reject(
      new Error(
        'Tailscale exit-node escalation is not available: no production TailscaleRunner is wired into the CLI yet',
      ),
    );
  },
  currentExitNode(): Promise<never> {
    return Promise.reject(
      new Error(
        'Tailscale exit-node escalation is not available: no production TailscaleRunner is wired into the CLI yet',
      ),
    );
  },
  setExitNode(): Promise<never> {
    return Promise.reject(
      new Error(
        'Tailscale exit-node escalation is not available: no production TailscaleRunner is wired into the CLI yet',
      ),
    );
  },
};

/**
 * Parse `bib query-source <source-id> --query "<text>" [--pages <n>]`'s argv
 * slice. Throws (fail loud) on an unknown flag, a missing `--query`, a
 * missing `<source-id>` positional, or a non-numeric `--pages`.
 */
export function parseQuerySourceArgs(rest: string[]): QuerySourceArgs {
  const { values, positionals } = nodeParseArgs({
    args: rest,
    options: {
      query: { type: 'string' },
      pages: { type: 'string', default: '1' },
      'approve-exit-node': { type: 'string' },
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

  return {
    sourceId,
    query: values.query,
    pages,
    approveExitNode: values['approve-exit-node'],
  };
}

/**
 * Distinguishes the `query()` union without an `as` cast: an
 * `OperatorPermissionRequest` is the only member carrying `proposedNode`.
 */
function isPermissionRequest(
  result: QueryResult | OperatorPermissionRequest,
): result is OperatorPermissionRequest {
  return 'proposedNode' in result;
}

/**
 * `bib query-source <source-id> --query "<text>" [--pages <n>] [--approve-exit-node <node>]`:
 * the agent-facing entry point
 * (specs/014-source-query-client/contracts/cli-query-source.md, full US1+US2
 * contract).
 *
 * Argument parsing happens FIRST, before any client/browser construction, so
 * a usage error never launches a real browser.
 *
 * Exit codes: 0 success (result/empty, or a grace pass approved via
 * `--approve-exit-node`), 1 persistence/launch/ungrounded/unknown-source/
 * no-usable-node failure, 2 usage error, 3 hard block awaiting operator
 * approval (JSON `OperatorPermissionRequest` on stdout + a human-readable
 * escalation notice on stderr; the client NEVER switches the exit node
 * autonomously — FR-011/SC-003).
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
    const result = await client.query(args.sourceId, args.query, {
      pages: args.pages,
      approveExitNode: args.approveExitNode,
    });

    if (isPermissionRequest(result)) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      console.error(
        `bib query-source: source "${result.source}" is hard-blocked. Block evidence: ` +
          `${result.blockEvidence.evidencePath}. Proposed exit node: ${result.proposedNode.hostname} ` +
          `(${result.proposedNode.ip}, ${result.proposedNode.city}, ${result.proposedNode.country}). ` +
          `Switch command: ${result.switchCommand}. ${result.hostImpactWarning} If the operator ` +
          `approves, re-invoke with --approve-exit-node ${result.proposedNode.hostname}.`,
      );
      return 3;
    }

    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    console.error(`bib query-source: ${describeError(error)}`);
    return 1;
  }
}
