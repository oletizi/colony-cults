# Research: Corpus Print PDF (spec 007)

Phase 0 decisions. Each resolves a technical unknown in the plan's Technical Context, grounded in
the existing codebase (corpus-browser reuse surface) and the approved design record.

## Decision 1 — Typst as the print engine, driven as an external CLI

**Decision**: Compose the PDF with **Typst**, invoked as an external `typst compile` process behind a
`TypstRunner` interface (constructor-injected). The template reads a serialized `Edition` JSON via
Typst's `json()` and `sys.inputs`/a data file; the runner shells out and returns the PDF bytes/path.
The Typst binary is a documented build prerequisite; its absence is a descriptive fail-loud error.

**Rationale**: The design chose print-native typographic control (pagination, running heads, columns,
hyphenation) for a dense parallel-text facsimile edition. Constitution VI/VIII: external tools are
shelled out behind injected runners, never reimplemented — mirrors the `src/ocr` exec runner and the
`src/claude` CLI adapter. Keeps our TypeScript layer responsible only for *data assembly*, not layout.

**Alternatives considered**: headless-Chrome print of a print-CSS route (rejected in design — weaker
pagination/hyphenation control, kept only as fallback engine); hand-coded JS PDF library
(pdfkit/pdf-lib — most code, weakest typography, manual box placement). Both rejected in the design
record.

## Decision 2 — Consume the pinned snapshot; do not re-derive the corpus

**Decision**: Read corpus text, structure, per-page French OCR, **per-page English translation**, and
per-image object-store keys + sha256 from the committed **snapshot** (`site/data/<sourceId>.json.gz`
via `@/browser/load/snapshot` `readSnapshotCorpus`), with the reproducibility pin taken from
`site/data/archive-source.json` (`.ref`). The PDF builder never reads the raw archive for corpus text.

**Rationale**: The snapshot is corpus-browser's single source of truth and is already pinned + drift-
guarded (`npm snapshot` / `snapshot:check`). `RawPage.english` is **already per-page**, so page-
adjacent translation (FR-011) is satisfiable directly — a missing/empty `english` for a page is the
fail-loud "per-page EN unavailable" case (spec Edge Case), not a fallback to issue-level text.

**Alternatives considered**: read the pinned archive worktree directly (rejected — reintroduces a
private-archive dependency for text and contradicts snapshot-as-SSOT / reproducibility-from-pin).

## Decision 3 — Fill the three metadata gaps: SSOT for catalog fields, snapshot extension for the machine-assist label

**Decision**: The snapshot lacks three fields the front matter/colophon need.
- **`creator`, `catalogUrl`** (title page): read from the committed **bibliography SSOT**
  (`bibliography/sources/<sourceId>.yml` via `@/bibliography` `loadSourceFile` / `sourceDescriptor`).
  No snapshot change — the SSOT is public, committed, and always available.
- **Machine-assist translation label** (`engine`, `model`, `retrieved` date) for the colophon: **extend
  the snapshot additively** — carry it in the per-page provenance (`RawPage.provenance` /
  `ProvenanceRecord` in `src/browser/model.ts`), sourced from the `translation/pNNN.en.txt.yml`
  sidecars when the snapshot is (re)generated. Regenerate committed snapshots via `npm snapshot`.

**Rationale**: catalog fields are stable source metadata already read directly by the browser's
`sourceDescriptor`, so reading the SSOT is idiomatic and archive-free. The machine-assist label is
*evidence about the corpus text* and must be reproducible from the pin without the private archive —
so it belongs in the snapshot. The extension is purely additive (optional fields), so it does not
break the closed corpus-browser feature.

**Alternatives considered**: read translation sidecars from the pinned archive at build (rejected —
private-archive dependency, non-reproducible without the archive); put creator/catalogUrl in the
snapshot too (deferred — unnecessary churn; SSOT read is sufficient).

## Decision 4 — Print-resolution image bytes from B2, IIIF full-size as alternate, sha256-verified

**Decision**: Fetch print-resolution page-image **bytes at build time** behind an `ImageByteSource`
interface.
- **Primary (`b2-cdn` parity)**: pull the master from B2 with `@/archive` `S3ObjectStore.get(objectStoreKey)`
  (`resolveObjectStoreConfig` for endpoint/creds). The browser's `b2-cdn` provider only builds URLs;
  byte fetch reuses the `restore-images` precedent (`src/cli/restore-images.ts`, `src/archive/public-cache.ts`).
- **Alternate (`source-iiif` parity)**: construct a IIIF **Image API full-size** URL
  (`<ark>/<folio>/full/max/0/default.jpg`) and fetch — the browser's `source-iiif` provider yields a
  tile base (for OpenSeadragon), not a print image, so the alternate builds a full-size request.
- Every fetched image is **sha256-verified against `RawPage.provenance.sha256`**; a mismatch fails loud.

**Rationale**: Providers-build-URLs-only is the browser's design; print embedding needs bytes, so the
byte layer is new but reuses the existing `ObjectStore` abstraction (already fake-able in tests).
sha256 verification makes the colophon's per-image checksum a real integrity guarantee (Principle III).

**Alternatives considered**: embed the browser's tiled IIIF (rejected — tiles are for interactive zoom,
not a single print raster); read masters from the archive filesystem (rejected — private-archive
dependency; the design specifies B2/IIIF at generation).

## Decision 5 — Fonts: embed-permissive faces, exact choice via /frontend-design

**Decision**: The template embeds only fonts **licensed for embedding + redistribution** (SIL OFL or
equivalent). The concrete Didone (source voice) and grotesque (apparatus voice) faces are chosen in
the `/frontend-design` pass (Constitution XI / FR-013) and vendored under `pdf/template/fonts/`.

**Rationale**: Typst embeds fonts into the PDF; FR-014 requires embedding rights. The exact typographic
selection is UI/visual design and is non-negotiably routed through `/frontend-design` before template
markup — so the plan fixes the *constraint* (embed-permissive) and defers the *selection* to that pass.

**Alternatives considered**: rely on system fonts (rejected — non-reproducible across machines,
uncertain embedding rights).

## Decision 6 — CLI shape: `pdf:build` npm script, single-item and batch

**Decision**: Add `scripts/build-pdf.ts` with a bare `main()`, wired `"pdf:build": "tsx scripts/build-pdf.ts"`,
sibling to `site:snapshot`. It accepts a source/item selector for a **single item** and a no-selector
(or `--all`) **batch** over the v1 corpus, writing `build/pdf/<sourceId>/<itemId>.pdf`. Config is
env-only via `config.ts` (image provider choice, output dir), matching `build-snapshot.ts`.

**Rationale**: `site:snapshot`/`site:export-public` establish the script+`main()` convention for
corpus-wide operations (distinct from the `gallica`/`translate` bin/handler machinery). Matching it
keeps the interface idiomatic; the contract is pinned in `contracts/cli.md`.

**Alternatives considered**: a new `gallica pdf` subcommand under the bin/handler machinery (rejected —
corpus-wide build operations follow the `scripts/*.ts` precedent, not the per-issue verb machinery).

## Open items carried to tasks / later (non-blocking)

- **Exact image resolution vs PDF file-size budget** — tune during template build (full master vs a
  sized derivative); measured against SC-001 openability, not a fixed number here.
- **Reproducibility of Typst output** (SC-004) — pin Typst version + embedded fonts + deterministic
  input JSON ordering; confirm byte/content-stable output in the integration test.
- **B2 read-cost mitigation** (TASK-12 / local image cache) — out of scope; a batch build re-reads B2
  per image today.
