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

Run via `npm run gallica -- <command> ...` (or `npx tsx src/index.ts
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

## Legal and citation note

This repository is intended to hold metadata, notes, citations, research leads, and links to lawful sources. Public-domain material may be linked or quoted within normal scholarly practice. Copyrighted works should be cited and summarized, not redistributed.

## Working principle

Every claim should eventually be traceable to a source. When sources disagree, preserve the disagreement rather than flattening it prematurely.
