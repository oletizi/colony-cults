# Phase 1 Data Model: Asset Summaries

Entities are expressed as the archive artifacts + provenance fields + view-model additions the
feature reads and writes. No database — the SSOT is the filesystem archive + bibliography YAML,
consistent with the shipped OCR/translation model.

## Entity: Issue/Document Summary (artifact pair)

The per-unit finding-aid, written as two companion markdown files in the issue directory.

| Depth    | File (in `<issueDir>/`)          | Content |
|----------|----------------------------------|---------|
| Thorough | `issue.summary.long.en.md`       | YAML frontmatter (structured fields) + narrative prose body |
| Concise  | `issue.summary.short.en.md`      | Plain markdown, ~1–3 sentences (~60–80 words), distilled from thorough |

**Thorough frontmatter fields** (structured account, FR-001a; stable documented shape, FR-017):

- `topics`: string[] — salient subjects/themes.
- `people`: string[] — named persons.
- `places`: string[] — named locations.
- `dates`: string[] — notable dates/date-ranges referenced.
- `claims`: string[] — notable claims **recorded, not asserted** (Constitution I/II — no
  conversion to fact).

**Validation / invariants**:
- Concise MUST contain no claim absent from the thorough (SC-003; distillation invariant).
- Both files English (FR-002). Both machine-labeled interpretation (never evidence).
- Written **only** via `storeAsset` (Constitution XV — sidecar + manifest welded to the write).
- Relates to exactly one issue/document and its input text layers.

## Entity: Summary Provenance Sidecar

One `<artifact>.yml` per summary artifact (path via `companionYamlPath`). Extends the existing
`ProvenanceFields` (`src/archive/provenance.ts`) with the additive-optional convention.

| Field | Source | Notes |
|-------|--------|-------|
| `type` | set | `summary-thorough` \| `summary-concise` |
| `format` | set | `text/markdown` |
| `language` | set | `English` |
| `engine` | runner.name | e.g. `claude-code-cli` (provenance label) |
| `model` | resolved | default `claude-sonnet-5`, overridable |
| `retrieved` | clock | generation date |
| `interpretation` | set | `machine-generated-summary` — the "interpretation, not evidence" label (FR-005/006) |
| `input_layers` | computed | list of `{ path, sha256 }` for each input companion used (FR-005 + idempotency key) |
| `input_quality` | optional | `{ tier: low\|medium\|high, note }` — low-confidence note from input OCR (FR-016) |
| `object_store` | set | `null` (git-resident markdown, no B2 master) |
| inherited | source page companion | rights/catalog fields (id/title/case/rights_status…) derived, per `buildTranslationProvenance` idiom |

Built by `buildSummaryProvenance(base, depth, engineName, model, retrieved, inputLayers,
inputQuality?)`. Serialized by the canonical `writeProvenance` (no second serializer).

## Entity: Source Rollup Summary

Source-level concise + thorough abstract synthesized from the source's issue/document summaries.

| Depth    | File (source-level)              | Content |
|----------|----------------------------------|---------|
| Thorough | `source.summary.long.en.md`      | frontmatter (aggregated structured fields) + prose |
| Concise  | `source.summary.short.en.md`     | ~1–3 sentence landing abstract |

- **Cover-what-exists** (FR-009, clarified): synthesized from the available issue summaries; the
  sidecar records `covered_issues` and `missing_issues` (coverage provenance) rather than failing
  loud on partial coverage.
- Relates to one source and the set of issue summaries it covers.

## Entity: Input Text Layer (read-only, consumed)

The acquired text a summary is generated from — existing companions, not written by this feature:
`issue.txt` (OCR) with `issue.txt.yml`; `issue.en.txt` (English translation) with
`issue.en.txt.yml`. The `{path, sha256}` of each layer used is the idempotency key (Decision 4)
and is recorded in `input_layers`.

## Entity: Bibliography Reference (`summaryRef`)

An optional archive-relative **path string** on the source record pointing at the source rollup
thorough summary (`source.summary.long.en.md`). By-path pointer, mirroring the existing `census:`
idiom (`src/model/repository-record.ts`). The exhaustive prose is NEVER inlined (FR-007, SC-005).

- Written in the same operation as the rollup it references (Constitution XV — no dangling ref).
- A light validation asserts `summaryRef` resolves to an existing artifact (Decision 5).

## Entity: SummarizationRunner (engine interface)

The injected engine (contract in `contracts/summarization-runner.md`). Turns input text into the
two-depth summary; swappable via `createSummarizer(name)`; dedicated (NOT the spec-014
source-query client, FR-012). Default model `claude-sonnet-5`, configurable (flag > config >
default), mirroring `src/engine/config.ts`.

## State / lifecycle

Per issue: `absent` → (has usable text?) → `generated` (both artifacts + sidecars + manifest) |
`failed-loud` (no text: descriptive error, zero artifacts). `generated` → (input layer sha
changed?) → `stale` → regenerate. Idempotent: `up-to-date` inputs → `skipped` (no LLM call).
