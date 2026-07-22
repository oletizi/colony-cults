import path from 'node:path';
import type { InputLayer, InputQuality, ProvenanceFields } from '@/archive/provenance';
import { quotedScalar } from '@/archive/provenance-blocks';
import type { StructuredSummaryFields, SummaryResult } from '@/summarize/types';

/** Which depth a summary artifact/provenance record is for (data-model.md). */
export type SummaryDepth = 'thorough' | 'concise';

/**
 * Absolute path of the whole-issue thorough summary artifact:
 * `<issueDir>/issue.summary.long.en.md` (contracts/summary-artifacts.md).
 */
export function issueThoroughSummaryPath(issueDir: string): string {
  return path.join(issueDir, 'issue.summary.long.en.md');
}

/**
 * Absolute path of the whole-issue concise summary artifact:
 * `<issueDir>/issue.summary.short.en.md` (contracts/summary-artifacts.md).
 */
export function issueConciseSummaryPath(issueDir: string): string {
  return path.join(issueDir, 'issue.summary.short.en.md');
}

/**
 * Absolute path of the source-rollup thorough summary artifact:
 * `<sourceDir>/source.summary.long.en.md` (contracts/summary-artifacts.md).
 */
export function sourceThoroughSummaryPath(sourceDir: string): string {
  return path.join(sourceDir, 'source.summary.long.en.md');
}

/**
 * Absolute path of the source-rollup concise summary artifact:
 * `<sourceDir>/source.summary.short.en.md` (contracts/summary-artifacts.md).
 */
export function sourceConciseSummaryPath(sourceDir: string): string {
  return path.join(sourceDir, 'source.summary.short.en.md');
}

/**
 * Render one YAML frontmatter list field as a block sequence of quoted
 * scalars (deterministic, no flow-style ambiguity): `key: []` when empty,
 * else `key:` followed by one `  - "value"` line per entry.
 */
function renderFrontmatterList(key: string, values: readonly string[]): string {
  if (values.length === 0) {
    return `${key}: []`;
  }
  const items = values.map((value) => `  - ${quotedScalar(value)}`).join('\n');
  return `${key}:\n${items}`;
}

/**
 * Render the thorough summary's YAML frontmatter block (data-model.md
 * "Thorough frontmatter fields"): `topics`/`people`/`places`/`dates`/`claims`,
 * each a deterministic block sequence in that fixed order. `claims` are
 * recorded, not asserted (Constitution I/II).
 */
function renderStructuredFrontmatter(structured: StructuredSummaryFields): string {
  return [
    renderFrontmatterList('topics', structured.topics),
    renderFrontmatterList('people', structured.people),
    renderFrontmatterList('places', structured.places),
    renderFrontmatterList('dates', structured.dates),
    renderFrontmatterList('claims', structured.claims),
  ].join('\n');
}

/**
 * Render the thorough summary markdown artifact: YAML frontmatter (structured
 * fields) delimited by `---` lines, followed by the narrative prose body
 * (contracts/summary-artifacts.md "Thorough artifact format").
 */
export function renderThoroughMarkdown(result: SummaryResult): string {
  const frontmatter = renderStructuredFrontmatter(result.structured);
  return `---\n${frontmatter}\n---\n\n${result.thoroughBody}\n`;
}

/**
 * Render the concise summary markdown artifact: plain markdown, no
 * frontmatter (contracts/summary-artifacts.md "Concise artifact format").
 */
export function renderConciseMarkdown(result: SummaryResult): string {
  return `${result.concise}\n`;
}

/**
 * Render the source-ROLLUP thorough summary markdown artifact (US4, FR-009):
 * the same structured-frontmatter + prose shape as {@link renderThoroughMarkdown},
 * PLUS two rollup-only frontmatter fields recording cover-what-exists coverage
 * -- `covered_issues` (issue arks whose thorough summary was folded into this
 * rollup) and `missing_issues` (issue arks discovered for the source but not
 * yet summarized, so the rollup covers what exists rather than failing loud
 * on partial coverage). Recorded here in the human-readable markdown
 * frontmatter for convenience, but the CANONICAL machine-readable coverage
 * contract now lives as the structured `covered_issues` / `missing_issues`
 * fields on the rollup provenance SIDECAR (AUDIT-20260722-09,
 * contracts/summary-artifacts.md "Rollup sidecars additionally carry ...") --
 * see where `summarizeSource` (`src/summarize/source-rollup.ts`) sets them on
 * both rollup sidecars via `ProvenanceFields`.
 */
