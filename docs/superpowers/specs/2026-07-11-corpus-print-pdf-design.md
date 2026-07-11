# Design: Corpus Print PDF (`impl:feature/corpus-print-pdf`)

- Date: 2026-07-11
- Roadmap item: `impl:feature/corpus-print-pdf`
- Depends-on: `impl:feature/corpus-browser` (closed — normalized corpus + snapshot),
  `impl:feature/canonical-source-metadata` (closed), `impl:feature/archive-object-store`
  (closed — B2 image handles); consumes `impl:feature/source-translation` (in-flight)
  translation output.
- Status: designing (awaiting operator approval marker)
- Backend: `superpowers:brainstorming` via `/stack-control:design`; visual direction
  for the Typst template deferred to `/frontend-design` at build (project commandment).

## Problem domain

corpus-browser made the corpus readable on screen — a facsimile page beside its
French OCR and English translation, inside an archival frame. There is no
**offline, print-native artifact**: a scholar cannot hold, cite, or shelve a corpus
item as a document. The goal is a **printable scholarly facsimile edition** of each
corpus item — the source scan and its parallel French/English text bound together
with provenance, in a print-quality typographic layout — that never lets the
propaganda pass for truth. v1 corpus mirrors the browser's shipped set:
**PB-P001 *La Nouvelle France*** (78 issues) plus the Port Breton monographs
(PB-P008–011), with the data layer generalized so any source slots in.

## Solution space

### Chosen — Typst template, facing-page facsimile edition, one PDF per item

- **Engine: Typst.** A Typst template consumes serialized corpus data (JSON) and
  emits a PDF. Chosen over reusing the website's HTML/CSS because a scholarly
  parallel-text facsimile edition wants **print-native typographic control**
  (precise `@page`/running-head/column/hyphenation behavior, small fast toolchain)
  that a print stylesheet fights. The operator accepted a **print layout distinct
  from the web reading view** as the cost.
- **Unit: one PDF per bibliographic item.** Each newspaper **issue** → its own PDF;
  each **monograph** → one PDF. Matches the browser's issue-level reading unit, the
  natural citable unit, and manageable file sizes. (A newspaper run becomes N issue
  PDFs, not one volume.)
- **Layout: facing-page spread.** Verso (left) = the facsimile scan; recto (right) =
  parallel **French OCR │ English translation** in two columns. The classic scholarly
  facsimile edition — scan and text held open together. Doubles page count vs a
  stacked layout, deliberately, because our OCR is noisy and the scan is the
  authority.
