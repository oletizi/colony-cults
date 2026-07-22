import { existsSync } from 'node:fs';
import { companionYamlPath } from '@/archive/store';
import { readProvenance } from '@/archive/provenance';
import { issueConciseSummaryPath, issueThoroughSummaryPath } from '@/summarize/artifacts';
import type { SelectedInputLayer } from '@/summarize/select-input';

/**
 * The three-way classification of one issue's summary state against its
 * currently-selected input layers (US5, FR-010, research.md Decision 4):
 *
 * - `'fresh'`: NEITHER the thorough nor the concise summary artifact/sidecar
 *   exists yet for this issue -- this is a first generation, not a
 *   change-triggered regeneration.
 * - `'stale'`: at least one of the two sidecars is missing, parses fine but
 *   lacks an `input_layers` block, or has an `input_layers` that no longer
 *   matches every currently-selected input layer's `{path, sha256}` (the OCR
 *   or translation changed since the summary was generated) -- INCLUDING the
 *   half-written-pair case (AUDIT-20260722-07): one artifact was written and
 *   the other was not, e.g. a run interrupted between the two `storeAsset`
 *   calls in `summarizeIssue`. A half-written pair must regenerate, not be
 *   treated as up-to-date, or the missing half is permanently lost until
 *   `--force`.
 * - `'up-to-date'`: BOTH the thorough AND the concise sidecar exist, AND
 *   BOTH record every selected input layer's `{path, sha256}`, in order --
 *   regenerating would be redundant.
 */
export type SummaryFreshness = 'up-to-date' | 'stale' | 'fresh';

/** Per-artifact freshness of one sidecar against the currently-selected input layers. */
async function checkArtifactFreshness(
  yamlPath: string,
  layers: readonly SelectedInputLayer[],
): Promise<SummaryFreshness> {
  if (!existsSync(yamlPath)) {
    return 'fresh';
  }

  // The sidecar exists: let a parse failure propagate (genuinely corrupt
  // state), rather than catching it here.
  const existing = await readProvenance(yamlPath);
  const recorded = existing.input_layers;

  if (recorded === undefined || recorded.length !== layers.length) {
    return 'stale';
  }

  const matches = layers.every(
    (layer, i) => recorded[i]?.path === layer.path && recorded[i]?.sha256 === layer.sha256,
  );
  return matches ? 'up-to-date' : 'stale';
}

/** Result of {@link checkSummaryFreshness}. */
export interface SummaryIdempotencyCheck {
  readonly freshness: SummaryFreshness;
}

/**
 * Compare the CURRENTLY selected input layers (freshly hashed by
 * {@link import('@/summarize/select-input').selectSummaryInput}) against the
 * `input_layers` recorded in an issue's existing thorough AND concise summary
 * sidecars, and classify the result (US5, FR-010, AUDIT-20260722-07).
 *
 * This is the formalized, dedicated idempotency key extracted from
 * `summarizeIssue`'s inline comparison (`src/summarize/issue.ts` T014-era
 * `isUpToDate`) -- the single source of truth both `summarizeIssue` (T034)
 * and any future rollup staleness check consult, so the "which layers were
 * used, and have they changed" comparison is defined and tested in exactly
 * one place.
 *
 * BOTH-ARTIFACT REQUIREMENT (AUDIT-20260722-07): `summarizeIssue` writes the
 * thorough artifact and the concise artifact as two SEPARATE `storeAsset`
 * calls (non-atomic across the pair). If a run is interrupted after the
 * thorough write but before the concise write, checking ONLY the thorough
 * sidecar would report `'up-to-date'` on the next run and skip -- leaving the
 * concise summary PERMANENTLY missing until `--force`. To close that gap,
 * this reports `'up-to-date'` iff BOTH sidecars exist and BOTH match every
 * selected layer; any other combination (one missing, one stale, or a
 * mismatched pair) is `'stale'`, so a half-written pair always regenerates.
 * `'fresh'` is reserved for the case where NEITHER sidecar exists at all
 * (a genuine first generation, not an interrupted one).
 *
 * FAILS LOUD only on genuinely corrupt state: a sidecar that EXISTS on disk
 * but cannot be parsed (`readProvenance` throws) is a real defect in
 * recorded state, not mere absence, so the error propagates rather than
 * being silently swallowed into a "not up to date" verdict (a swallow would
 * mask corruption behind an ordinary-looking regeneration). Absence of a
 * sidecar entirely, or a parseable sidecar that simply lacks an
 * `input_layers` block or has a different layer count/shas, are both
 * ordinary, expected outcomes -- never a throw.
 */
export async function checkSummaryFreshness(
  issueDir: string,
  layers: readonly SelectedInputLayer[],
): Promise<SummaryIdempotencyCheck> {
  const thoroughYamlPath = companionYamlPath(issueThoroughSummaryPath(issueDir));
  const conciseYamlPath = companionYamlPath(issueConciseSummaryPath(issueDir));

  const [thorough, concise] = await Promise.all([
    checkArtifactFreshness(thoroughYamlPath, layers),
    checkArtifactFreshness(conciseYamlPath, layers),
  ]);

  if (thorough === 'up-to-date' && concise === 'up-to-date') {
    return { freshness: 'up-to-date' };
  }
  if (thorough === 'fresh' && concise === 'fresh') {
    return { freshness: 'fresh' };
  }
  // Any other combination -- one artifact missing while the other exists
  // (the interrupt case, either direction), a stale layer match on either
  // side, or a mismatched pair -- must regenerate.
  return { freshness: 'stale' };
}

/**
 * Convenience boolean wrapper over {@link checkSummaryFreshness} for the
 * common "should I skip?" call site (`summarizeIssue`'s force-guard, T034):
 * `true` iff `freshness === 'up-to-date'`. Corrupt-state errors from
 * {@link checkSummaryFreshness} still propagate (fail loud) -- this only
 * collapses the ordinary `'fresh'` / `'stale'` outcomes to `false`.
 */
export async function summaryIsUpToDate(
  issueDir: string,
  layers: readonly SelectedInputLayer[],
): Promise<boolean> {
  const { freshness } = await checkSummaryFreshness(issueDir, layers);
  return freshness === 'up-to-date';
}