export function renderRollupThoroughMarkdown(
  result: SummaryResult,
  coveredIssues: readonly string[],
  missingIssues: readonly string[],
): string {
  const frontmatter = [
    renderStructuredFrontmatter(result.structured),
    renderFrontmatterList('covered_issues', coveredIssues),
    renderFrontmatterList('missing_issues', missingIssues),
  ].join('\n');
  return `---\n${frontmatter}\n---\n\n${result.thoroughBody}\n`;
}

/**
 * Build a NEW {@link ProvenanceFields} record for a summary artifact
 * (data-model.md "Summary Provenance Sidecar"), derived from the source
 * page's provenance `base` without mutating it -- mirrors
 * `buildTranslationProvenance` (src/translate/artifacts.ts).
 *
 * Field-by-field mapping:
 * - `type`: `'summary-thorough'` or `'summary-concise'` per `depth`.
 * - `format`: fixed `'text/markdown'` (these are markdown artifacts).
 * - `language`: fixed `'English'` -- both summary depths are always English
 *   (FR-002), unlike a translation artifact whose `corrected-french` kind
 *   carries the source language through.
 * - `engine` / `model` / `retrieved`: the run's engine label, resolved model,
 *   and injected clock, passed in by the caller (never read from `base`,
 *   which describes the SOURCE text layer's fetch, not this derived summary).
 * - `interpretation`: constant `'machine-generated-summary'` -- the
 *   "interpretation, not evidence" label (FR-005/006).
 * - `input_layers`: the `{path, sha256}` pairs of the input text layers this
 *   summary was generated from (FR-005 + idempotency key), passed through
 *   verbatim from the caller.
 * - `input_quality`: set only when the caller passes it (FR-016, low-input-OCR
 *   caveat); omitted (not present) when not provided, per the additive
 *   OPTIONAL convention.
 * - `title` / `catalog_url` / `source_archive` / `original_url`: the source
 *   citation, carried verbatim from `base`.
 * - `rights_status`: copied from `base`; the caller is responsible for the
 *   rights gate, this function only carries the value through.
 * - `id` / `case` / `notes` / `rights_raw` / `ocr_status`: carried as-is from
 *   `base` -- there is no separate identity for a derived summary artifact,
 *   so it inherits the source page's.
 * - `local_path` / `sha256`: carried from `base` as PLACEHOLDERS ONLY.
 *   `storeAsset` (src/archive/store.ts) always overwrites both from the
 *   actual bytes and target path at write time.
 * - `size`: placeholder `0`, same convention as `buildTranslationProvenance`
 *   -- `storeAsset` re-derives the real byte count at write time.
 * - `object_store`: fixed `null` -- a git-resident markdown artifact, no B2
 *   master (data-model.md table).
 */
export function buildSummaryProvenance(
  base: ProvenanceFields,
  depth: SummaryDepth,
  engineName: string,
  model: string,
  retrieved: string,
  inputLayers: InputLayer[],
  inputQuality?: InputQuality,
): ProvenanceFields {
  return {
    id: base.id,
    title: base.title,
    type: depth === 'thorough' ? 'summary-thorough' : 'summary-concise',
    case: base.case,
    language: 'English',
    source_archive: base.source_archive,
    catalog_url: base.catalog_url,
    original_url: base.original_url,
    rights_status: base.rights_status,
    retrieved,
    local_path: base.local_path,
    sha256: base.sha256,
    // `size` and `object_store` are placeholders here: `storeAsset` overwrites
    // both at write time (size = actual byte count; object_store stays null
    // for a git-resident markdown artifact), the same way it fills
    // `sha256`/`local_path`.
    size: 0,
    object_store: null,
    format: 'text/markdown',
    ocr_status: base.ocr_status,
    engine: engineName,
    model,
    interpretation: 'machine-generated-summary',
    input_layers: inputLayers,
    input_quality: inputQuality,
    notes: base.notes,
    rights_raw: base.rights_raw,
  };
}
