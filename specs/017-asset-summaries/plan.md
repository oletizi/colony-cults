# Implementation Plan: Asset Summaries

**Branch**: `feature/asset-summaries` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-asset-summaries/spec.md`

## Summary

Generate, per issue/document, an LLM summary at two depths from one generation flow — a
**thorough** structured-plus-prose finding-aid and a **concise** ~1–3 sentence abstract
distilled from it — from the best available acquired text (English OCR; French OCR + English
translation where present), output English. Summaries are written as machine-labeled
companion artifacts in the archive with a provenance sidecar (interpretation, not evidence),
mirroring the OCR and translation pipelines exactly. A per-source rollup (cover-what-exists)
gives each run/book a landing abstract. The bibliography **references** the thorough summary
(no inlined prose); the website reads the concise. Generation runs behind an injected
`SummarizationRunner` (a shelled `claude` CLI adapter mirroring `TranslationEngine`, model
configurable, default Claude Sonnet 5), resumable/idempotent keyed to the input layers' hashes.

Technical approach mirrors the shipped machinery point-for-point (see research.md): the
`TranslationEngine`/`createClaudeCli` runner + `createEngine` factory for the engine seam;
`storeAsset`/`writeProvenance` + the `derivedProvenance` "derive-from-source-page, override
derived-specific-fields" idiom for companions+sidecars; `isAssetRecorded` + input-layer sha
keys for idempotency; the `census:`-style by-path pointer for the bibliography reference; and
the `src/browser/load/translation.ts` honest-absence loader shape for website display.

## Technical Context

**Language/Version**: TypeScript executed with `tsx` (no `ts-node`); esbuild → `dist/`.

**Primary Dependencies**: the shipped `claude` CLI (shelled via `src/claude/exec.ts`); the
existing `engine`/`archive`/`bibliography`/`browser`/`cli` modules. No new runtime dependency
(no Anthropic HTTP SDK — see research.md Decision 1).

**Storage**: filesystem archive companions in the issue directory — `issue.summary.long.en.md`
+ `issue.summary.short.en.md` (+ `.yml` provenance sidecars via `companionYamlPath`); source
rollup companions at the source level; `manifests/MANIFEST.sha256` updated by `storeAsset`.
Bibliography SSOT YAML gains a by-path reference field (no inlined prose). Website reads via
`src/browser/load/`.

**Testing**: `vitest`. Unit tests colocated (`src/**/*.test.ts`) and under `tests/unit/`;
integration under `tests/integration/`. External engine faked via a hand-written in-memory
`SummarizationRunner` inside test code (the injected-interface seam — legitimate, not a
production mock).

**Target Platform**: local developer/operator CLI (`bib summarize`) over the on-disk archive;
website is the existing Astro corpus-browser (`site/`).

**Project Type**: CLI + library + static-site data-loader (single repo, existing layout).

**Performance Goals**: not latency-bound; polite pacing between issues (mirror translation's
`PACE_MS`) and a consecutive-failure abort threshold; cost-bounded by model choice (Sonnet 5
default). No throughput target beyond "processes the v1 shipped set in a resumable run."

**Constraints**: type-safe (`@/` imports, no `any`/`as`/`@ts-ignore`, files ≤ 300–500 lines);
fail-loud, no fallback/mock; summaries are interpretation, machine-labeled, stored separate
from evidence; browser display through `/frontend-design:frontend-design`.

**Scale/Scope**: v1 = the corpus-browser's shipped set (PB-P001 issues + monographs + the
English-language Papers Past items); pipeline generalized so any source registers in.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` (v1.4.0). All gates PASS by design:

- **I. Evidence Before Narrative / III. Provenance Mandatory**: summaries are explicitly
  interpretation, machine-labeled, provenance-stamped (engine/model/date/input-layers +
  "interpretation, not evidence" label), and stored **separate** from scans/OCR. A summary is
  never recorded as a factual claim. PASS (FR-004..006, data-model Summary + Sidecar).
- **II. Preserve Disagreement**: summaries do not resolve source disagreement; the thorough's
  structured `claims` field records notable claims without asserting them as settled. PASS.
- **IV. Respect Copyright**: summarizing is cataloging/interpretation, not reproduction —
  permitted even for cataloged-but-not-mirrored sources (FR-014); no scans are mirrored by
  this feature. PASS.
- **V. Fail Loud, No Fallbacks**: no usable text layer → descriptive error, zero artifact
  written (FR-003); test fakes live only in test code behind the injected interface. PASS.
- **VI. Composition Over Inheritance**: `SummarizationRunner` is an interface composed via a
  factory + injected command runner (mirrors `TranslationEngine`/`createClaudeCli`); the CLI
  builds `SummarizeCliDeps` by constructor injection. No inheritance. PASS.
- **VII. Type Safety**: `@/` imports, no `any`/`as`/`@ts-ignore`; new modules each < 300 lines
  by decomposition (runner, artifacts, provenance-builder, idempotency-key, CLI, loaders).
  PASS (enforced in tasks/review).
