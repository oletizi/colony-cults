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
import type { LoadedSummary, MachineAssistLabel } from '@/browser/model';
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

/** Shared load: pairs the concise markdown at `mdPath` with its sidecar label. */
function loadSummaryArtifact(mdPath: string): LoadedSummary | null {
  if (!existsSync(mdPath)) {
    return null;
  }

  const concise = readFileSync(mdPath, 'utf-8').trim();
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
