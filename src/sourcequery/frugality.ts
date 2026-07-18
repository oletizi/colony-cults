/**
 * Frugality: verify-in-code grounding for the two retention regimes (Phase 1,
 * T012), split so that persistence happens BEFORE analysis (Principle XII).
 *
 * Two retention regimes (data-model.md § QueryResult, research.md R5/R7,
 * FR-007/FR-009):
 *
 * - `'persist'` (the normal path): the raw HTML + accessibility snapshot are
 *   written to disk by the caller (via `persistCapture`) BEFORE any parsing
 *   (R5) — this module never writes. {@link groundedResultFromCapture} then
 *   reads the ALREADY-PERSISTED copy back (not the live DOM), parses it, and
 *   verifies the count against those exact bytes, so the returned fact and the
 *   saved evidence are the same bytes (R7). Every summary fact must be
 *   grep-traceable in that persisted capture: we assert the count's digit
 *   sequence — allowing a single optional thousands separator between digits so
 *   a real "12,345" grounds a parsed `12345` — is present in the persisted
 *   bytes and THROW when it is not (fail-loud, separator-tolerant but still
 *   tied to the exact number).
 *
 * - `'derived-facts-only'` (retention-forbidden sources, e.g. Trove — FR-009):
 *   NOTHING is persisted. {@link derivedFactsResult} parses the in-memory HTML
 *   and returns only derived facts plus the required attribution; no raw bytes
 *   are retained. The SAME separator-tolerant grounding still applies against
 *   the in-memory fetched bytes: the count must be traceable in what was
 *   fetched, even though nothing is written to disk. We THROW when it is not.
 *
 * `capturedAtUtc` is always caller-supplied (never generated here) so the
 * pass stays deterministic and testable; forming it from the injected clock is
 * the composition layer's job.
 */

import { readFile } from 'node:fs/promises';
import { isCountGrounded } from '@/sourcequery/grounding';
import type { SourceConfig } from '@/sourcequery/source-config';
import type { PageResult, PersistedCapture, QueryResult } from '@/sourcequery/types';

/** Input to {@link groundedResultFromCapture}. */
export interface GroundedResultFromCaptureArgs {
  /** The capture already written to disk (persist-before-analysis, R5). */
  capture: PersistedCapture;
  /** The source config governing parsing (retention MUST be `'persist'`). */
  config: SourceConfig;
  /** The query string that produced this page. */
  query: string;
}

/**
 * Parse + verify-in-code grounding for a persist-retention source from a capture
 * ALREADY written to disk (persist-before-analysis, R5/Principle XII). The
 * caller persists the raw page first (via `persistCapture`), then hands the
 * resulting {@link PersistedCapture} here.
 *
 * Reads the persisted HTML back (not the live DOM, R7), parses it, and verifies
 * the count's digit sequence is present in those exact bytes — separator-tolerant
 * so a count parsed from a real "12,345" (yielding 12345) still grounds against
 * those bytes, while remaining tied to the EXACT number. THROWS (fail-loud, no
 * ungrounded fact returned) when the value is not traceable in the saved capture.
 * Does NOT write anything (the bytes are already on disk — no double-write).
 */
export async function groundedResultFromCapture(
  args: GroundedResultFromCaptureArgs,
): Promise<QueryResult> {
  const { capture, config, query } = args;

  const persistedHtml = await readFile(capture.htmlPath, 'utf-8');
  const summary = config.parseSummary(persistedHtml);

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

/** Input to {@link derivedFactsResult}. */
export interface DerivedFactsResultArgs {
  /** The already-navigated page (raw HTML + accessibility snapshot). */
  pageResult: PageResult;
  /** The source config (retention MUST be `'derived-facts-only'`). */
  config: SourceConfig;
  /** The query string that produced this page. */
  query: string;
}

/**
 * Parse + verify-in-code grounding for a retention-forbidden source (FR-009):
 * persist NOTHING, parse the in-memory HTML, ground the count against the fetched
 * bytes, and return derived facts plus the required attribution. THROWS
 * (fail-loud) when the count is not traceable in the fetched bytes even though
 * nothing is written to disk.
 */
export function derivedFactsResult(args: DerivedFactsResultArgs): QueryResult {
  const { pageResult, config, query } = args;

  const summary = config.parseSummary(pageResult.html);
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
