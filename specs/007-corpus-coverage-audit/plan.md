# Implementation Plan: Corpus Coverage & Discovery Audit

**Branch**: `feature/corpus-coverage-audit` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-corpus-coverage-audit/spec.md`

## Summary

Add a lightweight audit layer that answers "what evidence are we still missing?" as a
*projection* of the shipped bibliography. New facts are authored once, on the node that owns
their evidence — an `evidenceClass` facet and a `references[]` citation list on `Source`;
`suspected[]` gaps and a `knownMemberCount` on source-groups; and one new append-only
`bibliography/search-log.yml`. The unresolved-references *register* and the coverage *report*
are derived views printed by a new `bib coverage` subaction (`--json` variant), never
committed and fully regenerable from committed source. Validation extends the shipped
loader/validator; counting is per-work (a work held at multiple archives counts once). No
fetch/acquisition machinery; `PB-P004` is the validation case, with no code path special-cased
to it.

## Technical Context

**Language/Version**: TypeScript (ESM, `@/` path aliases), run via `tsx` (never `ts-node`).

**Primary Dependencies**: shipped in-repo modules — `@/model/source`,
`@/model/repository-record`, `@/bibliography/{load,load-fields,validate,validate-checks,vocab,derive,model}`, `@/cli/bibliography`; the `yaml` package for SSOT read/serialize. No new external dependency.

**Storage**: git-tracked YAML SSOT — new optional fields inside existing
`bibliography/sources/<sourceId>.yml`, plus one new append-only file
`bibliography/search-log.yml`. Derived views are printed to stdout only — never written to
disk.

**Testing**: `vitest` (`npm test`), `tsc --noEmit` for typecheck. TDD per project convention.

**Target Platform**: Node CLI (`gallica` bin → `src/index.ts`), macOS/Linux dev.

**Project Type**: Single-project CLI + library.

**Performance Goals**: not latency-bound; the corpus is ~11 sources. Report generation is an
in-memory projection over already-loaded bibliography state.

**Constraints**: fail-loud, no fallbacks or mock data outside tests; no `any`/`as`/`@ts-ignore`;
composition over inheritance; files ≤300–500 lines; `@/` imports only. Derived views MUST be
regenerable from committed source (no stored/committed derived artifact).

**Scale/Scope**: one case (`port-breton`, ~11 sources); `PB-P004` trial-records campaign is
the validation case. The report and fields are corpus-agnostic — reused across future
source-groups with no special-casing.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.* Evaluated against
the ratified `.specify/memory/constitution.md` (11 principles):

- **I. Evidence Before Narrative** — PASS: the feature's core purpose is keeping evidence,
  interpretation, and uncertainty visibly separate (a cited gap vs. an inferred one; `unknown`
  as a first-class value, never converted to a fabricated count).
- **II. Preserve Disagreement & Uncertainty** — PASS: `knownMemberCount: unknown` and the
  no-headline-% rule keep uncertainty explicit rather than forcing false resolution.
- **III. Provenance Is Mandatory** — PASS: `resolvedTo` is the found-it provenance edge;
  `basis` records why a suspicion exists; the search-log records who searched where and when.
- **IV. Respect Copyright (Fail Closed)** — N/A: no mirroring, fetching, or translation; the
  feature only reads and projects existing metadata.
- **V. Fail Loud, No Fallbacks** — PASS: every invalid authored input fails loud at validation
  (out-of-vocab `evidenceClass`/`citedKind`, dangling `resolvedTo`, group-only field on a
  non-group, duplicate search-log `id`); derived views are regenerated, never mocked or
  cached-with-fallback.
- **VI. Composition Over Inheritance** — PASS: the report is plain functions over the loaded
  model; validation checks are added to the existing check pipeline, not a class hierarchy.
- **VII. Type Safety Is Non-Negotiable** — PASS: new fields are typed additions to `Source`,
  `RepositoryRecord`-owning YAML, and a new `SearchLogEntry` type; no `any`/`as`/`@ts-ignore`;
  new modules kept ≤300–500 lines (report split into projection + render).
- **VIII. Faithful Tool Adoption** — PASS: authored through the stack-control `define` front
  door driving native Spec Kit in prescribed order.
- **IX. Durable Work — Commit & Push Early and Often** — PASS: each artifact committed and
  pushed as it becomes coherent (already underway).
- **X. No Git Hooks, Ever** — PASS: no hooks added; enforcement stays in validation/CLI/tests.
- **XI. Design Through the Design Skill** — N/A: `bib coverage` emits plain-text/`--json`
  terminal output, not visual UI (no layout/typography/components). Were a rich visual
  rendering ever added, Principle XI would apply then.

**Post-Phase-1 re-check**: see end of this file. No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/007-corpus-coverage-audit/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI + field contracts)
│   ├── bib-coverage.md
│   └── authored-fields.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── model/
│   └── source.ts                 # + evidenceClass, references[] (Reference type)
├── bibliography/
│   ├── vocab.ts                  # + EVIDENCE_CLASS_VALUES, CITED_KIND_VALUES
│   ├── load-fields.ts            # parse new Source fields + group fields
│   ├── load.ts                   # wire new fields through the loader
│   ├── validate-checks.ts        # + evidenceClass/citedKind vocab, resolvedTo referential,
│   │                             #   group-only-field, dangling-ref checks
│   ├── search-log.ts             # NEW: SearchLogEntry type + loader + uniqueness validation
│   └── coverage/                 # NEW: derived projection (kept modular, ≤300–500 lines each)
│       ├── coverage-model.ts     #   pure projection: counts, register, matrices (no I/O)
│       └── coverage-render.ts    #   text + --json rendering of the projection
├── model/
│   └── search-log.ts             # NEW: SearchLogEntry interface (or co-located in bibliography/search-log.ts)
└── cli/
    └── bibliography.ts           # + 'coverage' subaction dispatch

bibliography/
└── search-log.yml                # NEW authored append-only file (committed)

tests/
├── unit/                         # vocab, validation checks, projection math, per-work counting
└── integration/                  # bib coverage end-to-end over a fixture + PB-P004
```

**Structure Decision**: Single-project CLI + library, matching the shipped layout. New authored
fields extend existing model/loader/validator modules in place; the derived report is a new
`src/bibliography/coverage/` pair (pure projection + rendering) to honor the ≤500-line and
composition rules; the search-log gets its own small loader/validator module. The `coverage`
subaction is added to the existing `bib` CLI dispatch alongside `show`/`validate`/`inventory`.

## Complexity Tracking

> No Constitution Check violations. No entries required.
