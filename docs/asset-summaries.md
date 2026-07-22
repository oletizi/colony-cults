# Asset Summaries (`bib summarize`)

Per-issue and per-source LLM summaries of the acquired corpus, at two depths from one
generation flow. Spec: `specs/017-asset-summaries/`.

Summaries are **machine-generated interpretation** — machine-labeled, provenance-stamped,
stored separately from the scans/OCR, and **never** asserted as evidence (Constitution I/III).
The authoritative record remains the facsimile + OCR; a summary is a finding-aid over them.

## Verbs

```
bib summarize <sourceId> [issueArk]   # summarize one issue (or every issue of a source)
bib summarize-source <sourceId>       # per-source rollup (cover-what-exists) + bibliography reference
```

Flags: `--model <id>` (default `claude-sonnet-5`), `--engine <name>` (default `claude`),
`--force` (regenerate even if inputs are unchanged), `--dry-run` (report, write nothing).

## What it produces

Per issue, alongside the OCR/translation companions in the issue directory:

- `issue.summary.long.en.md` — the **thorough** finding-aid: YAML frontmatter with structured
  fields (`topics`, `people`, `places`, `dates`, `claims` — recorded, not asserted) plus a
  narrative prose body.
- `issue.summary.short.en.md` — the **concise** ~1–3 sentence abstract, distilled from the
  thorough (never introduces a claim absent from it).

Per source, `bib summarize-source` writes `source.summary.long.en.md` / `source.summary.short.en.md`
(rollup, covering the issues that have summaries and recording covered/missing in the rollup) and
sets the source record's `summaryRef` (a by-path pointer to the rollup thorough summary — the
bibliography SSOT references it, never inlines the prose).

Each artifact carries a `.yml` provenance sidecar: `engine`, `model`, `retrieved`, the input
layers used (`input_layers`), an `interpretation: machine-generated-summary` label, and an
`input_quality` note when the source OCR is low-confidence.

## Behavior

- **Input**: the best available acquired text — English OCR for English-language sources; French
  OCR + the English translation where present. Output is always English. **Fails loud** if an
  issue has no usable text layer (no fabricated summary).
- **Idempotent / resumable**: keyed to the input layers' checksums — an already-summarized issue
  with unchanged inputs is skipped; a changed OCR/translation regenerates that issue. `--force`
  overrides.
- **No-orphan weld** (Constitution XV): every summary artifact is written only through the
  canonical archive writer (`storeAsset`), which welds the sidecar + manifest update into the
  same operation; `summarize-source` writes the `summaryRef` in the same operation as the rollup.
- **Engine**: an injected `SummarizationRunner` (a shelled `claude` CLI adapter mirroring the
  OCR/translation runners), swappable and model-configurable. It reads **local** text — it is NOT
  a governed source query and does not use the spec-014 source-query client.

## Website

The corpus-browser reads the **concise** summary and shows it as a labeled abstract on the issue
reading view (at the head of the reading column) and the source landing page — visibly marked
"Interpretation — not evidence". Issues/sources without a summary render gracefully.