- **VIII. Faithful Tool Adoption**: authored through the stack-control front door
  (define→execute→ship) over native Spec Kit. PASS.
- **IX / X**: commit-and-push each unit; no git hooks. PASS.
- **XI. Design Through the Design Skill**: US2 website display (concise abstract + rollup) is
  built through `/frontend-design:frontend-design` — flagged as a hard precondition on the
  browser tasks. PASS (gated at implementation).
- **XII. Respect the Source**: N/A to generation (reads **local** text, calls the LLM, makes
  **no** external-source fetch); explicitly does NOT use the spec-014 client (FR-012). PASS.
- **XIII. No Agent Memory**: all knowledge in-repo (spec/plan/design). PASS.
- **XIV. Operator Owns Scope**: the CLI-vs-API access decision and the FR-C3 encoding are
  SURFACED (research.md) for operator override, not silently cut. PASS.
- **XV. Metadata Integrity (No Orphan Assets)**: summary artifacts are written **only** via
  `storeAsset`, which welds the sidecar write + manifest update into the same operation and
  re-derives sha/size/path from actual bytes — mechanically no orphan summary. The bibliography
  reference is written in the same operation as the rollup it points at. Design/test this
  weld FIRST (see tasks ordering + quickstart). PASS by construction.

No violations → Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/017-asset-summaries/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (CLI-vs-API, encoding, idempotency key, reference)
├── data-model.md        # Phase 1 — entities + fields + relationships + validation
├── contracts/
│   ├── summarization-runner.md   # the injected engine interface + factory + config
│   ├── cli-summarize.md          # `bib summarize` / `bib summarize-source` verb contract
│   ├── summary-artifacts.md      # companion file names + sidecar schema (FR-C3 resolution)
│   └── browser-view.md           # corpus-browser view-model additions + loader contract
├── quickstart.md        # Phase 1 — runnable end-to-end validation scenarios
└── tasks.md             # Phase 2 — /speckit-tasks (NOT created here)
```

### Source Code (repository root)

```text
src/
├── summarize/                    # NEW — the summarization domain
│   ├── types.ts                  #   SummarizationRunner interface, SummaryDepth, SummaryResult, structured fields
│   ├── runner-claude.ts          #   createClaudeSummarizer(runner): SummarizationRunner (shelled claude CLI)
│   ├── factory.ts                #   createSummarizer(name): bundle (mirrors engine/factory.ts)
│   ├── config.ts                 #   default model 'claude-sonnet-5', resolveSummaryModel (flag>config>default)
│   ├── prompt.ts                 #   thorough + concise-distill prompts (structured-fields instruction)
│   ├── artifacts.ts              #   file names + buildSummaryProvenance (mirror translate/artifacts.ts)
│   ├── idempotency.ts            #   input-layer sha key: compute + compare vs recorded sidecar
│   ├── issue.ts                  #   summarizeIssue(issueDir, ctx): the per-issue flow (fail-loud on no text)
│   └── source-rollup.ts          #   summarizeSource(...): cover-what-exists rollup + coverage provenance
├── cli/
│   └── summarize.ts              # NEW — runSummarize/runSummarizeSource, builds SummarizeCliDeps
├── cli/
│   ├── parse.ts                  # EDIT — add 'summarize','summarize-source' to Command union
│   └── dispatch.ts               # EDIT — HANDLERS entries + help text
├── index.ts                      # (bib bin — routes through dispatch, no edit expected)
├── bibliography/
│   └── summary-reference.ts      # NEW — write/read the by-path thorough-summary reference on the source record
├── model/
│   └── source.ts / repository-record.ts  # EDIT — optional summaryRef field (by-path, like census:)
└── browser/
    ├── load/summary.ts           # NEW — per-issue concise loader (mirror load/translation.ts, honest-absence)
    ├── load/corpus.ts            # EDIT — wire summary loader into IssueView/SourceView
    └── model.ts                  # EDIT — IssueView.conciseSummary?, SourceView.conciseSummary? (+ label)

site/                             # website UI (US2) — through /frontend-design:frontend-design ONLY

tests/
├── unit/summarize/               # runner, prompt, idempotency-key, artifacts, provenance-builder
├── integration/summarize.test.ts # end-to-end: seed issue.en.txt+companion → assert 2 artifacts+sidecars
├── integration/summarize-idempotent.test.ts  # skip on rerun; regenerate on input-layer change
└── unit/browser/summary.test.ts  # concise loader honest-absence
```

**Structure Decision**: single existing repo; a new `src/summarize/` domain module decomposed
into small (< 300-line) units mirroring `src/ocr/` + `src/translate/`, plus a `bib summarize`
CLI verb, a bibliography by-path reference, and browser loader/view-model additions. Reuses the
canonical `storeAsset`/`writeProvenance`/`isAssetRecorded` archive layer verbatim (no second
companion serializer).

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