- **Data source: reuse corpus-browser's normalized snapshot** (`Source → Issue →
  Page` + FR OCR + EN translation + image handles), **pinned to an archive commit**
  for reproducibility (the shipped `site:snapshot` model). Single source of truth;
  the PDF generator does not re-derive the corpus.
- **Images fetched at generation** at print resolution — from **B2 via the
  `object_store` key** (masters), with **IIIF (source ark) as the alternate
  provider**, parity with the browser's configurable image source. Embedded into the
  PDF by Typst. Batch the fetch; note the B2 Class B read cost per build (ties to
  `TASK-12` CDN read-caching).
- **Provenance & critical framing.** Title page (source metadata, creator, date,
  rights, ARK) + a colophon page (archive commit, per-image B2 key + sha256, the
  **"machine-assisted translation — engine + date"** label per AGENTS.md translation
  policy, and the framing that this is propaganda held as evidence). The
  **Prospectus/Dossier** identity, print-adapted (provenance-rail motif; Didone
  source voice / grotesque apparatus voice).
- **Interface.** A new CLI/npm verb (e.g. `pdf:build`), sibling to
  `site:build`/`site:snapshot`. **Internal-first** (reads the private archive
  locally); a public deploy is a **deliberate PD subset**, mirroring the browser.
  Typst is a documented build dependency; template + fonts live in-repo.
- **Fail loud, no fallbacks** on missing/inconsistent corpus data; files ≤ 300–500
  lines; `@/` imports.
- **Detailed template typography/visual design goes through `/frontend-design`** at
  build time (the UX/UI commandment), reusing the Prospectus/Dossier tokens.

### Rejected — headless-Chrome print of a print-CSS route (reuse the website)

Add a print stylesheet + print route to the Astro site and render with Playwright's
`page.pdf()`. Strong reuse (one layout, single source of truth, Playwright already
in the stack), but the operator chose print-native typographic quality over layout
reuse; Chromium's print engine gives weaker control over pagination, running
heads, and hyphenation for a dense parallel-text edition. Kept as the fallback
engine if Typst's toolchain proves too costly.

### Rejected — hand-coded JS PDF library (pdfkit / react-pdf / pdf-lib)

Full programmatic control with no browser or external binary, but reimplements
layout by hand with the weakest typography of the three and heavy manual
box-placement for facing-page facsimile + parallel columns. Most code, least
payoff.

### Rejected — layout and unit variants

- **Stacked single page** (facsimile on top, FR/EN columns below) and
  **text-forward + plates** (flowing FR/EN, periodic facsimile plates) — both demote
  the scan, which the noisy OCR makes authoritative. Rejected in favor of the
  facing-page spread.
- **Per-whole-source** and **both/selectable** units — a bound 78-issue volume is
  huge and not the citable unit; a bound-volume option is deferred, not foreclosed.

## Decisions

1. **Typst** engine; template fed by serialized corpus data.
2. **One PDF per bibliographic item** (issue / monograph).
3. **Facing-page spread** — verso facsimile, recto parallel FR OCR │ EN translation.
4. **Reuse corpus-browser's normalized snapshot**, pinned to an archive commit
   (reproducible; single source of truth).
5. **Images fetched at generation** from B2 (`object_store` key), IIIF as the
   alternate provider; batch fetch, note Class B read cost.
6. **Front matter + colophon** carry full provenance, the machine-assisted-translation
   label, and the critical framing.
7. **Internal-first**; public export is a deliberate PD subset.
8. **v1 scope** matches the browser's shipped corpus (PB-P001 issues + PB-P008–011
   monographs), data layer generalized.
9. **Prospectus/Dossier** identity, print-adapted; detailed template design via
   `/frontend-design`.
10. **Fail loud, no fallbacks**; `@/` imports; files ≤ 300–500 lines.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Translation alignment.** EN translation is issue-level in places while the
  facing-page recto wants **per-page EN**; coordinate with the in-flight
  `source-translation` output shape (per-page vs issue-level). If only issue-level
  EN exists for an item, the recto shows per-page FR OCR with issue-level EN flowed
  or approximately aligned.
- **Image print resolution vs PDF file-size budget** (IIIF full-size vs a sized
  derivative; fidelity vs distributable size).
- **Fonts** — the exact Didone/grotesque faces, **licensed for embedding** in a
  distributed PDF (Typst embeds fonts).
- **Public export pipeline** — which PD items/pages get published and how (deliberate
  export vs building straight from the archive).
- **Bound-volume option** (per-source concatenation) — deferred; per-item chosen.
- **B2 read-cost mitigation** — whether to land `TASK-12` (CDN read-caching) or a
  local image cache before bulk PDF builds.

## Provenance

- Origin: interactive `/stack-control:design` (superpowers:brainstorming) session,
  2026-07-11, following the shipped/closed corpus-browser feature.
- Decisions 1–4 from operator answers to `AskUserQuestion` prompts (purpose, unit,
  engine, layout); the operator chose **Typst** over the recommended headless-Chrome
  reuse, and the **facing-page spread** over stacked / text-forward. v1 scope
  confirmed by the operator.
- Consumes the closed `corpus-browser` (normalized snapshot), `canonical-source-metadata`,
  and `archive-object-store` (B2 handles); consumes `source-translation` (in-flight).
- Handoff target: `/stack-control:define`.
