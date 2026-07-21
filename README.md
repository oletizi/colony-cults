# Colony Cults

A research archive for nineteenth-century utopian, speculative, and fraudulent colonization schemes, beginning with the Marquis de Rays and the Free Colony of Port Breton.

## Initial focus

The first case study is the Marquis de Rays enterprise: the proposed "Free Colony of Port Breton" in New Ireland, its promotional campaign as *Nouvelle-France*, the failed voyages, the collapse of the settlement, the French trial, and the aftermath for survivors in Australia, especially New Italy.

## Goals

- Build a structured, English-language research bibliography.
- Track primary and secondary sources with provenance and acquisition status.
- Preserve links to legally available public-domain and archival material.
- Avoid committing copyrighted scans, copyrighted full-text translations, or restricted archival reproductions.
- Record people, ships, places, events, and open research questions as the archive grows.

## Repository structure

```text
bibliography/
  sources.csv
  acquisition-tracker.csv

research/
  open-questions.md
  timeline.md
  people.md
  ships.md
  places.md

notes/
  source-notes-template.md
  source-acquisition-workflow.md
  browser-tooling.md

scripts/
  playwright-cli.sh
```

## Gallica Fetcher (CLI tool)

A TypeScript CLI (`src/`) that mirrors public-domain BnF Gallica sources for
this archive: it builds a public census of a periodical's issues, mirrors
full-resolution page images into the private archive, and can optionally
self-OCR them into a searchable PDF/A + text sidecar. It handles both
periodical sources (e.g. *La Nouvelle France*, many dated issues) and
monograph sources (a single Gallica document ark, e.g. a promotional book or
contemporary account — no census, one document).

See `specs/001-gallica-fetcher/` for the full spec, contracts, data model, and
`quickstart.md` for the scenario-by-scenario walkthrough this section
summarizes.

### Install

- Node.js >= 20
- `npm install`
- OCR is optional and only needed for the `ocr` command or `--ocr` flag:
  `brew install ocrmypdf tesseract-lang img2pdf poppler` (provides
  `ocrmypdf`, Tesseract with the `fra` language pack, `img2pdf`, and
  `pdftotext`).
- Fetch/OCR commands also expect the private archive sibling repo cloned at
  `../colony-cults-archive` next to this repo.

### The public/private split

- **Public** (this repo): the per-source census JSON under `data/census/`.
  It lists a periodical's issues (ark, date, label, page count) — metadata
  only, no copyrighted or reproduced content.
- **Private** (`../colony-cults-archive`, a sibling repo, not this one): every
  mirrored asset — page images, OCR'd PDF/A, OCR text, and their provenance
  sidecars. The tool refuses to write a preservation asset anywhere else (see
  Guarantees below).

### Commands

Run via `npm run bib -- <command> ...` (or `npx tsx src/index.ts
<command> ...`). Global flags: `--dry-run`, `--force`, `--verify`, `--ocr`;
per-source options: `--source-id <id>` (e.g. `PB-P001`) and `--slug <slug>`.
`census` requires both explicitly; `fetch-issue`/`fetch-source`/`ocr` require
`--source-id` and default `--slug` to that source's registered layout slug.

#### `census <periodicalArk>`

Build/refresh a periodical source's issue census.

```bash
npx tsx src/index.ts census ark:/12148/cb328261098/date --source-id PB-P001 --slug la-nouvelle-france
```

Writes `data/census/PB-P001-la-nouvelle-france.json` (deterministic —
re-running on unchanged holdings yields a byte-identical file). `--dry-run`
prints the target path and issue count without writing.

#### `fetch-issue <issueArk>`

Fetch one periodical issue's full-resolution page images into the private
archive. Periodical sources only — a monograph source has no per-issue arks
(fetch it whole via `fetch-source`, below).

```bash
npx tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g --source-id PB-P001
```

- Rights-gated: refuses (throws, downloads nothing) unless Gallica's
  `dc:rights` confirms public domain.
- Resumable: a plain re-run skips pages already present with a matching
  recorded checksum; `--force` re-fetches everything; `--verify` re-hashes
  existing pages against their recorded checksums without downloading.
- `--dry-run` reports the rights status, target archive path, and an
  estimated size, and writes nothing.
- `--ocr` also runs OCR on the fetched issue (see `ocr`, below).

```bash
npx tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g --source-id PB-P001 --dry-run
npx tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g --source-id PB-P001 --force
npx tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g --source-id PB-P001 --verify
```

#### `fetch-source <ark>`

