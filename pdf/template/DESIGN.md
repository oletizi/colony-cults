# Corpus Print PDF — template design (Prospectus / Dossier)

The design direction for `pdf/template/edition.typ` (feature corpus-print-pdf, spec 007), produced
through the `/frontend-design` gate (Constitution XI). The implementer authors the Typst template to
THIS spec; do not off-road the type/color/layout decisions.

## Thesis

The edition holds 1880s French colonization **propaganda** (the Marquis de Rays' fraudulent Port
Breton / *La Nouvelle France* scheme) as **evidence**. The whole design stages one ethical move:
let the seductive source voice speak, then visibly distance and forensically pin it. Two registers:

- **Prospectus** — the historical *source voice*: 19th-century French letterpress, persuasive,
  ornate. Used for the source title and the facsimile's own world.
- **Dossier** — the modern *apparatus voice*: cool, editorial, evidentiary. Labels, provenance,
  machine-derived annotations, the colophon.

The **facsimile scan is the authority.** OCR and translation are visibly machine-derived apparatus,
never presented as truth.

## Color (6 named values — restraint; the scan is the hero, paper recedes)

| token | hex | role |
|-------|-----|------|
| `paper` | `#FAF8F3` | warm-neutral archival paper (deliberately lighter/cooler than the AI-cream default; recessive so the scan dominates) |
| `source-ink` | `#1A1714` | warm near-black — the Prospectus/source voice |
| `apparatus-ink` | `#3B424B` | cool graphite — the Dossier/apparatus voice (labels, EN translation) |
| `oxblood` | `#7A2E28` | THE single accent — iron-gall/official-seal register; used ONLY on the provenance rail, the title-page dividing rule, and framing marks |
| `rule` | `#CDC7BC` | muted hairline structural rules + the facsimile keyline |
| `faint` | `#8A8578` | folios, captions, column labels, secondary metadata |

One accent, one place. No background tints on text (print restraint + reproducibility).

## Type (4 roles, ALL SIL OFL — embeddable + redistributable; vendor under `pdf/template/fonts/`)

- **Theano Didot** (OFL, GFS) — *source/display voice*. Title-page source title, section openers,
  drop initial. Authentic 19th-c. French Didot (chosen over the overused Playfair Display).
- **EB Garamond** (OFL) — *FR OCR body*. Warm French Garalde; the source-language transcription
  reads in the source register. Pairs historically with the Didot display.
- **IBM Plex Sans** (OFL) — *EN translation body + apparatus labels*. The modern editorial voice.
  The FR-serif / EN-sans split is FUNCTIONAL: the face tells you which register (and language) you
  are reading, and marks the EN as machine-derived apparatus, not source.
- **IBM Plex Mono** (OFL) — *provenance data*. Archive commit, object-store keys, sha256, dates —
  monospace = the evidentiary/machine register.

### Type scale (page trim ≈ 6×9in / octavo; adjust leading for the chosen trim)

| element | face | size / leading |
|---------|------|----------------|
| Title-page source title | Theano Didot | 34–40pt / tight |
| Section opener | Theano Didot | 18pt |
| FR OCR body (recto, left col) | EB Garamond | 9.5 / 13pt, ragged-right |
| EN translation body (recto, right col) | IBM Plex Sans | 9 / 13pt, ragged-right |
| Column labels | IBM Plex Sans, tracked UPPERCASE | 6.5pt, `faint` |
| Running head / folio | IBM Plex Sans / Mono | 7pt |
| Provenance data (rail + colophon) | IBM Plex Mono | 6.5–7.5pt |
| Colophon framing prose | EB Garamond | 9.5 / 14pt |

## Layout

**Facing-page spread (fixed structure):**

- **VERSO (left) = facsimile.** The scan dominates within a modest margin, wrapped in a 0.5pt `rule`
  keyline that asserts it as the plate/artifact. Beneath: a Plex Sans caption in `faint` —
  `Facsimile · <source short> · f0XX · scan is authoritative`. Folio marker (Plex Mono) in the outer
  corner. The verso is quiet; the scan is the hero.
