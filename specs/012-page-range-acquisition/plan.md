# Implementation Plan: Page-range (excerpt) acquisition

**Branch**: `feature/corpus-gap-closure` (numbered spec dir `specs/012-page-range-acquisition`) | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-page-range-acquisition/spec.md`; design record `docs/superpowers/specs/2026-07-15-page-range-acquisition-design.md` (HOW, source of truth).

## Summary

Let a researcher acquire only the pertinent folios of a large digitized document instead of the whole thing. Add an optional `--pages <spec>` flag to the shipped `bib fetch-source` (single-document path): a pure folio-range parser turns `48-50` / `48,50,52` / `48-50,55` into a de-duplicated ascending folio set, and the existing per-page fetch pipeline (`src/fetch/issue.ts`, shared by `fetchMonograph`/`fetchIssue`) iterates that set instead of `1..pageCount`. Every downstream step — IIIF image fetch, checksum, B2 master, per-page provenance sidecar, reconcile — is reused unchanged; an excerpt differs only in WHICH folios are fetched. `RepositoryRecord` gains an optional `folios: number[]` recording the intended extent, so an excerpt is self-describing and counts as complete when held folios == declared folios (decoupled from the document's total page count — no `held==pageCount` gate exists to conflict with, verified). Fail loud on an out-of-bounds folio, a malformed/reversed range, or an empty set. First consumer: PB-P054 (folios 48–50 of `bpt6k61587296`), advancing it from `to-collect` to `archived`.

## Technical Context

**Language/Version**: TypeScript ~5.3 on Node, executed via `tsx` (no ts-node). `@/` import path pattern; no `any`/`as`/`@ts-ignore`.

**Primary Dependencies** (all shipped, reused — not rebuilt): `src/fetch/*` (the per-page pipeline `issue.ts` + `estimate.ts`), `src/cli/fetch-shared.ts` + `src/cli/fetch-source.ts` (CLI + fetch orchestration), `src/gallica/*` (IIIF image + `pagination` client), `src/model/*` (repository record, provenance, asset, rights), `src/archive/*` (`store`, `object-store`/`s3-object-store`, `checksum`, `object-key`), `@aws-sdk/client-s3` (B2).

**Storage**: git-tracked YAML SSOT (`bibliography/sources/*.yml`) + Backblaze B2 object store (image masters, keyed by checksum-bearing provenance). No new store; no schema change to provenance.

**Testing**: `vitest` (`npm test` → `vitest run`), colocated `*.test.ts` beside source + `tests/unit|integration/`. Injected fake runners for the Gallica client + object store (no real shell-out / network in tests).

**Target Platform**: local operator CLI (`bib fetch-source` via `tsx`).

**Project Type**: CLI tool + supporting library (single project).

**Performance Goals**: not latency-bound; correctness + politeness. Reuses the existing rate-limit-safe IIIF client; fetching fewer folios is strictly less work.

**Constraints**: fail-loud, no fallbacks/mock outside tests; no back-compat/transitional shims (clean, additive change — the `--pages`-absent path is byte-identical to today); files 300–500 lines max; composition + DI over inheritance; never fabricate a folio.

**Scale/Scope**: very small-n — one pure parser module, one loop-constraint + bounds-check in the fetch core, one optional model field with loader/serializer/validate round-trip, one CLI flag, dry-run scoping. First consumer acquires 3 folios.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Evidence Before Narrative** — PASS. Each acquired folio's provenance grounds it in the host document; folio SELECTION is grounded upstream by the pinpoint step (e.g. ContentSearch), not invented.
- **II. Preserve Disagreement & Uncertainty** — PASS. The declared `folios` records intended extent explicitly rather than leaving an excerpt looking like an incomplete whole-document fetch.
- **III. Provenance Is Mandatory** — PASS. Excerpt masters carry the SAME provenance as whole-document acquisitions — checksum, object key, retrieval metadata, rights (FR-013); provenance schema is unchanged (already per-asset).
- **IV. Respect Copyright (Fail Closed)** — PASS. Rights are assessed exactly as today (fail-closed); an excerpt of a public-domain document is public-domain; the feature does not touch rights handling.
- **V. Fail Loud, No Fallbacks** — PASS. Out-of-bounds folio, malformed/reversed range, and empty selection each fail loud and write nothing (FR-009/010); no fallback/mock outside tests.
- **VI. Composition Over Inheritance** — PASS. The folio-range parser is a pure function; the selected folios are passed into the fetch context by injection; no class inheritance.
- **VII. Type Safety Is Non-Negotiable** — PASS. Typed `folios: number[]`; no `any`/`as`/`@ts-ignore`; `@/` imports; new/edited files kept ≤500 lines (a focused parser module + small edits).
- **VIII. Faithful Tool Adoption** — PASS. Authored through the stack-control front door (define → execute); reuses the shipped fetch pipeline rather than reimplementing it.
- **IX. Durable Work — Commit & Push Early and Often** — PASS. Each task commits+pushes on coherence (enforced in execution, not a hook).
- **X. No Git Hooks, Ever** — PASS. No hooks added.
- **XI. Design Through the Design Skill** — PASS (not applicable). No UX/UI surface — a CLI flag on an existing verb, no visual/interaction design.

**Result**: no violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/012-page-range-acquisition/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── cli.md           # fetch-source --pages contract
│   └── model.md         # RepositoryRecord.folios + folio-range parser contract
├── checklists/
│   └── requirements.md  # from /speckit-specify
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
src/
├── fetch/
│   ├── folio-range.ts        # NEW: pure "48-50,55" -> deduped ascending number[] parser (fail-loud)
│   ├── folio-range.test.ts   # NEW: parser unit tests
│   ├── issue.ts              # EDIT: optional folios?: number[] on the fetch context; loop the set; bounds-check
│   └── issue.test.ts         # EDIT/ADD: subset-fetch + out-of-bounds + unchanged-default tests
├── cli/
│   ├── fetch-source.ts       # EDIT: accept --pages; thread to fetchMonograph
│   └── fetch-shared.ts       # EDIT: parse --pages -> folios; scope dry-run estimate; usage error on periodical path
├── model/
│   └── <repository-record>.ts # EDIT: optional folios?: number[] on RepositoryRecord (exact file resolved in data-model.md)
└── bibliography/
    └── <load|serialize|validate>.ts # EDIT: folios round-trip + validate (held==declared assertion optional)
```

**Structure Decision**: single project (CLI tool + library). The change is a thin, additive slice through the existing fetch pipeline plus one optional model field — no new top-level modules, no new store.

## Complexity Tracking

> No Constitution Check violations — this section intentionally empty.