Fetch a whole source. Behavior depends on the source's registered kind:

- **Periodical** (e.g. `PB-P001`): loads (or builds) the census, then fetches
  every issue in it — each independently rights-gated and resumable. A
  per-issue failure is logged and the run continues; the command exits
  non-zero if any issue failed.
- **Monograph** (e.g. `PB-P002`, `PB-P003` — a single Gallica document, no
  periodical run): fetches that one document's pages directly; no census is
  built or consulted.

```bash
npx tsx src/index.ts fetch-source ark:/12148/cb328261098/date --source-id PB-P001 --dry-run
npx tsx src/index.ts fetch-source ark:/12148/cb328261098/date --source-id PB-P001
npx tsx src/index.ts fetch-source ark:/12148/bptXXXXXXXXX --source-id PB-P002
```

`--dry-run`, `--force`, `--verify`, and `--ocr` behave the same as for
`fetch-issue`, applied across the whole source.

#### `ocr <issueArk>`

OCR an already-fetched (periodical) issue's images — no re-download.

```bash
npx tsx src/index.ts ocr ark:/12148/bpt6k5603637g --source-id PB-P001
```

Runs a toolchain preflight first (fails loud with install guidance if
`ocrmypdf`/`img2pdf`/`pdftotext`/Tesseract-`fra` are missing), then produces
`issue.pdf` (searchable PDF/A) + `issue.txt`, each with a provenance sidecar,
and records the OCR status. Images-only fetches (no `--ocr`) never trigger
this preflight.

### Guarantees

- **Rights gate**: nothing is ever downloaded until Gallica's per-item
  `dc:rights` metadata confirms public domain; the raw rights response is
  captured in provenance either way.
- **Non-overridable archive guard**: every preservation asset (page image,
  PDF/A, OCR text) is written ONLY inside `../colony-cults-archive`; any
  write that would resolve outside it throws instead, and there is no flag or
  configuration to bypass this.
