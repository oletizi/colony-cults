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
 *   persisted capture: we assert the count's digit sequence — allowing a single
 *   optional thousands separator between digits so a real "12,345" grounds a
 *   parsed `12345` — is present in the persisted bytes and THROW when it is not
 *   (fail-loud, separator-tolerant but still tied to the exact number).
 *
 * - `'derived-facts-only'` (retention-forbidden sources, e.g. Trove — FR-009):
 *   NOTHING is persisted. We parse the in-memory HTML and return only derived
 *   facts plus the required attribution; no raw bytes are retained. The SAME
 *   separator-tolerant grounding still applies against the in-memory fetched
 *   bytes: the count must be traceable in what was fetched, even though nothing
 *   is written to disk. We THROW when it is not.
 *
 * `capturedAtUtc` is always caller-supplied (never generated here) so the
 * module stays deterministic and testable.
 */

import { readFile } from 'node:fs/promises';
import { persistCapture } from '@/sourcequery/persistence';
import { isCountGrounded } from '@/sourcequery/grounding';
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
    // Grounding still applies (R7/FR-007): the count must be traceable in the
    // fetched bytes even though nothing is persisted. Separator-tolerant match
    // so a real "12,345" grounds a parsed 12345; THROW when absent (fail-loud).
    if (!isCountGrounded(pageResult.html, summary.count)) {
      throw new Error(
        `frugality: ungrounded count "${summary.count}" for derived-facts-only source ` +
          `"${config.id}" query "${query}": its digit sequence (allowing thousands separators) ` +
          `is not present in the fetched HTML bytes (verify-in-code grounding, FR-007).`,
      );
    }
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

  // Verify-in-code grounding (R7 / FR-007): the count's digit sequence MUST be
  // present in the persisted bytes. The match is separator-tolerant — it allows
  // a single optional thousands separator between digits — so a count parsed
  // from a real "12,345" (yielding 12345) still grounds against those bytes,
  // while remaining tied to the EXACT number (a different value cannot match).
  // If the value is not traceable in the saved capture we THROW rather than
  // return an ungrounded fact.
  if (!isCountGrounded(persistedHtml, summary.count)) {
    throw new Error(
      `frugality: ungrounded count "${summary.count}" for source "${config.id}" query "${query}": ` +
        `its digit sequence (allowing thousands separators) is not present in the persisted ` +
        `capture at ${capture.htmlPath} (verify-in-code grounding, FR-007).`,
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
