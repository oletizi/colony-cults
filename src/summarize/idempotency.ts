import { existsSync } from 'node:fs';
import { companionYamlPath } from '@/archive/store';
import { readProvenance } from '@/archive/provenance';
import { issueThoroughSummaryPath } from '@/summarize/artifacts';
import type { SelectedInputLayer } from '@/summarize/select-input';

/**
 * The three-way classification of one issue's summary state against its
 * currently-selected input layers (US5, FR-010, research.md Decision 4):
 *
 * - `'fresh'`: no thorough summary artifact/sidecar exists yet for this
 *   issue -- this is a first generation, not a change-triggered regeneration.
 * - `'stale'`: a thorough summary sidecar exists, but at least one selected
 *   input layer's `{path, sha256}` no longer matches what it recorded (the
 *   OCR or translation changed since the summary was generated) -- or the
 *   sidecar has no `input_layers` block at all (an older/foreign record).
 * - `'up-to-date'`: a thorough summary sidecar exists AND every selected
 *   input layer's `{path, sha256}` matches its recorded `input_layers`
 *   entry, in order -- regenerating would be redundant.
 */
export type SummaryFreshness = 'up-to-date' | 'stale' | 'fresh';

/** Result of {@link checkSummaryFreshness}. */
export interface SummaryIdempotencyCheck {
  readonly freshness: SummaryFreshness;
}

/**
 * Compare the CURRENTLY selected input layers (freshly hashed by
 * {@link import('@/summarize/select-input').selectSummaryInput}) against the
 * `input_layers` recorded in an issue's existing thorough-summary sidecar,
 * and classify the result (US5, FR-010).
 *
 * This is the formalized, dedicated idempotency key extracted from
 * `summarizeIssue`'s inline comparison (`src/summarize/issue.ts` T014-era
 * `isUpToDate`) -- the single source of truth both `summarizeIssue` (T034)
 * and any future rollup staleness check consult, so the "which layers were
 * used, and have they changed" comparison is defined and tested in exactly
 * one place.
 *
 * FAILS LOUD only on genuinely corrupt state: a thorough-summary sidecar
 * that EXISTS on disk but cannot be parsed (`readProvenance` throws) is a
 * real defect in recorded state, not mere absence, so the error propagates
 * rather than being silently swallowed into a "not up to date" verdict (a
 * swallow would mask corruption behind an ordinary-looking regeneration).
 * Absence of the sidecar entirely (`'fresh'`), or a parseable sidecar that
 * simply lacks an `input_layers` block or has a different layer count/shas
 * (`'stale'`), are both ordinary, expected outcomes -- never a throw.
 */
export async function checkSummaryFreshness(
  issueDir: string,
  layers: readonly SelectedInputLayer[],
): Promise<SummaryIdempotencyCheck> {
  const yamlPath = companionYamlPath(issueThoroughSummaryPath(issueDir));
  if (!existsSync(yamlPath)) {
    return { freshness: 'fresh' };
  }

  // The sidecar exists: let a parse failure propagate (genuinely corrupt
  // state), rather than catching it here.
  const existing = await readProvenance(yamlPath);
  const recorded = existing.input_layers;

  if (recorded === undefined || recorded.length !== layers.length) {
    return { freshness: 'stale' };
  }

  const matches = layers.every(
    (layer, i) => recorded[i]?.path === layer.path && recorded[i]?.sha256 === layer.sha256,
  );
  return { freshness: matches ? 'up-to-date' : 'stale' };
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