- **RECTO (right) = parallel text, two columns.** Header: running head (Plex Sans small caps —
  `<source short> · <issue date> · f0XX`) over a hairline `rule`. Then:
  - Left column — FR OCR in EB Garamond, under a tracked label `TRANSCRIPTION · FR (OCR)`.
  - Right column — EN translation in IBM Plex Sans, under `TRANSLATION · EN (MACHINE-ASSISTED)` with
    a small `oxblood` tick.
  - A thin `rule` hairline between the columns.
  - Machine-derived status is marked by the sans face + the explicit labels + the rail — never a
    heavy tint.

**SIGNATURE — the provenance rail.** A thin `oxblood` vertical rule down the OUTER edge of every
recto, carrying in Plex Mono (stacked/rotated) the page's forensic anchor: `f0XX · <objkey tail> ·
<sha256 prefix 10>`. Every page of propaganda text is literally tethered to its evidence fingerprint.
This is the Dossier made visible and the one memorable element — keep everything else disciplined.

**TITLE PAGE — the thesis in one page.** Above: the *Prospectus* — Theano Didot source title,
creator, place/date, composed like an 1880s French prospectus (echoing the propaganda's own
self-presentation). Then a full-width `oxblood` rule — the moment of critical distance. Below the
rule: the *Dossier* — Plex Sans/Mono block with rights, ARK, `Facsimile edition · <archive commit
short>`. Seduction above the line, sober evidence below it.

**COLOPHON — the evidence sheet.** Plex Mono data block: full pinned archive commit; a table of per
-image `f0XX · object-store key · sha256`; the machine-assist label `<engine> · <date>`. Then the
critical-framing statement (the `EVIDENCE_FRAMING` string) set in EB Garamond — the one place the
editorial voice speaks in prose — closing the volume. A small `oxblood` bracketed mark anchors it.

## Variant: English-only recto (config toggle)

A per-build toggle (default: French **on**, the two-column parallel edition above). When French is
**off**, the operator wants more English adjacent to the facing scan. This is the *reading edition* to
the parallel edition's *study edition* — same identity, same tokens, same faces, same verso, same
running head, same oxblood provenance rail. Only the recto text block changes.

**Why this also fixes overflow.** The two-column EN column is only ~half the recto (a cramped ~40-char
measure), which is the main reason dense pages overflow across many continuation leaves. A single
English column roughly doubles the measure → far more text per page → the translation stays adjacent
to its scan.

**English-only recto composition:**

- **English in TWO columns** (newspaper flow: fill the left column, continue into the right), IBM Plex
  Sans **9 / 13pt** ragged-right — the SAME face/size/measure as the parallel mode's EN column, so a
  comfortable ~38–42-char measure per column. A single wide column is too wide to read; two columns keep
  the measure right AND fit ~2× the English per page vs the old single half-width EN column — that is the
  density gain that keeps the translation adjacent to its scan.
- **The two English columns span the full recto text measure** (the width the FR|EN pair used together).
  Text flows column-to-column across the leaf, then onto the next recto — like the newspaper it
  reproduces.
- **Label:** drop `TRANSCRIPTION · FR (OCR)`. Keep ONE `TRANSLATION · EN (MACHINE-ASSISTED)` header with
  its small `oxblood` tick, spanning above the two columns — the machine-derived marking MUST remain (the
  scan is still authoritative; the recto is still apparatus, not source).
- **Keep the thin inter-column `rule` hairline** between the two English columns — the recto stays
  structurally identical to the parallel mode (two columns + hairline + running head + rail); only the
  content (EN|EN flow instead of FR|EN) and the single header change. This is what makes the two modes
  read as one system.
- **Unchanged:** verso facsimile, running head, folio markers, the provenance rail, the title page, the
  colophon. Both modes are visibly one system — the study edition holds source beside translation; the
  reading edition gives the translation room. The colophon should still state which mode built it (a
  one-line `Plex Mono` note, e.g. `edition: english-only` / `edition: parallel FR|EN`) so the artifact
  is self-describing.

## Reproducibility notes for the implementer

- Vendor the four OFL font files under `pdf/template/fonts/` and compile with a pinned `--font-path`
  so output is deterministic (SC-004). Do not rely on system fonts.
- The template reads its data + image dir from `sys.inputs` (`data`, `images`) — see
  `src/pdf/render/typst-runner.ts`. Images are referenced by the STABLE per-folio filename
  (`<folioId>.<ext>`), not the volatile build-temp path.
- No animation, no color beyond the six tokens, no decoration that is not the provenance rail.
