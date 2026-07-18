# Phase 0 Research: English-Source Facsimile PDF

All major unknowns were resolved in the approved design record
(`docs/superpowers/specs/2026-07-17-english-source-pdf-design.md`) via
in-session brainstorming. This file consolidates the decisions in
decision / rationale / alternatives form and records the two remaining
implementation-time verifications.

## Decision 1 — English recto presentation

- **Decision**: The English OCR text is the reading recto, drawn as a single
  reading column over the verso facsimile (the existing **english-only** layout).
- **Rationale**: Symmetric with the French english-only variant; the operator
  wants the OCR presented as reading text, with fidelity concerns carried as an
  apparatus caveat rather than by demoting the text to a searchable-only layer.
- **Alternatives considered**: Facsimile-forward (image primary, OCR
  best-effort) — rejected: the operator chose text-as-recto. Per-source choice
  (both) — rejected as unnecessary scope; one presentation covers the targets.

## Decision 2 — Routing signal

- **Decision**: Route on the folio provenance `language` field the archive
  already carries, matched **case-insensitively**. `English` → English-source
  path; `French` → existing French path; any other value → **fail loud**.
- **Rationale**: Data-driven from the archive itself (no per-source config to
  author or keep in sync), consistent with spec 014's "read exclusively from the
  archive." Preserves the French fail-loud translation gate exactly.
- **Alternatives considered**: An explicit per-source `edition:` metadata field —
  rejected: duplicates the `language` signal already present, a second source of
  truth to police. Inferring English from an **absent** `translation/` directory
  — rejected as dangerous: it would collapse the exact fail-loud gap this design
  must preserve (a French source with genuinely missing translations would render
  as an untranslated English original instead of failing loud).

## Decision 3 — Colophon provenance honesty

- **Decision**: For English sources, `machineAssist = null` and the colophon
  carries an **OCR-transcription** line (recto is a machine OCR transcription of
  the English original, with OCR engine/status + low-fidelity caveat when
  present) and **no** machine-assisted-translation line.
- **Rationale**: Scholarly honesty (Constitution I/III) — the reader must know
  the reading text is machine OCR of the scan, not a translation, especially for
  the explicitly low-fidelity press leaves.
- **Alternatives considered**: Silently omit the translation line with no OCR
  disclosure — rejected: weaker on the evidence-honesty stance.

## Decision 4 — Missing-OCR discipline

- **Decision**: An English page with neither corrected per-page OCR text nor a
  positional OCR segment **fails loud** naming the page (a genuine content gap,
  not a blank recto). Mirrors the French path's empty-OCR check.
- **Rationale**: Constitution V. The blank-recto tolerance in spec 014 is gated
  on the explicit `untranslatable` marker, which does not apply to an
  English-source page (there is no translation dimension).
- **Alternatives considered**: Tolerate empty OCR as a blank recto — rejected:
  would silence real OCR gaps.

## Decision 5 — No new reader / no downstream change

- **Decision**: The English-source path is an additive branch inside the existing
  archive-direct reader (`archive-source.ts` surfaces the reading language;
  `archive-page.ts` + `archive-edition.ts` branch). No new top-level reader; the
  Typst templates, both edition variants, object-store fetch/verify, positional
  mapping, and reproducibility are untouched.
- **Rationale**: Smallest honest surface; reuses centralized machinery; avoids
  two readers drifting.

## Implementation-time verifications (open questions — non-blocking)

- **V1 — `language` vocabulary**: Confirm the English sidecars (PB-P056–P059)
  carry `language: English` (full word) as the French sidecars carry `French`,
  versus a code (`eng`/`en`). The case-insensitive match assumes the full word;
  if a code is used, normalize at the routing seam. **Verify against real
  sidecars before wiring the match.**
  
  **CONFIRMED (2026-07-18):** Verified against archive-snapshot folio sidecars
  in `/Users/orion/work/colony-cults-work/archive-snapshot/archive/cases/port-breton/books/`.
  All English sources (PB-P056–P059) carry the full quoted word `language: "English"`,
  matching French sources' `language: "French"`. Counts: PB-P056 (52 folios),
  PB-P057 (1 folio), PB-P058 (1 folio), PB-P059 (1 folio) = 55 total English
  sidecars. Across the full archive snapshot: 55 English, 2125 French sidecars.
  No codes (`eng`, `en`, etc.) found. **Conclusion:** Case-insensitive full-word
  matching is correct; no normalization at routing seam is needed.
- **V2 — recto column header copy**: Whether the english-only recto header should
  read "Transcription" vs "Translation" for an OCR-transcription recto. A
  template-copy nicety, not structural; the english-only variant already renders
  a single reading column. **Operator decision (2026-07-18): DEFERRED to a
  follow-up** — out of scope for this feature by the operator's call (not an
  agent scope-cut; Constitution XIV). No task in this spec covers V2. If the
  header copy is later changed, that copy/typography work goes through
  `/frontend-design:frontend-design` (Principle XI).

## Reuse inventory (what already exists, unchanged)

- `resolveArchiveSource` / folio enumeration + positional `ArchivePageSource`
  (`@/pdf/load/archive-source`).
- `resolveOcrFrench` (positional OCR resolution: corrected `pNNN.fr.txt` else
  `issue.txt` segment), `deriveOcrCondition`, `deriveMachineAssist`
  (`@/pdf/load/archive-page`).
- Colophon assembly, source-meta, pin/reproducibility
  (`@/pdf/load/archive-edition`).
- Image staging + format detection + sha256 verify + Typst invoke
  (`@/pdf/render/build`).
- English-only render variant + Typst templates (`@/pdf/render/*`, unchanged).
