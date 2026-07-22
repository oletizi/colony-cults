/**
 * Loads a unit's concise machine-generated summary -- the per-issue abstract
 * (`issue.summary.short.en.md`) or the per-source rollup abstract
 * (`source.summary.short.en.md`) -- from the archive, pairing it with the
 * `MachineAssistLabel` (engine/model/retrieved) read from its provenance
 * sidecar (`companionYamlPath`).
 *
 * Mirrors `src/browser/load/translation.ts`: honest-absence semantics (see
 * specs/017-asset-summaries/contracts/browser-view.md). A missing concise
 * artifact is a normal, expected state (not every issue/source has been
 * summarized yet) -> `null`, never fabricated. A PRESENT artifact with a
 * missing or corrupt sidecar is a data-integrity defect, not absence -> throws
 * (fail loud) -- unlike `translation.ts`'s OPTIONAL machine-assist label,
 * `LoadedSummary.label` is a REQUIRED field, so there is no honest partial
 * state once the concise artifact exists.
 */

import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { LoadedSummary, MachineAssistLabel, RawIssue, RawSource } from '@/browser/model';
import { companionYamlPath } from '@/archive/store';
import { issueConciseSummaryPath, sourceConciseSummaryPath } from '@/summarize/artifacts';

/**
 * Loads `issueDir`'s per-issue concise abstract (`issue.summary.short.en.md`)
 * + its provenance sidecar.
 *
 * @returns `null` when the concise artifact is absent (graceful no-summary
 *   state, US2 AC-3).
 * @throws Error when the concise artifact is present but its sidecar is
 *   missing, unparseable, or lacks a required `engine`/`retrieved` field.
 */
export function loadIssueSummary(issueDir: string): LoadedSummary | null {
  return loadSummaryArtifact(issueConciseSummaryPath(issueDir));
}

/**
 * Loads `sourceDir`'s source-rollup concise abstract
 * (`source.summary.short.en.md`) + its provenance sidecar.
 *
 * @returns `null` when the concise rollup artifact is absent.
 * @throws Error when the concise artifact is present but its sidecar is
 *   missing, unparseable, or lacks a required `engine`/`retrieved` field.
 */
export function loadSourceSummary(sourceDir: string): LoadedSummary | null {
  return loadSummaryArtifact(sourceConciseSummaryPath(sourceDir));
}

/**
 * Attaches `issue`'s per-issue concise summary (loaded from `issueDir`) when
 * present, omitting the key entirely when absent -- the additive,
 * omit-when-absent convention {@link RawIssue.conciseSummary} documents.
 *
 * This is the ONE enrichment site every {@link RawIssue} builder MUST route
 * through (the standard Gallica periodical/monograph loader AND the Papers
 * Past clipping loader), so a loader cannot silently diverge and build an
 * issue that never gets a chance to carry its summary (AUDIT-20260722-01:
 * the Papers Past loader built its `RawIssue` inline and skipped this call
 * entirely, so even a present `issue.summary.short.en.md` rendered as
 * "No summary yet").
 */
export function attachIssueSummary(issue: RawIssue, issueDir: string): RawIssue {
  const conciseSummary = loadIssueSummary(issueDir);
  return conciseSummary === null ? issue : { ...issue, conciseSummary };
}

/**
 * Attaches `source`'s rollup concise summary (loaded from `sourceDir`) when
 * present, omitting the key entirely when absent. The {@link RawSource}
 * counterpart to {@link attachIssueSummary} -- see that doc comment for why
 * every source builder MUST route through this shared site.
 */
export function attachSourceSummary(source: RawSource, sourceDir: string): RawSource {
  const conciseSummary = loadSourceSummary(sourceDir);
  return conciseSummary === null ? source : { ...source, conciseSummary };
}

/** Shared load: pairs the concise markdown at `mdPath` with its sidecar label. */
function loadSummaryArtifact(mdPath: string): LoadedSummary | null {
  if (!existsSync(mdPath)) {
    return null;
  }

  const concise = readFileSync(mdPath, 'utf-8').trim();
  if (concise.length === 0) {
    // A present-but-empty (or whitespace-only) concise artifact is corruption,
    // not honest absence -- honest absence is the file not existing, which is
    // already handled above by returning null. Fail loud here rather than let
    // an empty string masquerade as a valid summary: this also keeps the
    // loader symmetric with `parseLoadedSummary`'s `requireString(record,
    // 'concise', where)` on the snapshot-parse side (AUDIT-06,
    // snapshot-guards.ts), which REJECTS an empty string -- if this loader
    // instead accepted one, the resulting snapshot would serialize
    // `concise: ''` and crash on the very next load.
    throw new Error(
      `loadSummaryArtifact: concise summary ${mdPath} is present but empty (or whitespace-only) ` +
        '-- fail loud rather than treat a corrupt artifact as a valid summary.'
    );
  }
  const label = loadRequiredLabel(mdPath);
  return { concise, label };
}

/**
 * Reads the REQUIRED machine-assist label (`engine`/`model`/`retrieved`) from
 * `mdPath`'s companion sidecar. Unlike `translation.ts`'s
 * `loadMachineAssist` (which returns `null` on an absent/incomplete sidecar,
 * because the label there is an optional supplement to already-required
 * provenance), a `LoadedSummary` has no other content to fall back on once
 * the concise artifact exists -- so an absent or incomplete sidecar here is a
 * data-integrity defect and throws.
 */
function loadRequiredLabel(mdPath: string): MachineAssistLabel {
  const sidecarPath = companionYamlPath(mdPath);
  if (!existsSync(sidecarPath)) {
    throw new Error(
      `loadSummaryArtifact: concise summary ${mdPath} is present but its provenance sidecar ` +
        `${sidecarPath} is missing -- fail loud rather than render an unlabeled summary.`
    );
  }

  const parsed: unknown = parse(readFileSync(sidecarPath, 'utf-8'));
  if (!isRecord(parsed)) {
    throw new Error(`loadSummaryArtifact: sidecar ${sidecarPath} did not parse to a YAML mapping.`);
  }

  return {
    engine: requireStringField(parsed, 'engine', sidecarPath),
    model: optionalStringField(parsed, 'model'),
    retrieved: requireStringField(parsed, 'retrieved', sidecarPath),
  };
}

/** A non-empty string field, or `null` when the field is absent/blank/non-string. */
function optionalStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function requireStringField(
  record: Record<string, unknown>,
  field: string,
  sidecarPath: string
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `loadSummaryArtifact: sidecar ${sidecarPath} is missing required field "${field}"`
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