- **Resumability**: a page or derived asset already present with a matching
  recorded SHA-256 checksum is left untouched on re-run (not re-downloaded,
  not re-OCR'd) unless `--force` is given; `--verify` re-hashes without
  fetching anything.
- **No fallbacks**: missing capabilities or data (an unrecognized source ID,
  a malformed host response, a missing OCR toolchain, an unconfirmed rights
  status) throw a descriptive error rather than silently degrading.

## Source Translation (`translate` CLI tool)

A second TypeScript CLI tool in the `gallica-fetcher` package that turns
archived French OCR text (the `issue.txt` produced by the gallica-fetcher) into
corrected French and English translations. The tool processes each issue page by
page, cleaning OCR artifacts and translating via a **pluggable translation
engine** — the Claude Code CLI (`claude`) or the Codex CLI (`codex`), selectable
per run with `--engine claude|codex` (or a `translate.config.json` default) — then
stores both the corrected French transcription and the English translation
alongside the source with YAML provenance records documenting the engine,
model, and machine-assisted nature of the translation.

> **Which engine/model should I use?** See
> [ENGINE-COMPARISON.md](ENGINE-COMPARISON.md) for a controlled comparison of
> Codex vs Claude and of the model/reasoning tiers within each, with guidance and
> caveats. Short version: Codex (`gpt-5.5`) and Claude Opus are quality-equivalent
> on this corpus; the cheaper settings (`codex` `none` reasoning, `claude sonnet`)
> match them; `claude haiku` is a false economy.

### Commands

Run via `npm run translate -- <command> <id> [options]` (or `npx tsx src/index.ts
<command> ...`).

#### `translate <issueArk>`

Translate a single archived periodical issue from French to English.

```bash
npx tsx src/index.ts translate ark:/12148/bpt6k5603637g --source-id PB-P001
```

- Processes the issue page by page: reads the archived `issue.txt`, splits on
  form feeds, then for each page runs cleanup (dehyphenation, line-joining,
  OCR error repair) followed by translation to English.
- Assembles the whole-issue corrected French transcription (`issue.fr.txt`) and
  English translation (`issue.en.txt`), each with a `.yml` provenance companion.
- Rights-gated: refuses (throws, writes nothing) unless the issue's stored page
  provenance confirms public domain.
- Resumable: already-processed pages are skipped on re-run unless `--force` is
  given.
- `--dry-run` reports the intended work and rights status without requiring
  `claude` to be installed.

```bash
npx tsx src/index.ts translate ark:/12148/bpt6k5603637g --source-id PB-P001 --dry-run
npx tsx src/index.ts translate ark:/12148/bpt6k5603637g --source-id PB-P001 --force
```

#### `translate-source <sourceId>`

Translate every archived issue of a source (e.g. all issues of a periodical).

```bash
npx tsx src/index.ts translate-source PB-P001
```

- Iterates the source's archived issues, translating each not-yet-translated
  issue and skipping those that already have translation artifacts (unless
  `--force` is given).
- Paces Claude calls politely to respect rate limits.
- If one issue fails, logs the error and continues with the remaining issues;
  aborts the whole run only after N consecutive issue failures (a small
  threshold signalling a systemic problem like an expired auth token).
- Prints a per-issue outcome report.

```bash
npx tsx src/index.ts translate-source PB-P001 --dry-run
npx tsx src/index.ts translate-source PB-P001 --force
```

### Options

| Flag | Meaning |
|------|---------|
| `--dry-run` | Report intended work (translate / skip / refuse-on-rights) and rights status for each issue; write nothing. Does not require `claude` to be installed. |
| `--force` | Re-translate issues and pages that already have artifacts. |
| `--model <name>` | Claude model alias or full name to pin for the run; recorded in provenance. Optional; a default is used if omitted. |
| `--help`, `-h` | Show help. |
| `--version`, `-v` | Show version. |

### Outputs

Translation produces a set of artifacts stored alongside the source in the
private archive:

- `issue.fr.txt` — the corrected French transcription (OCR cleaned,
  dehyphenated, line-joined, obvious errors repaired).
- `issue.fr.txt.yml` — provenance sidecar for the French transcription.
- `issue.en.txt` — the English translation (produced from the corrected
  French, not from raw OCR).
- `issue.en.txt.yml` — provenance sidecar for the English translation.
- `translation/pNNN.fr.txt`, `translation/pNNN.fr.txt.yml` — per-page
  intermediate French outputs (`NNN` is the 1-based page number zero-padded to
  three digits, e.g. `p001.fr.txt`; durable and individually recorded so a
  re-run resumes at the first incomplete page).
- `translation/pNNN.en.txt`, `translation/pNNN.en.txt.yml` — per-page
  intermediate English outputs.

### Machine-assisted translation and public-domain policy

Translation is **machine-assisted, not human-reviewed**. The provenance records
for each artifact include:

- `engine: claude-code-cli`
- the Claude model identifier used for that run
- `translation: machine-assisted`
- the original-language citation (French)

This labeling follows the project's policy documented in `AGENTS.md` § "Handling
translations": retain the original-language citation and label translations as
machine-assisted unless human reviewed.

**Rights gate**: The tool only produces a committed full translation for issues
confirmed public-domain (by reading `rights_status` from the issue's stored page
provenance). For a source not confirmed public-domain, the tool refuses and
fails loud, writing nothing — consistent with the project's copyright policy
(documented in `AGENTS.md`). `--dry-run` reports the rights status instead of
refusing hard, allowing a preview of intended work before requiring a full run.

## Corpus Print PDF

Generates print-native PDF facsimile editions from the committed corpus snapshot. Each PDF is a facing-page spread: verso contains the original facsimile scan, recto contains that page's French OCR (left column) and English translation (right column), with a provenance title page and colophon. This tool is internal-first — it publishes nothing, only writes locally.

### Prerequisites

- **Typst CLI** (`typst --version`) — a documented build dependency, not an npm package. See https://github.com/typst/typst to install.
- The committed snapshot present: `site/data/*.json.gz` (per-source files) and the pin sidecar `site/data/archive-source.json`.
- Image byte source (one of):
  - **B2 object store** (default): `COLONY_S3_BUCKET`, `COLONY_S3_ENDPOINT`, `COLONY_S3_REGION` environment variables set, and `~/.config/backblaze/b2-credentials.txt` present.
  - **Public IIIF** (alternative): pass `--provider iiif` to fetch full-size scans from the public Gallica IIIF endpoint instead.

### Usage

Run via `npm run pdf:build -- <selector> [--provider b2|iiif] [--out <dir>]`.

**Selectors** (mutually exclusive):

- `<sourceId>/<issueId>` — single bibliographic item (e.g. `PB-P001/1879-08-15_bpt6k56068358`).
- `<sourceId>` — every issue of a source (e.g. `PB-P001` → 78 issue PDFs; `PB-P008` → 1 PDF).
- `--all` — the whole committed v1 corpus (all sources and issues).

**Flags**:

- `--provider b2|iiif` (optional, default `b2`): image byte source. `b2` fetches from private archive masters; `iiif` fetches from public Gallica.
- `--out <dir>` (optional, default `build/pdf`): output root. PDFs land at `<out>/<sourceId>/<itemId>.pdf`.

**Examples**:

```bash
npm run pdf:build -- PB-P001/1879-08-15_bpt6k56068358 --provider iiif
npm run pdf:build -- PB-P001
npm run pdf:build -- --all --out /tmp/corpus-pdfs
```

### B2 read-cost note

Each build fetches page images at generation time. Using `--provider b2` incurs one Backblaze B2 Class-B read per embedded image. For bulk builds across many issues, this cost is material; mitigation via CDN caching or local image cache is tracked separately (outside v1 scope).

### Validation

See `specs/007-corpus-print-pdf/quickstart.md` for the end-to-end walkthrough and fail-loud checks.

## Publishing Facsimile Editions

Publishes pre-built PDF facsimile editions (`build/pdf/<sourceId>/<issueId>.pdf`, written by `pdf:build`) to the Backblaze B2 object store, fronted by the Cloudflare CDN, as immutable snapshot-versioned artifacts. Each publication is recorded in the bibliography SSOT: a `publications[]` entry on the Source, plus a per-issue manifest with sha256, URL, and page count. This tool publishes only — it never builds, fetches images, or runs Typst.

### Prerequisites

- Pre-built PDFs: output from `pdf:build` under the specified `--out` directory (default `build/pdf`).
- B2 object store credentials: `COLONY_S3_BUCKET`, `COLONY_S3_ENDPOINT`, `COLONY_S3_REGION` environment variables set, and `~/.config/backblaze/b2-credentials.txt` present.
- CDN base URL: `CORPUS_CDN_BASE` environment variable (e.g. `https://colony-cults-cdn.oletizi.workers.dev`).
- Archive pin: `site/data/archive-source.json` present and readable (used for snapshot versioning and commit message).
- Rights determination: the Source must carry an affirmative `rights.status: public-domain` determination, or publication is refused and fails loud (rights-gated, fail-closed).

### Usage

Run via `npm run pdf:publish -- <sourceId> --variant <english-only|parallel> [--confirm] [--reconcile] [--out <dir>] [--no-warm]`.

**Arguments & flags**:

- `<sourceId>` (required, positional): source identifier (e.g. `PB-P001`). Unknown → fail loud naming the id.
- `--variant <english-only|parallel>` (required): which built variant to publish. Not inferable from the built path, so explicit and recorded in the artifact key.
- `--confirm` (optional): deliberate-action gate. Absent → dry-run: plans keys/URLs, prints what would be published/recorded, uploads and records nothing.
- `--reconcile` (optional): back-fill mode for already-served editions. Records the legacy-flat URLs without any upload. Requires `--confirm` to write records.
- `--out <dir>` (optional, default `build/pdf`): built-PDF root directory.
- `--no-warm` (optional): skip the best-effort CDN warm after publication (default: warm each new URL, non-fatally).

**Examples**:

```bash
npm run pdf:publish -- PB-P001 --variant english-only
npm run pdf:publish -- PB-P001 --variant parallel --confirm
npm run pdf:publish -- PB-P001 --variant english-only --confirm --reconcile
```

### URL schemes

**Versioned artifacts** (newly published): `editions/<variant>/<sourceId>/<issueId>__<snapshotShort>.pdf`. Each distinct build produces a distinct snapshot token, so the key is always unique; prior keys are never overwritten (immutable).

**Legacy-flat URLs** (reconciled set): `editions/english-only/<sourceId>/<issueId>.pdf`. These coexist with versioned URLs by design, recording already-served content without re-upload.

### Environment

The tool preflights all required environment before any work:

- `COLONY_S3_BUCKET`, `COLONY_S3_ENDPOINT`, `COLONY_S3_REGION` plus the B2 credentials file `~/.config/backblaze/b2-credentials.txt` → eagerly constructs the object store (missing/invalid → fail loud).
- `CORPUS_CDN_BASE` → the canonical URL base for all published artifacts (unset → fail loud, no fallback).
- Archive pin (`site/data/archive-source.json`) → resolved and validated (missing/empty → fail loud; its short token seeds the commit message).

## Legal and citation note

This repository is intended to hold metadata, notes, citations, research leads, and links to lawful sources. Public-domain material may be linked or quoted within normal scholarly practice. Copyrighted works should be cited and summarized, not redistributed.

## Working principle

Every claim should eventually be traceable to a source. When sources disagree, preserve the disagreement rather than flattening it prematurely.
