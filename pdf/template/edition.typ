// Corpus Print PDF — the facing-page facsimile edition (spec 007, DESIGN.md).
//
// Reads its data + image directory from `sys.inputs` (see
// src/pdf/render/typst-runner.ts): `data` = path to the serialized `TypstInput`
// JSON (src/pdf/render/typst-input.ts), `images` = directory holding the verso
// page images named by the stable `<folioId>.<ext>` filename.
//
// Composition: a Prospectus/Dossier title page, then one verso-facsimile /
// recto-parallel-text spread per source page (verso always on a left/even leaf
// so it faces its recto), then the colophon evidence sheet. Deterministic: no
// dates, no randomness — identical inputs render byte-stable output (SC-004).
//
// NOTE for the build runner (T021): because the template reads its JSON + images
// via absolute paths in `sys.inputs`, `typst compile` MUST be invoked with a
// `--root` that contains those paths (Typst treats absolute paths as
// root-relative and sandboxes reads to the root), AND with
// `--font-path pdf/template/fonts` so the vendored OFL faces resolve. See
// scripts/render-sample-pdf.ts for the exact invocation.

#import "theme.typ": *
#import "spread.typ": facsimile-verso, parallel-recto, english-recto
#import "frontmatter.typ": title-page, colophon-page

// ---- Inputs ----------------------------------------------------------------

#let doc = json(sys.inputs.data)
#let images-dir = sys.inputs.images

// Short source label for running heads + captions. The corpus title is already
// concise; used verbatim as the "source short".
#let source-short = doc.titlePage.title

// The colophon carries the forensic record per folio; the recto rail looks it
// up by folioId.
#let prov-of(folio) = doc.colophon.images.find(im => im.folioId == folio)

// ---- Document + page defaults ----------------------------------------------

#set document(title: doc.titlePage.title, author: (), date: none)

// Margins (DESIGN.md § Density): all four halved for a period-newspaper-tight
// text block — inner/gutter 0.3in, outer 0.375in (holds the repositioned oxblood
// rail), top 0.3in, bottom 0.325in.
#let page-w = 6in
#let page-h = 9in
#let m-top = 0.3in
#let m-bottom = 0.325in
#let m-inside = 0.3in
#let m-outside = 0.375in

// The inter-column rule is drawn as a page FOREGROUND (not an in-flow placed
// rect, which can't repeat across page breaks and isn't bounded to the text
// area). It runs at the horizontal centre of the recto text block (= the column
// gutter centre). A `recto-rule` state flag (theme.typ) gates it to recto-text
// pages only — set true at each recto, false at each verso / title / colophon —
// avoiding the extra-blank-page hazard of toggling `set page` mid-flow. Its TOP
// is the recorded column top on the recto's first leaf (below the header), and
// the top margin on continuation leaves (no header); its bottom is the bottom
// margin. So the rule is exactly the length of the text column.
#let col-rule-x = m-inside + (page-w - m-inside - m-outside) / 2

#set page(
  width: page-w,
  height: page-h,
  fill: paper,
  margin: (top: m-top, bottom: m-bottom, inside: m-inside, outside: m-outside),
  numbering: none,
  foreground: context {
    if recto-rule.get() {
      let sy = if here().page() == recto-start-page.get() { recto-col-top.get() } else { m-top }
      place(
        top + left,
        dx: col-rule-x,
        dy: sy,
        rect(width: 0.4pt, height: page-h - m-bottom - sy, fill: rule-col),
      )
    }
  },
)

#set text(fill: source-ink, hyphenate: false, lang: "fr")
#set par(justify: false)

// ---- Title page ------------------------------------------------------------

#title-page(doc.titlePage, doc.colophon.archiveRef)

// ---- Facing-page spreads ---------------------------------------------------
//
// Each spread is a verso facsimile facing its recto text. `pagebreak(to:
// "even")` forces every verso onto a left-hand leaf so it always faces its
// recto, regardless of how far the previous recto's columns ran.
// The recto branches on the per-build `showFrench` toggle (DESIGN.md § "Variant:
// English-only recto"): the two-column parallel FR|EN study recto when true, the
// two-column English-only reading recto when false. Everything else — verso,
// running head, folio markers, rail, front/back matter — is identical.
#for pg in doc.pages {
  recto-rule.update(false) // clear BEFORE the parity break: no rule on the blank leaf or the verso
  pagebreak(to: "even", weak: true)
  facsimile-verso(pg, source-short, images-dir)
  pagebreak(weak: true)
  recto-rule.update(true) // recto (+ any continuation leaves): column rule
  if doc.showFrench {
    parallel-recto(pg, source-short, doc.titlePage.date, prov-of(pg.folioId))
  } else {
    english-recto(pg, source-short, doc.titlePage.date, prov-of(pg.folioId))
  }
}

// ---- Colophon --------------------------------------------------------------

#recto-rule.update(false)
#pagebreak(weak: true)
#colophon-page(doc.colophon, doc.showFrench)
