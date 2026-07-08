# Quickstart / validation guide: Gallica Fetcher

End-to-end scenarios that prove the feature works. See [contracts/](./contracts/) and [data-model.md](./data-model.md) for details; this file is the run/validation guide.

## Prerequisites

- Node.js ≥ 20; `pnpm install` (or npm) at repo root.
- For OCR scenarios only: `brew install ocrmypdf tesseract-lang img2pdf poppler` (provides `ocrmypdf`, Tesseract with `fra`, `img2pdf`, `pdftotext`).
- The private archive sibling repo cloned at `../colony-cults-archive` (for fetch scenarios). Census scenarios need only this repo.

## Scenario 1 — census resolves the run length (US1 / SC-001)

```bash
tsx src/index.ts census ark:/12148/cb328261098/date
```

Expect: `data/census/PB-P001-la-nouvelle-france.json` written, listing **78 issues across 1879–1885**, ordered by date, each with `ark`, `date`, `label`, `pageCount`. Re-running yields a byte-identical file.

## Scenario 2 — dry-run reports before mirroring (US2 / SC-006)

```bash
tsx src/index.ts fetch-source ark:/12148/cb328261098/date --dry-run
```

Expect: per-issue rights status, intended archive paths, and an estimated total size printed; **nothing written** anywhere.

## Scenario 3 — fetch one issue, images-only (US2 / SC-002..004)

```bash
tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g
```

Expect: rights gate confirms public-domain first; 12 page images land under `../colony-cults-archive/PB-P001-la-nouvelle-france/1879-07-15_bpt6k5603637g/`, each with a `.provenance.json` sidecar (incl. sha256 + raw OAIRecord). No asset written outside the archive.

## Scenario 4 — resumability (US2 / SC-005)

```bash
tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g          # re-run
tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g --force  # re-fetch
tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g --verify # re-hash only
```

Expect: plain re-run skips all checksum-recorded pages; `--force` re-downloads; `--verify` re-hashes and reports any mismatch, downloading nothing.

## Scenario 5 — OCR an already-fetched issue (US3 / SC-007)

```bash
tsx src/index.ts ocr ark:/12148/bpt6k5603637g
```

Expect: toolchain preflight passes, then `issue.pdf` (searchable PDF/A) + `issue.txt` produced with provenance; `ocrStatus = searchable`. No host text endpoint contacted.

## Scenario 6 — images-only run without OCR toolchain (US3 / SC-008)

On a machine lacking `ocrmypdf`:

```bash
tsx src/index.ts fetch-issue ark:/12148/bpt6k5603637g   # no --ocr
```

Expect: succeeds (OCR preflight not triggered). Adding `--ocr` on that machine fails loud with install guidance.

## Scenario 7 — rights refusal (SC-002)

Point `fetch-issue` at an item whose `dc:rights` is not public-domain (fixture): expect a descriptive throw and **zero** downloads.

## Automated checks

```bash
pnpm vitest run
```

Unit: census parse, deterministic serialize, path guard, sha256, backoff, rights parse. Integration (fixtures): census→fetch flow, guard refusal, resumability.
