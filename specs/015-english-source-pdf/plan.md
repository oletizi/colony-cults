# Implementation Plan: English-Source Facsimile PDF

**Branch**: `feature/edition-publishing` (spec dir `specs/015-english-source-pdf`) | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-english-source-pdf/spec.md`; design record `docs/superpowers/specs/2026-07-17-english-source-pdf-design.md`.

## Summary

Add an **English-source rendering path** to the shipped archive-direct PDF reader (spec 014). English-language sources carry English OCR and **no translation**, so they currently hit the French path's fail-loud translation gate and cannot build. The reader gains a **language-keyed branch** (routing on the folio provenance `language` field, case-insensitive): `English` → render the English OCR as the reading recto (the existing english-only layout), skipping the per-page translation requirement; `French` → the existing FR-OCR │ EN-translation path with its fail-loud gate **unchanged**; any other language → fail loud. The English colophon carries an honest **OCR-transcription** line (machine-assist label null, no translation line). All shared machinery — folio enumeration, positional page-id mapping, object-store fetch + sha256 verification, pinned-archive reproducibility, Typst templates, both edition variants — is untouched.

## Technical Context

**Language/Version**: TypeScript 5.3, ESM, executed with `tsx`. `@/*` path imports.

**Primary Dependencies**: The spec-014 archive-direct reader (`@/pdf/load/archive-source`, `@/pdf/load/archive-page`, `@/pdf/load/archive-edition`), the edition model (`@/pdf/model`), `@/archive` provenance/location/checksum readers, the Typst edition renderer + build/batch layer (`@/pdf/render/*`), and archive-object-store (B2 masters). No new third-party dependency.

**Storage**: The normalized archive (folio `fNNN.yml` provenance sidecars carrying `language`, `issue.txt` OCR blob, optional per-page `translation/pNNN.fr.txt` corrected OCR, object-store master keys) read from a pinned archive clone (`COLONY_ARCHIVE_ROOT` / `--archive-root`). No new storage.

**Testing**: `vitest`. Unit + integration against fixture archive dirs (extend `tests/unit/pdf/archive-fixture.ts` to emit an English source: `language: English`, OCR present, **no** `translation/`). Live acceptance: real PB-P056 build.

**Target Platform**: Node/`tsx` CLI on developer machines + CI. Output is a Typst-compiled PDF.

**Project Type**: Single TypeScript CLI project; the change is a language-keyed branch inside the existing `src/pdf/load/` reader + colophon, no new top-level module.

**Performance Goals**: No change from spec 014 (build dominated by image fetch + Typst compile; the routing branch is O(1) per source).

**Constraints**: Fail loud, no fallbacks/mock outside tests; `@/` imports; no `any` / `as` / `@ts-ignore`; source files within 300–500 lines. The French path's fail-loud translation gate MUST remain byte-for-byte behavior-equivalent.

**Scale/Scope**: The English documents already acquired (PB-P056 ~52pp; PB-P057–P059 press leaves) plus any future English source. A small, additive change to three existing reader files + one fixture + tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Evidence Before Narrative / III. Provenance Is Mandatory**: PASS — the colophon honestly discloses the recto as a machine OCR transcription (not a translation), carrying OCR engine/status + low-fidelity caveat. No claim exceeds the evidence.
- **IV. Respect Copyright (Fail Closed)**: PASS — no new mirroring; English OCR of already-acquired public-domain sources. The machine-assisted labeling policy is honored by *omitting* a translation label where no translation exists (the recto is a transcription, explicitly labeled as such).
- **V. Fail Loud, No Fallbacks**: PASS — missing English OCR fails loud; an unsupported reading language fails loud; the French translation gate stays fail-loud. Absence of `translation/` on the English path is a *routing* outcome, not a silent fallback.
- **VI. Composition Over Inheritance / VII. Type Safety**: PASS — the branch composes into the existing reader functions; discriminated routing on a typed language value; no `any`/`as`/`@ts-ignore`; files stay ≤500 lines (archive-page.ts is ~258 lines, archive-edition.ts ~302 lines — the additions must not push either past 500; if archive-edition.ts approaches the limit, extract the colophon-assembly helper).
- **VIII. Faithful Tool Adoption**: PASS — authored through the stack-control front door driving Spec Kit in order.
- **XI. Design Through the Design Skill**: APPLIES (FR-013, added 2026-07-18) — the colophon template (`frontmatter.typ`) must change to render the English OCR-transcription line (the shared `assembleColophon` + template hard-code a mandatory machine-assist line; an English source cannot render without this). Because the colophon is user-facing typography, that template change is designed through `/frontend-design:frontend-design` BEFORE any markup edit. The reader/model/assembler changes (`archive-edition.ts`, `colophon.ts`, `model.ts`) are non-UI and do not.
- **XIV. The Operator Owns Scope (No Agent Scope-Cutting)**: PASS — the spec captures the full requirement set from the approved design; the FR-010/FR-013 colophon-template exception was surfaced to the operator and approved (not an agent scope-cut); the deferred V2 header-copy is an operator-recorded decision.

No violations → Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/015-english-source-pdf/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (reader routing contract)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/pdf/
├── load/
│   ├── archive-source.ts     # (touched) surface the source reading-language from folio provenance
│   ├── archive-page.ts       # (touched) language-keyed branch: English → OCR-as-recto, skip translation; empty-OCR fail-loud
│   ├── archive-edition.ts     # (touched) thread reading-language into colophon assembly; unsupported-language fail-loud
│   └── colophon.ts           # (touched, FR-013) reading-language-aware assembleColophon: French requires machine-assist label, English requires OCR-transcription disclosure; nullable translation
├── model.ts                  # (touched, FR-013) ColophonMeta.translation → nullable; add OCR-transcription disclosure field
├── template/
│   └── frontmatter.typ       # (touched via /frontend-design, FR-013) colophon-page branches: English OCR-transcription line vs French machine-assist line
└── render/
    ├── build.ts              # (unchanged expected) language-agnostic image staging + Typst invoke
    └── batch.ts              # (unchanged expected) source discovery

tests/
├── unit/pdf/
│   ├── archive-fixture.ts    # (touched) emit an English-source fixture (language: English, OCR, no translation/)
│   ├── archive-page.test.ts  # (touched) English routing + empty-OCR fail-loud + French regression
│   └── archive-edition.test.ts # (touched) English colophon + unsupported-language fail-loud
└── ...                       # English-source integration test (real-shaped fixture end to end)
```

**Structure Decision**: No new top-level reader (design decision — a separate `archive-english-source.ts` was rejected as it would duplicate folio/image/reproducibility machinery). The change is a language-keyed branch at the two points that genuinely differ — per-page assembly (`archive-page.ts`) and colophon (`archive-edition.ts`) — with `archive-source.ts` surfacing the reading language so the assembler can route. Keep each touched file within the 300–500 line guidance; extract a colophon helper from `archive-edition.ts` if the addition would exceed it.

## Complexity Tracking

> No Constitution Check violations — no entries.
