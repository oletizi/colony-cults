/**
 * Frugality: persist-then-parse with verify-in-code grounding (Phase 1, T012).
 *
 * Two retention regimes (data-model.md § QueryResult, research.md R5/R7,
 * FR-007/FR-009):
 *
 * - `'persist'` (the normal path): the raw HTML + accessibility snapshot are
 *   written to disk BEFORE any parsing (R5). Parsing then reads the PERSISTED
 *   copy back (not the live DOM), so the returned fact and the saved evidence
 *   are the same bytes (R7). Every summary fact must be grep-traceable in that
 *   persisted capture: we assert the count's plain-digit string is a literal
 *   substring of the persisted bytes and THROW when it is not (fail-loud).
 *
 * - `'derived-facts-only'` (retention-forbidden sources, e.g. Trove — FR-009):
 *   NOTHING is persisted. We parse the in-memory HTML and return only derived
 *   facts plus the required attribution; no raw bytes are retained.
 *
 * `capturedAtUtc` is always caller-supplied (never generated here) so the
 * module stays deterministic and testable.
 */

import { readFile } from 'node:fs/promises';
import { persistCapture } from '@/sourcequery/persistence';
import type { SourceConfig } from '@/sourcequery/source-config';
import type { PageResult, QueryResult } from '@/sourcequery/types';

/** Input to {@link persistThenParse}. */
export interface PersistThenParseArgs {
  /** The already-navigated page (raw HTML + accessibility snapshot). */
  pageResult: PageResult;
  /** The source config governing retention + parsing. */
  config: SourceConfig;
  /** The query string that produced this page. */
  query: string;
  /** The queried URL. */
  url: string;
  /** ISO UTC timestamp, injected by the caller (never generated here). */
  capturedAtUtc: string;
  /** Base dir the `bibliography/...` tree is rooted at (forwarded to persistCapture). */
  baseDir?: string;
}

/**
 * Persist (when allowed) then parse a fetched page into a {@link QueryResult}.
 *
 * The `'persist'` branch writes evidence first, re-reads it, parses from the
 * saved copy, and verifies the count is grounded in those bytes. The
 * `'derived-facts-only'` branch persists nothing and returns derived facts +
 * attribution.
 */
export async function persistThenParse(args: PersistThenParseArgs): Promise<QueryResult> {
  const { pageResult, config, query, url, capturedAtUtc, baseDir } = args;

  if (config.retention === 'derived-facts-only') {
    // Retention-forbidden source (FR-009): persist nothing, write no files.
    const summary = config.parseSummary(pageResult.html);
    return {
      summary,
      derivedFacts: summary.candidates,
      attribution: config.attribution,
      source: config.id,
      query,
      retention: 'derived-facts-only',
    };
  }

  // 'persist' branch: write evidence BEFORE parsing (R5). This throws on write
  // failure (fail-loud, Principle V) — let it propagate.
  const capture = await persistCapture({
    source: config.id,
    query,
    url,
    html: pageResult.html,
    snapshotMarkdown: pageResult.snapshotMarkdown,
    capturedAtUtc,
    baseDir,
  });

  // Parse from the PERSISTED copy, not the live DOM (R7): the returned fact and
  // the on-disk evidence are then guaranteed to be the same bytes.
  const persistedHtml = await readFile(capture.htmlPath, 'utf-8');
  const summary = config.parseSummary(persistedHtml);

  // Verify-in-code grounding (R7 / FR-007): the count's plain-digit string form
  // (`String(count)`) MUST appear literally in the persisted bytes. Source
  // `parseSummary` implementations are therefore responsible for yielding a
  // count whose `String(count)` form is present in the HTML (e.g. extract plain
  // digits; stripping any thousands separators is the source config's job). If
  // the value is not grep-traceable in the saved capture we THROW rather than
  // return an ungrounded fact.
  const countString = String(summary.count);
  if (!persistedHtml.includes(countString)) {
    throw new Error(
      `frugality: ungrounded count "${countString}" for source "${config.id}" query "${query}": ` +
        `its String(count) form is not a literal substring of the persisted capture at ` +
        `${capture.htmlPath}. A source parseSummary MUST yield a count whose String(count) ` +
        `form appears literally in the persisted bytes (verify-in-code grounding, FR-007).`,
    );
  }

  return {
    summary,
    captures: [capture],
    source: config.id,
    query,
    retention: 'persist',
  };
}
