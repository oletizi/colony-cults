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
#import "spread.typ": facsimile-verso, parallel-recto
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

#set page(
  width: 6in,
  height: 9in,
  fill: paper,
  margin: (top: 0.72in, bottom: 0.68in, inside: 0.78in, outside: 0.62in),
  numbering: none,
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
#for pg in doc.pages {
  pagebreak(to: "even", weak: true)
  facsimile-verso(pg, source-short, images-dir)
  pagebreak(weak: true)
  parallel-recto(pg, source-short, doc.titlePage.date, prov-of(pg.folioId))
}

// ---- Colophon --------------------------------------------------------------

#pagebreak(weak: true)
#colophon-page(doc.colophon)
