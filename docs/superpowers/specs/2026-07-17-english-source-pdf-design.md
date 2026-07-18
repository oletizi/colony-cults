---
doc-grammar: design-record
item: impl:feature/english-source-pdf
date: 2026-07-17
status: approved
---

# Design — english-source-pdf

Render English-language sources as facsimile-edition PDFs, where the **English
OCR text is the reading recto** (no French-OCR │ English-translation split, no
translation requirement). Built on the shipped archive-direct reader (spec 014):
a language-keyed branch, not a second reader.

## Problem domain

The archive-direct PDF reader (spec 014) renders every source as a French
facsimile edition. Its per-page assembler (`src/pdf/load/archive-page.ts`)
treats `issue.txt` as **French OCR** and **hard-requires** a per-page English
translation artifact (`translation/pNNN.en.txt` + `.yml` sidecar), failing loud
when it is absent (FR-008 — the safety net for genuine translation gaps):

> `loadArchivePage: no translation artifact for page "pNNN" (folio fNNN) --
> expected …/pNNN.en.txt and …/pNNN.en.txt.yml (FR-008 translation gap)`

English-language sources break on exactly this gate. Newly acquired English
documents carry **English OCR and no translation** (they are already English):

- **PB-P056** — Richmond / "New Italy" sketch, ~52 pp (monograph, English).
- **PB-P057–P059** — Hong Kong / China press leaves (English), OCR'd with an
  explicit **low-fidelity caveat recorded in provenance**.

For these, the reading text *is* the English OCR. The FR-OCR │ EN-translation
edition model does not fit: there is no French source text and no translation to
demand. They need the English OCR rendered as the reading recto over the verso
facsimile — the same single-column shape the existing **english-only** render
variant already produces for French sources' translations.

Fidelity varies: the book is best-effort OCR; the press leaves are explicitly
low-fidelity. A scholarly facsimile must not present garbled OCR as if it were a
clean transcription — the edition must disclose that the reading text is machine
OCR of the scan, and surface the low-fidelity caveat where it exists.

### In scope

- An English-source rendering path in the archive-direct reader: `language`
  routing, OCR-as-recto assembly, translation requirement skipped, honest
  colophon.
- Both existing edition variants remain: the English-source path targets the
  english-only reading recto; the parallel FR │ EN variant is unaffected.

### Out of scope

- The browser snapshot path (untouched, as in spec 014).
- Non-French, non-English editions (a third reading language) — fail loud.
- Any change to folio enumeration, object_store fetch/verify, positional
  page-id mapping, the Typst templates, or the French path's fail-loud
  translation gate.

## Solution space

### Chosen — one reader, a `language`-keyed branch

Route inside the existing archive-direct reader on the folio provenance
`language` field the archive already carries in every sidecar. `French` → the
existing path (FR-OCR │ required EN-translation, fail-loud gate intact);
`English` → a new English-source assembly path; any other language → **fail
loud** (only FR + EN editions are in scope).

On the English-source path, `archive-page.ts`:

- Reads the OCR text (corrected `pNNN.fr.txt` if present, else the positional
  `issue.txt` segment) as the **recto reading text**.
- **Skips `resolveTranslation` entirely** — no `pNNN.en.txt` is demanded. This
  is the crux: the French fail-loud translation gate must NOT fire for a source
  that legitimately has no translation.
- Places the OCR text in the edition page's English/recto field so the existing
  **english-only** render variant draws it as a single reading column over the
  verso facsimile.
- Carries `deriveOcrCondition` through unchanged, so the low-fidelity caveat
  reaches the page.

`archive-edition.ts` sets `machineAssist = null` for English sources and adds an
**OCR-transcription** colophon line (the recto is a machine OCR transcription of
the English original, with OCR engine/status + low-fidelity note when present)
and **no** machine-assisted-translation line.

Everything language-agnostic — folio enumeration, positional page-id mapping
(the extract fix), object_store fetch + sha256 verification, pinned-archive
reproducibility, the Typst templates — is untouched.

**Why chosen.** Smallest honest surface: the branch lives where the
French/English decision is actually made (per-page assembly + colophon), reusing
all folio/image/reproducibility machinery. Data-driven from the archive itself
(no per-source config to author or keep in sync), consistent with spec 014's
"read exclusively from the archive." Preserves the French fail-loud gate exactly.

### Rejected — a separate English-source reader (`archive-english-source.ts`)

