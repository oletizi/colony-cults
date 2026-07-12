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
#let face-en = "IBM Plex Sans" // apparatus chrome — labels, running head, colophon
#let face-en-body = "Old Standard TT" // EN translation BODY — dense period text serif
#let face-mono = "IBM Plex Mono" // provenance/evidentiary register

// DESIGN.md § Density: the running EN translation text moves from the grotesque
// (IBM Plex Sans) to Old Standard TT — a Modern/Scotch-lineage OFL text serif
// that reads as 19th-c. letterpress and pairs with the Theano Didot display
// voice. `face-en` stays IBM Plex Sans for apparatus CHROME only (the
// `TRANSLATION · EN` label, running head, colophon). Old Standard TT carries
// full French-diacritic coverage (é è ê ç à ô œ ù î â), so it serves the FR
// register too where needed; the FR OCR body itself stays EB Garamond.

// ---- Density typography (DESIGN.md § "Density (both text rectos)") --------
//
// Shared by BOTH text rectos (parallel FR|EN and english-only) so the two
// modes read as one system. Title page, colophon, and verso are unaffected.

// Body type size / leading. NOTE: Typst `par.leading` is the GAP between lines,
// NOT the total line advance. Measured for Old Standard TT at 8pt: leading 10pt
// -> ~1.96x line advance (nearly double-spaced); leading 3pt -> ~1.09x — single,
// dense-letterpress spacing (the operator asked for single, not 1.5). 3pt is the
// tight single-spaced value.
#let body-size = 8pt
#let body-leading = 3pt

// Two-column gap in both text-recto modes (down from 22pt); the inter-column
// hairline is unchanged (drawn by the caller).
#let body-column-gap = 12pt

// Book style: first-line indent, NO blank-line inter-paragraph gap -- "a
// paragraph is marked by its indent, not a gap". The paragraph gap must equal
// the in-paragraph line gap EXACTLY (continuous rhythm). Measured at 8pt Old
// Standard: a line-pair (leading 3pt) is 14.39pt; a paragraph-pair matches at
// exactly `spacing = 3pt` (Δ 0pt). So `body-par-spacing` tracks `body-leading`.
#let body-par-spacing = 3pt

// Book-style paragraph settings for a dense text-recto column: first-line
// indent marks a new paragraph; no blank-line gap (DESIGN.md § Density). The
// first paragraph of the flow is not indented.
//
// Takes the column `body` as an argument and returns it under the `set par`.
// A bare `#let set-body-par() = { set par(...) }` DOES NOT WORK: a `set` rule
// at the end of a function body applies only to the (empty) remainder of that
// body and never leaks to the caller, so the following text kept Typst's
// DEFAULT paragraph spacing + no indent (the defect the earlier pass shipped).
// Wrapping the body so the `set` precedes it in the SAME block is what makes
// the indent + tightened spacing actually reach the flowed paragraphs --
// including inside the english-recto `columns()` / `measure()` scope, since
// the styling is baked into the returned content.
#let set-body-par(body) = {
  set par(
    first-line-indent: (amount: 1.2em, all: false),
    spacing: body-par-spacing,
    leading: body-leading,
    justify: true,
  )
  // Hyphenate at line endings (with justify, the 19th-c. tight-justified column;
  // the per-language dictionary follows `text.lang`, set by each body column).
  set text(hyphenate: true)
  body
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
