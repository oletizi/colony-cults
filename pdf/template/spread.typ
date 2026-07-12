// The facing-page spread (DESIGN.md § Layout): a quiet VERSO facsimile facing a
// RECTO of parallel FR-OCR / EN-translation text carrying the oxblood
// provenance rail. Imported by edition.typ.

#import "theme.typ": *

// ---- VERSO (left) = facsimile ---------------------------------------------
//
// The scan is the hero: it dominates within a modest margin, wrapped in a
// 0.5pt `rule` keyline that asserts it as the plate. A faint Plex Sans caption
// sits beneath; a Plex Mono folio marker sits in the outer corner. The verso
// is otherwise silent.
#let facsimile-verso(pg, source-short, images-dir) = {
  // Folio marker — outer corner. On a verso (left page) the outer edge is left.
  place(top + left, text(font: face-mono, size: 7pt, fill: faint, pg.folioId))

  align(center + horizon)[
    #box(stroke: 0.5pt + rule-col, inset: 5pt)[
      #image(images-dir + "/" + pg.verso.imagePath, fit: "contain", height: 6.2in)
    ]
    #v(11pt)
    #text(font: face-en, size: 6.5pt, fill: faint, tracking: 0.3pt)[
      Facsimile · #source-short · #pg.folioId · scan is authoritative
    ]
  ]
}

// ---- the provenance rail (THE signature) ----------------------------------
//
// A thin oxblood vertical rule down the OUTER edge of every recto, carrying the
// page's forensic anchor in Plex Mono, rotated: `f0XX · <objkey tail> ·
// <sha256 prefix 10>`. Every page of propaganda is tethered to its fingerprint.
#let key-tail(key) = {
  let parts = key.split("/")
  if parts.len() >= 2 { parts.slice(parts.len() - 2).join("/") } else { key }
}

#let provenance-rail(pg, prov) = {
  // `prov` is the colophon image record for this folio (folioId/key/sha256),
  // or `none` if — defensively — the colophon lacks it.
  let anchor = if prov == none {
    pg.folioId
  } else {
    pg.folioId + "  ·  " + key-tail(prov.objectStoreKey) + "  ·  " + clip(prov.sha256, 10)
  }
  // Sit in the outer (right) margin of the recto, below the running head.
  // The outer margin was halved to 0.375in (edition.typ § Density), so the rail
  // `dx` is reduced from 0.44in to 0.1in to keep the oxblood rule + rotated
  // Plex Mono text fully WITHIN that narrower margin band and on-page (verified
  // in a compiled render — nothing clipped at the page edge).
  place(
    top + right,
    dx: 0.1in,
    dy: 4pt,
    box(height: 6.4in)[
      #place(top + left, rect(width: 0.6pt, height: 6.4in, fill: oxblood))
      #place(
        horizon + left,
        dx: 5pt,
        rotate(
          90deg,
          origin: horizon + left,
          reflow: false,
          text(font: face-mono, size: 6.5pt, fill: oxblood, tracking: 0.2pt, anchor),
        ),
      )
    ],
  )
}

// ---- RECTO (right) = parallel text ----------------------------------------
//
// Running head over a hairline; two ragged-right columns (FR OCR left in EB
// Garamond, EN translation right in IBM Plex Sans) split by a hairline; the
// oxblood provenance rail down the outer edge. Machine-derived status is marked
// by the sans face + the explicit labels + the rail — never a heavy tint.
#let parallel-recto(pg, source-short, issue-date, prov) = {
  // Running head.
  block(width: 100%)[
    #text(font: face-en, size: 7pt, weight: 500, fill: apparatus-ink, tracking: 0.5pt)[
      #smallcaps(source-short) · #issue-date · #pg.folioId
    ]
    #v(3pt)
    #hairline()
  ]
  v(12pt)

  // Two columns; the dividing rule is drawn per-page as the page foreground
  // (edition.typ `col-rule`), so it spans the text area and repeats on every leaf.
  grid(
    columns: (1fr, 1fr),
    column-gutter: body-column-gap,
    // FR OCR — source register (EB Garamond, unchanged).
    [
      #label-caps("Transcription · FR (OCR)")
      #v(6pt)
      #set-body-par(
        text(font: face-fr, size: body-size, fill: source-ink, lang: "fr")[#flow-paragraphs(pg.recto.ocrFrench)],
      )
    ],
    // EN translation — apparatus register (machine-assisted). Body in the dense
    // period serif (face-en-body); the label above stays IBM Plex Sans chrome.
    [
      #label-caps("Translation · EN (Machine-assisted)", tick: true)
      #v(6pt)
      #set-body-par(
        text(font: face-en-body, size: body-size, fill: apparatus-ink, lang: "en")[#flow-paragraphs(pg.recto.english)],
      )
    ],
  )

  // OCR-condition apparatus note, only when present (null renders nothing).
  if pg.recto.ocrCondition != none {
    v(10pt)
    hairline(length: 30%, stroke-width: 0.4pt)
    v(4pt)
    text(font: face-mono, size: 6.5pt, fill: faint)[
      OCR condition · #pg.recto.ocrCondition
    ]
  }

  provenance-rail(pg, prov)
}

// ---- RECTO (right) = English-only (the reading edition) --------------------
//
// DESIGN.md § "Variant: English-only recto": when French is off, the recto
// gives the translation room. Structurally identical to the parallel recto —
// running head, TWO columns spanning the full text measure, the inter-column
// hairline, and the oxblood rail — but the two columns are the SAME English
// text flowing newspaper-style (fill the left column, continue into the right),
// under ONE spanning `TRANSLATION · EN` label. The FR column + its label are
// dropped; nothing is added back. Same EN body face/size (Old Standard TT,
// DESIGN.md § Density: 8/10pt) so the per-column measure stays comfortable.
#let english-recto(pg, source-short, issue-date, prov) = {
  // Running head — identical to the parallel recto.
  block(width: 100%)[
    #text(font: face-en, size: 7pt, weight: 500, fill: apparatus-ink, tracking: 0.5pt)[
      #smallcaps(source-short) · #issue-date · #pg.folioId
    ]
    #v(3pt)
    #hairline()
  ]
  v(12pt)

  // ONE spanning label (the FR label is dropped; the machine-assisted EN mark
  // MUST remain — the scan is still authoritative, the recto still apparatus).
  label-caps("Translation · EN (Machine-assisted)", tick: true)
  v(6pt)

  // Two columns of the SAME English, newspaper flow (fill the left column,
  // continue into the right, then onto the next leaf). The dividing rule is
  // drawn per-page as the page foreground (edition.typ `col-rule`) so it spans
  // the text area and repeats on every leaf — no in-flow placed rect.
  columns(2, gutter: body-column-gap)[
    #set-body-par(
      text(font: face-en-body, size: body-size, fill: apparatus-ink, lang: "en")[#flow-paragraphs(pg.recto.english)],
    )
  ]

  // OCR-condition apparatus note, only when present (null renders nothing).
  if pg.recto.ocrCondition != none {
    v(10pt)
    hairline(length: 30%, stroke-width: 0.4pt)
    v(4pt)
    text(font: face-mono, size: 6.5pt, fill: faint)[
      OCR condition · #pg.recto.ocrCondition
    ]
  }

  provenance-rail(pg, prov)
}
