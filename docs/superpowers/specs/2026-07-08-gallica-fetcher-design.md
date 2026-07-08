# Design: Gallica fetcher (`impl:feature/gallica-fetcher`)

- Date: 2026-07-08
- Roadmap item: `impl:feature/gallica-fetcher`
- Status: designing (awaiting operator approval)
- Backend: `superpowers:brainstorming`, driven under `stack-control:design`

## Problem domain

Port Breton research (Milestone 2, `PB-P001` *La Nouvelle France*) needs a
complete, preservation-grade digital mirror of the public-domain Gallica sources:

1. a **per-issue census** (exact issue list: ark IDs, dates, page counts),
2. **full-resolution page images**, and
3. **OCR text** for full-text search and the future evidence model.

Prior sessions were blocked repeatedly by Gallica's **anti-bot HTML interface** —
the `/date` year pages return `403 Access Interdit` under automated navigation,
even through browser automation. The census was being reconstructed by hand, one
issue at a time, and a run-length conflict (GitHub issue #2) remained unresolved:
Gallica's serial page implied 1879–1885 while SLQ described only 1879–1881.

The roadmap has **several more Gallica-hosted sources** ahead (`PB-P002` de Groote,
`PB-P003` Baudouin, `PB-P004` trial records), so a repeatable tool — not a one-off
script — directly serves the project ethos ("prepare a repeatable pattern", "never
make the same discovery twice").

### Verified facts (live API probes, 2026-07-08)

Gallica publishes documented **web-service + IIIF APIs** that are *separate* from
the anti-bot HTML UI. Probed live this session:

| Endpoint | Result |
|---|---|
| `services/Issues?ark=<periodical>/date` | **200** — returns `totalIssues="78"`, 7 years 1879–1885 |
| `services/Issues?...&date=1879` | **200** — full issue list w/ ark + date per issue |
| `services/Pagination?ark=<issue>` | **200** — `nbVueImages` + per-page dimensions |
| `iiif/ark:/12148/<issue>/f1/info.json` | **200** — IIIF image metadata |
| `iiif/.../f1/full/full/0/native.jpg` | **200** — `image/jpeg`, full-res page |
| `ark:/12148/<issue>.texteBrut` (OCR) | **403** — simple OCR text endpoint IS blocked |

The `Issues` service **authoritatively resolves issue #2**: 78 issues across
1879–1885. The census work that was being done by hand is a single API call per
year.

## Solution space

### Chosen — layered TypeScript CLI over the documented Gallica APIs, self-OCR for text

A small reusable `tsx` CLI, structured in layers with single responsibilities:

- **`GallicaClient`** — thin typed wrapper over the web services (`Issues`,
  `Pagination`, IIIF image). Owns politeness: descriptive User-Agent, rate
  limiting, exponential backoff, and fail-loud on non-retryable errors. Pure I/O,
  independently testable against recorded fixtures.
- **Census layer** — periodical ark → complete issue list (ark, date, page
  count); issue ark → page count. Emits a structured census (JSON) committed to
  the **public** repo (small, safe, high-value; resolves issue #2).
- **Fetch pipeline** — per issue: download full-resolution page images via IIIF;
  assemble + OCR them into a searchable PDF/A; extract a plain-text sidecar;
  compute checksums; write a provenance record.
- **OCR (self-OCR)** — reuse the proven recipe from `~/work/scanner`
  (`hpscan`): `img2pdf <pages> -o raw.pdf` then
  `ocrmypdf --deskew --rotate-pages --language fra --output-type pdfa raw.pdf
  issue.pdf`, then `pdftotext` for a `.txt` sidecar. We OCR the images **we**
  fetched — no dependency on Gallica's blocked text endpoints. We reuse the
  *recipe* (shell out to `ocrmypdf`), not scanner's code — no cross-repo coupling.
- **Archive writer** — lays image/PDF/OCR assets into the sibling private repo
  `../colony-cults-archive` with the metadata `AGENTS.md` mandates (local path,
  retrieval date, original URL, checksum, file format, OCR status).
- **CLI entry** — `census <ark>`, `fetch-issue <ark>`, `fetch-source <ark>`.

Rationale: the API path is *proven open* (200s above); it is polite, deterministic,
and reproducible; self-OCR sidesteps the one blocked endpoint while producing a
preservation-grade artifact (searchable PDF/A) consistent with the archive's
purpose. Layering keeps each unit understandable and testable in isolation.

### Rejected — monolithic per-source script

A single focused script that fetches `La Nouvelle France` and nothing else.
Faster to a first result, but violates the reusable-tool decision and the
project's "never make the same discovery twice"; the next three Gallica sources
would each re-pay the discovery cost. Rejected.

### Rejected — browser-automation (Playwright) fetch pipeline

Reuse the existing repo-local Playwright wrapper to drive the HTML UI. Rejected:
this is exactly the fragile, `403`-prone route that blocked every prior session.
The documented APIs make it unnecessary. Playwright is retained only as a
last-resort **manual** fallback for a human, never as the fetch engine.

### Rejected — depend on Gallica's own OCR (ALTO / texteBrut)

Fetch Gallica's OCR via `.texteBrut` or per-page ALTO (`RequestDigitalElement`).
Rejected for v1: `.texteBrut` is `403`-blocked, ALTO access is unverified and
likely subject to the same protection, and it would add a fragile dependency for
text we can produce ourselves deterministically. Optional future enhancement only.

## Decisions

1. **Full mirror**: census + full-resolution page images + OCR text.
2. **Reusable Gallica fetcher**, not a one-off (serves PB-P002/P003/P004).
3. **Runtime**: TypeScript + `tsx`, `@/` import pattern, no `any` / no `as` /
   no `@ts-ignore` (per global CLAUDE.md). Adds `package.json` + `tsconfig` to
   this repo (currently has no runtime).
4. **Fetch via documented web-service + IIIF APIs**, never the anti-bot HTML UI.
5. **OCR method = self-OCR** with `ocrmypdf`/Tesseract (`fra`), reusing scanner's
   recipe. Primary method (not a fallback), so it complies with the no-fallbacks
   rule. Produces searchable PDF/A + plain-text sidecar.
6. **Storage split**: census/metadata (small) → **public** `colony-cults` repo;
   page images + PDF/A + OCR text (heavy preservation assets) → **private**
   `colony-cults-archive`, cloned as sibling `../colony-cults-archive`.
7. **Rights gate (no fallback / fail loud)**: mirror only items Gallica labels
   `domaine public`, verified per-item from item metadata **before** download.
   On any other rights status, **throw** with a descriptive error — never
   silently skip or guess.
8. **Politeness**: descriptive User-Agent identifying the project + contact,
   rate limiting, exponential backoff; treat `403` as retry-with-backoff then
   fail loud, never silent.
9. **Checksums**: `sha256` per asset, recorded in the provenance metadata.
10. **Playwright** stays a documented manual last resort, not part of this tool.

## Open questions

_Carry into `/stack-control:define`; none are blockers._


- **Image derivative policy**: full-resolution `native.jpg` (largest, true
  preservation) vs a capped IIIF size. Lean full-res; confirm disk footprint
  (~78 issues x ~8–12 pages x ~0.3–1 MB → order of hundreds of MB) before a full
  run. Decide in the spec.
- **Archive repo layout + metadata schema**: inspect `colony-cults-archive` after
  cloning; conform the archive writer to any existing directory/metadata
  convention rather than inventing a new one.
- **OCR toolchain install**: local box has Tesseract 5.5.1 but only `eng`;
  `ocrmypdf`, `img2pdf`, `pdftotext`, and the `fra` language pack are missing.
  Spec must capture the install step (`brew install ocrmypdf tesseract-lang
  img2pdf poppler` or equivalent) as a prerequisite.
- **Scanner library viewer reuse**: scanner has a PDF/A library viewer
  (searchable / image-only badges). Out of scope for the fetcher; note as a
  possible later surface for browsing the archive.

## Provenance

- Origin: interactive design conversation, 2026-07-08, driven under
  `stack-control:design` with the `superpowers:brainstorming` backend.
- Design decisions 1–6 sourced from operator answers to four `AskUserQuestion`
  prompts this session (fetch target, scope, runtime, asset destination).
- API viability (the load-bearing premise) verified by live `curl` probes this
  session — see the "Verified facts" table above.
- OCR method sourced from the operator's pointer to `~/work/scanner` (`hpscan`),
  whose `scan-manuscript.sh` supplies the `img2pdf` + `ocrmypdf --output-type
  pdfa` recipe reused here.
- Handoff target: `/stack-control:define` (authors the Spec Kit spec from this
  record).
