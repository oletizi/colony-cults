# Contract: `pdf:build` CLI

The corpus-wide build verb, an npm script sibling to `site:snapshot` / `site:export-public`.

```text
npm run pdf:build -- [<sourceId>[/<issueId>]] [--all] [--provider b2|iiif] [--out <dir>]
# scripts/build-pdf.ts main()
```

- `<sourceId>` — build every item of one source (e.g. `PB-P001` → 78 issue PDFs; `PB-P008` → 1 PDF).
- `<sourceId>/<issueId>` — build a single issue PDF.
- `--all` — build the whole v1 corpus (all committed snapshot sources).
- `--provider` — image byte source: `b2` (default, masters) or `iiif` (full-size alternate).
- `--out <dir>` — output root (default `build/pdf/`); PDFs land at `<out>/<sourceId>/<itemId>.pdf`.

## Guarantees

- **G-1 (one PDF per item)**: for a periodical source, exactly one PDF is written per issue; for a
  monograph, exactly one PDF (FR-001). The written count equals the item count in the snapshot.
- **G-2 (selector precision)**: `<sourceId>/<issueId>` writes exactly that one PDF; an unknown
  source or issue id fails loud naming the missing id (no silent empty run).
- **G-3 (internal-first)**: the verb writes only under `--out` on the local filesystem; it performs
  no publish/upload/deploy step (FR-012). No network egress except B2/IIIF image *reads*.
- **G-4 (fail-loud batch)**: in a batch build, an item that violates any data-model fail-loud rule
  aborts with an error naming the specific item; the failure is attributable, not swallowed (FR-009,
  US2 acceptance 3). (Whether the batch stops or records-and-continues is a tasks-level choice; the
  failure is always surfaced and attributable.)
- **G-5 (no credentials in output)**: no B2 credential or secret appears in any PDF, log line, or
  output path (mirrors the browser G-5).
- **G-6 (Typst prerequisite)**: if the `typst` binary is absent, the verb fails loud with a message
  naming the missing dependency before doing image work.

**Fixture**: `tests/integration/pdf/` drives a single PB-P001 issue selector against an in-memory
`ObjectStore` fake + fake `TypstRunner`, asserting G-1/G-2/G-6 and the write path shape.
