# Implementation Plan: Source-Group Facsimile PDF (Papers Past NZ press)

**Branch**: `feature/edition-publishing` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-source-group-pdf/spec.md`

## Summary

Extend the shipped archive-direct PDF build (spec 014) + english-only reading path
(spec 015) to render source-group members — the Papers Past NZ press clippings
(group PB-P060, members PB-P061..PB-P092) — as facsimile PDFs, producing BOTH a
per-member PDF and one combined group edition. Four build-side additions, no new
rendering machinery: (1) wire the existing member-layout registration into
`buildSource` + batch discovery; (2) a reusable materializer that writes
`issue.txt` + provenance into a member's archive dir from its detached `ocr-text`
asset; (3) member rendering that stacks the member's page-image segments into one
verso facing the english-only OCR recto; (4) a group-edition assembler over a
source-group selector, ordering members chronologically. Fail loud / no
fabrication throughout; batch failures are attributable and record-and-continue.

## Technical Context

**Language/Version**: TypeScript on Node.js (run via `tsx`), `@/`-path imports.

**Primary Dependencies**: existing archive-direct reader (`@/pdf/load/archive-source`),
render/batch (`@/pdf/render/{build,batch}`), edition model + Typst template, the
member-layout bridge (`@/archive/member-layout`), the B2 object-store client
(`@/archive/*`), and the `typst` binary. No new runtime dependency (segment
stacking uses Typst layout, not an image library).

**Storage**: the private archive worktree (folio sidecars, materialized
`issue.txt`) + Backblaze B2 (page-image + ocr-text asset bytes). The build reads
archive-direct; asset bytes are fetched from B2.

**Testing**: Vitest — `tests/unit/pdf/**`, `tests/integration/pdf/**`, reusing the
fixture-archive helpers (`writeFixtureArchive`, fake Typst runner, fixture fetch).

**Target Platform**: local operator CLI (`pdf:build`), internal-first (writes only
under `--out`; no publish/upload).

**Project Type**: single project — CLI + supporting library modules under `src/`.

**Performance Goals**: not latency-bound; correctness + reproducibility (pinned
archive commit in the colophon) are the goals. Batch builds are record-and-continue.

**Constraints**: fail loud / no fallbacks (Principle V); provenance mandatory on the
materialized `issue.txt` (Principle III/XV); type-safe, no `any`/`as`/`@ts-ignore`
(Principle VII); source files stay within 300–500 lines (Principle VII).

**Scale/Scope**: PB-P060 has ~32 members; the mechanism is general to any
source-group of English clippings. Out of scope: cross-masthead syndication dedup
(FR-015), public/site export (Assumptions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **III Provenance Is Mandatory / XV Metadata Integrity** — the materialized
  `issue.txt` is a derived reader artifact of an already-recorded `ocr-text` asset;
  it MUST be written with a provenance sidecar recording the source asset key,
  checksum, and representation (FR-003). No orphan bytes: it references existing
  SSOT-recorded assets; it introduces no new unrecorded object-store bytes. **PASS.**
- **IV Respect Copyright (Fail Closed)** — PB-P060 members are NZ public-domain
  ("No known copyright"); rendering is permitted. **PASS.**
- **V Fail Loud, No Fallbacks** — every missing/unresolvable required input aborts
  with an attributable, id-naming error; nothing fabricated (FR-012). **PASS.**
- **VI Composition Over Inheritance / VII Type Safety + File Size** — additions are
  new functions/modules composed into the existing build; no inheritance, no type
  escapes; new modules kept < ~300 lines (materializer, group assembler split out).
  **PASS (verified in Phase 1 structure).**
- **VIII Faithful Tool Adoption / XIV Operator Owns Scope** — authored through the
  stack-control front door in prescribed order; nothing cut (all design open
  questions captured as spec Assumptions, not deferred scope). **PASS.**
- **XI Design Through the Design Skill** — the only visual surface is the segment-
  stacking verso layout, a variant of the existing Typst facing-page template; if
  it becomes a genuine new UI/layout, route through `/frontend-design`. Flagged as a
  Phase-1 checkpoint. **PASS (with checkpoint).**

No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/017-source-group-pdf/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI selector + materializer + reader contracts)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── archive/
│   ├── member-layout.ts          # existing bridge (ensureMemberLayoutRegistered) — reused
│   └── issue-text-materialize.ts  # NEW: materialize issue.txt (+ provenance) from ocr-text asset
├── pdf/
│   ├── load/
│   │   └── archive-source.ts     # reader — unchanged reading path (consumes issue.txt)
│   └── render/
│       ├── build.ts              # buildItem — segment-stacking verso for a member
│       ├── batch.ts              # buildSource + discovery — wire member-layout registration
│       └── group-edition.ts      # NEW: assemble a source-group selector into one PDF
└── cli/ or scripts/build-pdf.ts  # selector handling: detect source-group id

tests/
├── unit/pdf/                     # member-layout-in-build, materializer, segment-stack, group order
└── integration/pdf/             # member end-to-end (PB-P061) + group edition (PB-P060)
```

**Structure Decision**: single project; additions are two new small modules
(`issue-text-materialize.ts`, `group-edition.ts`) plus targeted edits to
`batch.ts` (registration wiring) and `build.ts` (segment-stacking verso). The
reader (`archive-source.ts`) is unchanged — the materializer makes the member's
archive dir shaped like the working PB-P057 monograph the reader already handles.

## Complexity Tracking

> No Constitution Check violations — no entries.
