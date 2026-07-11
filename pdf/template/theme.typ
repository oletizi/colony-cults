// Prospectus / Dossier — the shared design tokens (DESIGN.md).
//
// The whole edition draws from EXACTLY six colour tokens and four OFL faces.
// Nothing in this template may introduce a colour or a family beyond these.
// Imported by edition.typ, frontmatter.typ, and spread.typ.

// ---- Colour: the 6 named values (DESIGN.md § Color) ------------------------

#let paper = rgb("#FAF8F3") // warm-neutral archival paper (recessive)
#let source-ink = rgb("#1A1714") // warm near-black — the source/Prospectus voice
#let apparatus-ink = rgb("#3B424B") // cool graphite — the Dossier/apparatus voice
#let oxblood = rgb("#7A2E28") // THE single accent — rail, title rule, framing marks
#let rule-col = rgb("#CDC7BC") // muted hairline rules + the facsimile keyline
#let faint = rgb("#8A8578") // folios, captions, labels, secondary metadata

// ---- Type: the 4 OFL roles (DESIGN.md § Type) ------------------------------

#let face-display = "Theano Didot" // source/display voice
#let face-fr = "EB Garamond" // FR OCR body — source register
#let face-en = "IBM Plex Sans" // EN translation body + apparatus labels
#let face-mono = "IBM Plex Mono" // provenance/evidentiary register

// ---- Shared marks ----------------------------------------------------------

// A tracked, uppercase column/section label in the apparatus register
// (DESIGN.md: "column labels — IBM Plex Sans, tracked UPPERCASE, faint"). When
// `tick` is set, a small oxblood mark prefixes it (the EN-translation label).
#let label-caps(body, tick: false) = {
  set text(font: face-en, size: 6.5pt, weight: 600, fill: faint, tracking: 1.3pt)
  if tick {
    // A drawn oxblood mark (not a glyph) so the tick never depends on font
    // coverage — the machine-assisted-EN signal.
    box(baseline: -0.2pt, rect(width: 3.5pt, height: 3.5pt, fill: oxblood, stroke: none))
    h(4pt)
  }
  upper(body)
}

// A structural hairline in `rule-col` (the keyline / column / header rule).
#let hairline(length: 100%, stroke-width: 0.5pt) = {
  line(length: length, stroke: stroke-width + rule-col)
}

// First `n` characters of a string, clamped to its length (safe slicing for
// commit shorts + sha prefixes).
#let clip(s, n) = if s.len() > n { s.slice(0, n) } else { s }
