# Vendored fonts — `pdf/template/fonts/`

The four faces the facing-page edition uses (DESIGN.md § Type). All four are SIL
Open Font License (OFL) 1.1 — embeddable **and** redistributable — so the
rendered PDF may embed them and this directory may be committed to the repo.
The build compiles with a pinned `--font-path pdf/template/fonts` (and
`--ignore-system-fonts` where determinism matters) so output never depends on
system fonts (SC-004).

| file | family (Typst name) | role (DESIGN.md) | OFL source |
|------|---------------------|------------------|------------|
| `TheanoDidot-Regular.ttf` | Theano Didot | source/display voice — title, section openers | CTAN `theanodidot` package: <https://ctan.org/pkg/theanodidot> (`truetype/TheanoDidot-Regular.ttf`; by Alexey Kryukov, retired from Google Fonts, still OFL 1.1) |
| `EBGaramond[wght].ttf` | EB Garamond | FR OCR body (recto, left) | google/fonts OFL: <https://github.com/google/fonts/tree/main/ofl/ebgaramond> (variable, weight 400–800) |
| `EBGaramond-Italic[wght].ttf` | EB Garamond (italic) | FR emphasis / creator line | google/fonts OFL: <https://github.com/google/fonts/tree/main/ofl/ebgaramond> |
| `IBMPlexSans[wdth,wght].ttf` | IBM Plex Sans | EN translation body + apparatus labels | google/fonts OFL: <https://github.com/google/fonts/tree/main/ofl/ibmplexsans> (variable, weight 100–700) |
| `IBMPlexMono-Regular.ttf` | IBM Plex Mono | provenance data (rail + colophon) | google/fonts OFL: <https://github.com/google/fonts/tree/main/ofl/ibmplexmono> |
| `IBMPlexMono-Medium.ttf` | IBM Plex Mono (500) | provenance emphasis | google/fonts OFL: <https://github.com/google/fonts/tree/main/ofl/ibmplexmono> |

## License texts

- `OFL-TheanoDidot.txt` — SIL OFL 1.1 (from the CTAN `theanodidot/doc/` dir).
- `OFL-EBGaramond.txt` — SIL OFL 1.1.
- `OFL-IBMPlexSans.txt` — SIL OFL 1.1.
- `OFL-IBMPlexMono.txt` — SIL OFL 1.1.

Every file above is licensed under the SIL Open Font License, Version 1.1
(2007). The OFL permits use, study, modification, and redistribution of the
fonts (including bundled/embedded in a document) provided they are not sold on
their own; each accompanying `OFL-*.txt` carries the full license terms.

## Notes

- EB Garamond and IBM Plex Sans are **variable** fonts; Typst 0.15 instances the
  weight axis it needs (body 400, labels ~600, EN emphasis) from the single file
  per family. IBM Plex Mono is shipped as two static weights (400 + 500).
- Theano Didot is used at a single weight (Regular) for the display register;
  the CTAN package also ships a "Bold", but it carries weight-400 OS/2 metadata
  (indistinguishable to Typst) and the design needs only the Regular, so it is
  intentionally not vendored.
