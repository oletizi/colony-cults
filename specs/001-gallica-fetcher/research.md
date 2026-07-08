# Phase 0 Research: Gallica Fetcher

All primary premises were verified with live probes during the design phase (2026-07-08). This file records the resolved decisions; nothing here remains `NEEDS CLARIFICATION`.

## Decision: use Gallica's documented web services, not the HTML UI

- **Decision**: Access via the `services/*` + IIIF APIs. The interactive `/date` HTML pages are anti-bot protected and return `403 Access Interdit`; the documented services do not.
- **Evidence (HTTP 200)**: `services/Issues` (year list + per-year issue list w/ ark + date), `services/Pagination` (page count + per-page dimensions), `services/OAIRecord` (Dublin Core incl. `dc:rights`), IIIF `info.json` and `full/full/0/native.jpg`.
- **Evidence (HTTP 403)**: `ark:/12148/<ark>.texteBrut` — the simple OCR text endpoint is blocked.
- **Alternatives rejected**: browser automation of the HTML UI (fragile, 403-prone — the exact failure mode that blocked prior sessions); Gallica SRU search (triggered anti-bot verification).

## Decision: census from the Issues service

- **Decision**: `services/Issues?ark=<periodicalArk>/date` yields the year list; `&date=YYYY` yields that year's issues with `ark` + human date + `dayOfYear`. Page count per issue comes from `services/Pagination?ark=<issueArk>` (`nbVueImages`).
- **Rationale**: authoritative, machine-readable, one call per year. Resolves the run-length conflict (issue #2): `totalIssues="78"`, 1879–1885.
- **Alternatives rejected**: hand-scraping year pages (blocked); inferring cadence from sampled issues (incomplete).

## Decision: full-resolution native page images via IIIF

- **Decision**: fetch `iiif/ark:/12148/<issueArk>/f<n>/full/full/0/native.jpg` for `n` in `1..nbVueImages`. Full native resolution, no capped derivative (clarified 2026-07-08).
- **Rationale**: OCR/extraction accuracy scales with input resolution; native ≈300 DPI is optimal. Preservation- and extraction-optimal coincide.
- **Alternatives rejected**: capped IIIF size (degrades OCR); generating an access derivative (doubles storage, unused in v1).

## Decision: self-OCR (do not depend on host text)

- **Decision**: OCR the fetched images ourselves — `img2pdf <pages> raw.pdf` → `ocrmypdf --deskew --rotate-pages --language fra --output-type pdfa raw.pdf issue.pdf` → `pdftotext issue.pdf issue.txt`. Recipe reused from `~/work/scanner`.
- **Rationale**: `.texteBrut` is 403-blocked; ALTO access is unverified and likely similarly protected. Self-OCR is deterministic, reproducible, and yields a preservation-grade searchable PDF/A. Primary method, not a fallback.
- **Alternatives rejected**: Gallica `.texteBrut` (blocked); per-page ALTO via `RequestDigitalElement` (unverified, fragile).

## Decision: rights gate from OAIRecord dc:rights

- **Decision**: before any download, GET `services/OAIRecord?ark=<issueArk>`, parse `dc:rights`, require the public-domain value (`fre`=`domaine public` / `eng`=`public domain`). Otherwise throw. Store the raw OAIRecord response in provenance.
- **Rationale**: verified live to return the per-item value at HTTP 200. The IIIF manifest `license` field is a generic conditions-of-use URL identical across items — unusable as a per-item gate.
- **Alternatives rejected**: IIIF `license` (not per-item); trusting age alone (host reproduction terms are the real question).

## Decision: politeness parameters

- **Decision**: descriptive User-Agent `colony-cults-research/<version> (digital humanities; contact oletizi@mac.com)`; default ≤ 2 concurrent requests, ~1 req/sec; exponential backoff on 429/403/5xx (e.g. 1s→2s→4s→8s, capped, a few attempts) then fail loud.
- **Rationale**: the same UA + spacing succeeded across all probes; conservative pacing avoids tripping protection over a 78-issue run.
- **Alternatives rejected**: unbounded concurrency (risks blocks); silent skip on 403 (violates fail-loud).

## Decision: OCR toolchain preflight

- **Decision**: when OCR is requested, verify `ocrmypdf`, `img2pdf`, `pdftotext`, and Tesseract with the `fra` traineddata are present; else throw with install guidance (`brew install ocrmypdf tesseract-lang img2pdf poppler`). Skip the check entirely when OCR is not requested.
- **Rationale**: current dev box has Tesseract 5.5.1 with only `eng`; the rest are missing. Images-only runs must not be blocked by a missing OCR toolchain.

## Decision: minimal dependency footprint

- **Decision**: runtime dep `fast-xml-parser` only; `node:util.parseArgs`, `node:crypto`, global `fetch` for the rest; `vitest` for tests. OCR tools are external binaries, shelled out.
- **Rationale**: smaller supply-chain surface; the XML is simple enough that one parser suffices.
- **Alternatives rejected**: a heavy HTTP/IIIF client library (unneeded); an OCR npm binding (ocrmypdf CLI is the proven recipe).