A parallel top-level reader alongside `archive-edition.ts`, selected by the
build layer. **Rejected**: duplicates folio enumeration, object_store
fetch/verify, positional mapping, and reproducibility — the very machinery spec
014 centralized — and forces the build layer to decide language before a reader
exists to read it. Two readers drift; the branch is a dozen lines at the one
point that genuinely differs.

### Rejected — infer English-source from an absent `translation/` directory

Treat any source with no translation artifacts as English-source. **Rejected as
dangerous**: it silently collapses the exact fail-loud gap this design must
preserve. A French source whose translations are genuinely missing (a real
translation gap) would render as if it were an untranslated English original
instead of failing loud — converting a caught data error into a silent
mis-rendering. The `language` field is an explicit, reviewable signal; absence
of a directory is not.

### Rejected — an explicit per-source `edition:` mode field

A new canonical-source-metadata field (`edition: english-source | parallel`)
routed on instead of language. **Rejected**: adds a config field to author and
keep in sync per source, duplicating the `language` signal the archive already
carries, for no gain over reading the field that is already there. A mislabeled
`language` sidecar is an archive-data bug `bib validate` can catch; a
divergent `edition:` field is a second source of truth to police.

## Decisions

1. **English OCR is the reading recto** (english-only layout: verso facsimile │
   recto = English OCR). Symmetric with the French english-only variant. Chosen
   over a facsimile-forward (image-primary) layout — the operator wants the OCR
   presented as reading text, with the low-fidelity caveat carried as apparatus
   rather than by demoting the text.
2. **Route on the folio provenance `language` field**, matched
   **case-insensitively**. `English` → English-source path; `French` → existing
   path; **any other value → fail loud** (only FR + EN editions in scope).
3. **The English-source path skips the translation requirement entirely.** The
   French path's fail-loud EN-translation gate is unchanged and still fires for
   French sources — the safety net for genuine translation gaps stays intact.
4. **Colophon honesty.** `machineAssist = null` for English sources; the
   colophon carries an **OCR-transcription line** (recto is a machine OCR
   transcription of the English original, with OCR engine/status + low-fidelity
   caveat when present) and **no** machine-assisted-translation line.
5. **A missing OCR segment on an English source still fails loud** — same
   discipline as the French path's empty-OCR check (an English page with neither
   corrected `pNNN.fr.txt` nor an `issue.txt` segment is a genuine gap, not a
   blank recto). Blank/plate handling, if needed, remains the explicit
   untranslatable-style marker, not silent tolerance.
6. **No new reader, no new config field, no downstream changes.** The Typst
   templates, both edition variants, object_store fetch/verify, positional
   mapping, and pinned-archive reproducibility are untouched.

## Open questions

1. **Recto column label copy (non-blocking).** Whether the english-only recto
   header should read differently for an OCR-transcription recto vs. a
   translation recto (e.g. "Transcription" vs. "Translation"). A template-copy
   nicety, not a structural decision; the english-only variant already renders a
   single reading column. Deferred to implementation / a follow-up.
2. **`language` field vocabulary (verify at implementation).** Confirm the
   English sidecars carry `language: English` (vs. `eng`/`en`); the
   case-insensitive match assumes the full English word as used by the French
   sidecars. If the acquisition adapters emit a code, normalize at the routing
   seam. Verify against real PB-P056–P059 sidecars before wiring.

## Provenance

- **Requested by** the operator: "Build French now + spec English-source
  support" (AskUserQuestion answer), after the spec-014 French build (PB-P054 +
  PB-P055) surfaced that English sources don't fit the FR │ EN model.
- **Brainstorming decisions** (this session, 2026-07-17), one question at a time:
  (1) *OCR text as reading recto* — over facsimile-forward and per-source-choice;
  (2) *Archive `language` field (auto)* — over an explicit per-source edition
  mode and over absence-of-translation-dir (rejected as unsafe);
  (3) *OCR-transcription colophon line* — over silently omitting the translation
  line.
- **Builds on** spec 014 (archive-direct-pdf, shipped/merging): the archive-direct
  reader (`src/pdf/load/archive-source.ts`, `archive-page.ts`,
  `archive-edition.ts`), the Typst edition renderer, and archive-object-store
  (B2 masters).
- **Roadmap node** `impl:feature/english-source-pdf`, `depends-on:
  impl:feature/archive-direct-pdf`.
