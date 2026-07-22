# Quickstart: Asset Summaries — end-to-end validation

Runnable scenarios that prove the feature works. Details live in contracts/ and data-model.md;
this is the run/validate guide. Runtime: `tsx` (never `ts-node`); tests via `vitest` (`npm test`).

## Prerequisites

- An acquired issue directory with at least one usable text layer (`issue.txt`, and for a French
  source `issue.en.txt`) plus their `.yml` companions — as produced by the shipped OCR/translation
  pipelines. Use a temp archive dir seeded from a fixture for tests (mirror
  `tests/integration/translate-issue.test.ts`).
- The `claude` CLI available on PATH (preflight `assertClaudeAvailable`), OR a fake
  `SummarizationRunner` for tests.

## Scenario 1 — Generate a per-issue two-depth summary (US1, FR-001/004/005)

```bash
bib summarize PB-P001 <issueArk>
```

**Expected**: `issue.summary.long.en.md` (frontmatter with topics/people/places/dates/claims +
prose) and `issue.summary.short.en.md` (~1–3 sentences) written to the issue dir, each with a
`.yml` sidecar carrying `interpretation: machine-generated-summary`, `engine`, `model`,
`input_layers` (with shas), and a `manifests/MANIFEST.sha256` entry. The concise introduces no
claim absent from the thorough.

## Scenario 2 — Fail loud on no usable text (US1 AC-3, FR-003)

Point `bib summarize` at an issue with no `issue.txt` and no `issue.en.txt`.

**Expected**: non-zero exit, a descriptive error naming the missing text layer, and **zero**
summary artifacts written.

## Scenario 3 — Best-available-text selection (FR-002)

For a French source with both `issue.txt` and `issue.en.txt`.

**Expected**: English output; the sidecar `input_layers` lists BOTH the French OCR and the English
translation companions (with their shas).

## Scenario 4 — Idempotent skip + input-change regeneration (US5, FR-010)

```bash
bib summarize PB-P001 <issueArk>     # first run: generates
bib summarize PB-P001 <issueArk>     # second run: skips (no LLM call)
# mutate issue.en.txt (re-translate), then:
bib summarize PB-P001 <issueArk>     # regenerates that issue only
```

**Expected**: run 2 performs zero regeneration (input shas match); after the input layer changes,
run 3 regenerates and updates the sidecar shas. (Test template:
`tests/integration/translate-idempotent.test.ts`.)

## Scenario 5 — Noisy-OCR flag (FR-016)

Summarize an issue whose input OCR companion has `ocr_quality.tier: low`.

**Expected**: the summary is still generated, and its sidecar carries
`input_quality: { tier: low, note: ... }`. Generation is not blocked.

## Scenario 6 — Per-source rollup + bibliography reference (US3/US4, FR-007/009)

```bash
bib summarize-source PB-P001
```

**Expected**: `source.summary.long.en.md` + `source.summary.short.en.md` written (rollup sidecar
records `covered_issues`/`missing_issues`); the `bibliography/sources/PB-P001.yml` gains a
`summaryRef` path pointing at the rollup thorough summary; the source YAML contains **no** inlined
summary prose (SC-005). Partial coverage does not error.

## Scenario 7 — Website reads the concise abstract (US2, FR-008)

Load the corpus-browser data layer; confirm `IssueView.conciseSummary` / `SourceView.conciseSummary`
populate for summarized units and are `null` (graceful) for unsummarized ones. The rendered UI is
built and validated through `/frontend-design:frontend-design` (Constitution XI) — not here.

## Constitution XV weld check

Confirm there is no code path that writes a summary artifact WITHOUT `storeAsset` (which welds the
sidecar + manifest). Grep the new `src/summarize/` for direct `fs.writeFile` of a `.md` summary —
there MUST be none; all writes go through `storeAsset`.

## Validation record (T035, 2026-07-21)

Scenarios are exercised by the automated integration/unit suite:

- Scenario 1 (generate two-depth) → `tests/integration/summarize.test.ts` ✓
- Scenario 2 (fail loud on no text) → `tests/integration/summarize-fail-loud.test.ts` ✓
- Scenario 3 (best-available-text selection) → `tests/unit/summarize/select-input.test.ts` +
  `summarize.test.ts` both-layers case ✓
- Scenario 4 (idempotent skip + input-change regen + `--force`) →
  `tests/integration/summarize-idempotent.test.ts` ✓ (found + fixed a real `storeAsset`
  byte-dedup bug that could leave stale `input_layers`)
- Scenario 5 (noisy-OCR `input_quality` flag) → `tests/unit/summarize/select-input.test.ts` +
  `artifacts.test.ts` ✓
- Scenario 6 (rollup cover-what-exists + `summaryRef` in one op, no inlined prose) →
  `tests/integration/summarize-source.test.ts` + `tests/integration/summary-reference.test.ts` ✓
- Scenario 7 (website reads concise, honest absence) → `tests/unit/browser/summary.test.ts` ✓;
  UI verified via `astro build` (2202 pages) + Playwright desktop/mobile.

Full suite: 1898 passed / 8 skipped; the only failures are 3 pre-existing
`CORPUS_ARCHIVE_PATH`-gated browser fixture tests, unrelated to this feature.

XV weld check: `grep -rE 'writeFile' src/summarize/` finds only doc-comments stating the code
does NOT bypass `storeAsset`. Type/size sweep: all `src/summarize/*` ≤ 278 lines, no
`any`/`as`/`@ts-ignore`.
