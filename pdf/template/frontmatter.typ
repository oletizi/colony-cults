// Front + back matter (DESIGN.md § Layout): the title page (Prospectus above an
// oxblood rule, Dossier below) and the colophon (the evidence sheet). Imported
// by edition.typ.

#import "theme.typ": *

// ---- TITLE PAGE — the thesis in one page -----------------------------------
//
// Above the rule: the Prospectus — Theano Didot source title, creator,
// place/date, composed like an 1880s French prospectus. Then a full-width
// oxblood rule (the moment of critical distance). Below: the Dossier — a cool
// Plex Sans/Mono block with rights, ARK, and the facsimile-edition commit.
#let title-page(tp, archive-ref) = {
  set align(center)
  v(1.15in)

  // --- Prospectus (the seductive source voice) ---
  text(font: face-en, size: 7.5pt, weight: 600, fill: faint, tracking: 3pt)[PROSPECTUS]
  v(26pt)
  text(font: face-display, size: 34pt, fill: source-ink)[#tp.title]
  v(18pt)
  if tp.creator != none {
    text(font: face-fr, style: "italic", size: 13pt, fill: source-ink)[#tp.creator]
    v(8pt)
  }
  text(font: face-display, size: 12pt, fill: apparatus-ink)[#tp.date]

  v(34pt)
  // The full-width oxblood rule — seduction above, sober evidence below.
  line(length: 100%, stroke: 1pt + oxblood)
  v(26pt)

  // --- Dossier (the cool apparatus voice) ---
  text(font: face-en, size: 7pt, weight: 600, fill: faint, tracking: 3pt)[DOSSIER]
  v(16pt)
  text(font: face-en, size: 8.5pt, fill: apparatus-ink)[#tp.rights]
  v(9pt)
  if tp.ark != none {
    text(font: face-mono, size: 7.5pt, fill: faint)[#tp.ark]
    v(5pt)
  }
  if tp.catalogUrl != none {
    text(font: face-mono, size: 6.5pt, fill: faint)[#tp.catalogUrl]
    v(9pt)
  }
  text(font: face-mono, size: 7.5pt, fill: apparatus-ink)[
    Facsimile edition · #clip(archive-ref, 12)
  ]
}

// ---- COLOPHON — the evidence sheet -----------------------------------------
//
// A Plex Mono data block (pinned commit, per-image folio/key/sha256 table, the
// machine-assist label), then the critical-framing statement set in EB Garamond
// — the one place the editorial voice speaks in prose — anchored by a small
// oxblood bracketed mark.
#let colophon-image-rows(images) = {
  images
    .map(im => (
      text(font: face-mono, size: 6.5pt, fill: apparatus-ink)[#im.folioId],
      text(font: face-mono, size: 6.5pt, fill: apparatus-ink)[#im.objectStoreKey],
      text(font: face-mono, size: 6.5pt, fill: apparatus-ink)[#clip(im.sha256, 16)],
    ))
    .flatten()
}

#let colophon-page(col) = {
  text(font: face-display, size: 18pt, fill: source-ink)[Colophon]
  v(5pt)
  line(length: 34%, stroke: 0.9pt + oxblood)
  v(16pt)

  // --- the pinned evidentiary data block ---
  set text(font: face-mono, size: 7pt, fill: apparatus-ink)
  grid(
    columns: (auto, 1fr),
    row-gutter: 4pt,
    column-gutter: 12pt,
    text(fill: faint)[archive commit], [#col.archiveRef],
    text(fill: faint)[source], [#col.snapshotSourceId],
    text(fill: faint)[machine assist],
    {
      col.translation.engine
      if col.translation.model != none [ · #col.translation.model]
      [ · #col.translation.retrieved]
    },
  )

  v(16pt)
  label-caps("Embedded facsimiles · object-store keys · sha256")
  v(7pt)
  table(
    columns: (auto, 1fr, auto),
    stroke: none,
    align: left,
    inset: (x: 4pt, y: 2.6pt),
    text(font: face-en, size: 6pt, weight: 600, fill: faint, tracking: 0.8pt)[FOLIO],
    text(font: face-en, size: 6pt, weight: 600, fill: faint, tracking: 0.8pt)[OBJECT-STORE KEY],
    text(font: face-en, size: 6pt, weight: 600, fill: faint, tracking: 0.8pt)[SHA256],
    ..colophon-image-rows(col.images),
  )

  // --- the critical framing statement (the editorial voice, in prose) ---
  v(26pt)
  grid(
    columns: (auto, 1fr),
    column-gutter: 10pt,
    text(font: face-display, size: 15pt, fill: oxblood)[\[ ],
    {
      set par(justify: false, leading: 0.7em)
      text(font: face-fr, size: 9.5pt, fill: source-ink)[#col.framing]
    },
  )
}
