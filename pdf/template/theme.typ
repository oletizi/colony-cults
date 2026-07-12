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

// ---- Density typography (DESIGN.md § "Density (both text rectos)") --------
//
// Shared by BOTH text rectos (parallel FR|EN and english-only) so the two
// modes read as one system. Title page, colophon, and verso are unaffected.

// Body type size / leading — 8.5 / 11pt for both EN (Plex Sans) and FR (EB
// Garamond) body columns (down from 9.5/9pt at looser leading).
#let body-size = 8.5pt
#let body-leading = 11pt

// Two-column gap in both text-recto modes (down from 22pt); the inter-column
// hairline is unchanged (drawn by the caller).
#let body-column-gap = 12pt

// DESIGN.md calls for book style: first-line indent, ZERO inter-paragraph
// space -- "a paragraph is marked by its indent, not a gap". Literal
// `spacing: 0pt` is what the spec asks for, but at this size/leading Typst
// 0.15 lays out the next paragraph's first line OVER the previous paragraph's
// last line (a rendering defect, not a design choice) rather than a flush
// zero-gap join. `body-par-spacing` is the smallest value that reads as a
// flush, indent-marked join -- visually indistinguishable from the
// in-paragraph line rhythm -- without the overlap; verified against both body
// faces (EB Garamond + IBM Plex Sans) at 8.5/11pt.
#let body-par-spacing = 3pt

// Book-style paragraph settings for a dense text-recto column: first-line
// indent marks a new paragraph; no blank-line gap (DESIGN.md § Density). The
// first paragraph of the flow is not indented.
#let set-body-par() = {
  set par(
    first-line-indent: (amount: 1.2em, all: false),
    spacing: body-par-spacing,
    leading: body-leading,
    justify: false,
  )
}

// Splits OCR/translation text on blank-line paragraph breaks (`\n\n`, the
// convention `toTypstInput` emits) into REAL Typst paragraphs joined by
// `parbreak()`. Splicing a plain string into content via `#s` does NOT turn
// its embedded blank lines into genuine paragraph breaks in Typst -- without
// this, `set-body-par`'s indent/spacing never engage (the string renders as
// one run of text, or as raw linebreaks, not as separate paragraphs). Blank/
// whitespace-only segments are dropped defensively (stray blank lines in
// source OCR).
#let flow-paragraphs(s) = {
  let segments = s.split("\n\n").map(p => p.trim()).filter(p => p.len() > 0)
  for (i, seg) in segments.enumerate() {
    if i > 0 { parbreak() }
    seg
  }
}

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
