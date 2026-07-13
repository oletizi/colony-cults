# Implementation Plan: Corpus Model Coherence

**Branch**: `feature/corpus-gap-closure` (long-lived; spec dir `specs/010-corpus-model-coherence` resolved via `.specify/feature.json`, not the branch name) | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-corpus-model-coherence/spec.md`; approved design record `docs/superpowers/specs/2026-07-13-corpus-model-coherence-design.md`.

## Summary

Decouple the three jobs overloaded onto **source-group** (search scope, work container, acquisition gate) into a coherent first-class **Scope** model. A `ScopeRef { kind, id }` (`case | thread | work-bundle | work`) is resolved and validated fail-loud across existing stores — a source-group *is* the `work-bundle` kind (reinterpretation, no migration). The search-log cuts over from `campaign:` to `scope:` as a **clean break** (rewrite the one existing entry; the loader rejects `campaign:` fail-loud). Coverage counts **works only** and reports **per scope**; approval applies only to **fetchable works** (containers stay un-acquirable). A thin thread registry (`bibliography/scopes.yml`) + a one-directional `threads:` field on Source are defined-but-not-populated. Approach: **extend** the shipped `bibliography` tree behind small, typed, composed units; every change is fail-loud with no transitional/back-compat surface.

## Technical Context

**Language/Version**: TypeScript executed with `tsx` (per Constitution); no `ts-node`.

**Primary Dependencies (shipped, extended not replaced)**: `src/bibliography/model.ts` (Source / RepositoryRecord / SearchLog types), `vocab.ts` (kinds + vocab), `search-log.ts` + `validate-search-log.ts` (search history), `load-coverage-fields.ts` (source coverage-facet parsing), `coverage/*` (coverage model/history/render), `validate*.ts` (validators), and the source-group acquisition verbs (`promote` / `acquire`).

**Storage**: git-tracked bibliography SSOT — `bibliography/sources/*.yml`, `bibliography/search-log.yml`, and a **NEW** `bibliography/scopes.yml` (thread registry). No new external store.

**Testing**: `vitest`, **test-first (RED→GREEN)**; research validation via `bib validate` + `bib coverage` (deterministic, writes-nothing).

**Target Platform / Project Type**: local CLI (`tsx`) + library; single project.

**Performance / Scale**: 13 sources, 1 case (`port-breton`), 0 threads populated by this build; no throughput targets.

**Constraints**: **CLEAN BREAKS ONLY** (operator directive, FR-013) — no transitional dual-representation, back-compat shim, or tolerated legacy key; every cutover fails loud on the retired shape. Fail-loud + no fallbacks (Principle V). Never `bib migrate` (Principle VIII). `@/` imports, no `any`/`as`/`@ts-ignore`, files ≤ 300–500 lines (Principle VII).

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1. No violations — no Complexity Tracking needed.*

- **I. Evidence Before Narrative** — PASS. The feature makes the audit's counts *more* accurate (works vs containers; resolvable scopes); it asserts nothing.
- **II. Preserve Disagreement & Uncertainty** — PASS. No smoothing; a ScopeRef either resolves or fails loud.
- **III. Provenance Is Mandatory** — PASS. Search-log scope records the provenance of each search; asset provenance is unchanged.
- **IV. Respect Copyright (Fail Closed)** — PASS. Approval gating is tightened, not loosened: containers remain un-acquirable; per-item rights determination is unchanged.
- **V. Fail Loud, No Fallbacks** — PASS (central). Every ScopeRef/thread/`campaign:` mismatch fails loud; the clean-breaks constraint IS fail-loud-on-retired-shape; no aliases, no fallbacks.
- **VI. Composition Over Inheritance** — PASS. The ScopeRef resolver, `isFetchableWork` predicate, and scopes-registry loader are small composed units behind interfaces; no inheritance.
- **VII. Type Safety** — PASS. `ScopeRef` is a discriminated union; `@/` imports, no `any`/`as`/`@ts-ignore`, files ≤ 300–500.
- **VIII. Faithful Tool Adoption** — PASS. Extends shipped `bib` verbs through their code; NEVER `bib migrate`; this feature itself was authored through the stack-control front door (design → define → execute).
- **IX. Durable Work** — PASS. Each unit committed + pushed on completion.
- **X. No Git Hooks** — PASS. Enforcement in code + `bib validate` + review, never hooks.
- **XI. Design Through the Design Skill** — N/A. No UX/UI (CLI/`bib coverage` output only); and the feature itself went through `/stack-control:design` → `superpowers:brainstorming`.

## Project Structure

### Documentation (this feature)

```text
specs/010-corpus-model-coherence/
├── plan.md              # This file
├── research.md          # Phase 0 — resolved unknowns (scopes.yml shape, threads validation, per-scope render, yaml scope shape)
├── data-model.md        # Phase 1 — ScopeRef, Thread registry, Source.threads, SearchLogEntry.scope, invariants
├── quickstart.md        # Phase 1 — validate the cutover + the four decouplings end-to-end
├── contracts/           # Phase 1 — scope-model contract (ScopeRef resolution, isFetchableWork, scope search-log schema, approve/coverage rules)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root) — extended in place

```text
src/bibliography/
├── scope.ts             # NEW — ScopeRef discriminated union + resolveScopeRef() (fail-loud kind/referent validation); isFetchableWork()
├── scopes-registry.ts   # NEW — load/validate bibliography/scopes.yml (thread id+name+description; empty is valid)
├── vocab.ts             # extend — SCOPE_KIND_VALUES; keep EVIDENCE_CLASS_VALUES
├── model.ts             # extend — Source gains threads?: string[]; SearchLogEntry.campaign → scope: ScopeRef
├── search-log.ts        # cut over — parse only scope:; a campaign: key throws (fail loud)
├── validate-search-log.ts # extend — validate each entry's scope resolves under its kind
├── load-coverage-fields.ts # extend — parse+validate Source.threads[] (each id in scopes.yml)
├── validate-checks.ts / validate-coverage-checks.ts # extend — threads resolution; work-vs-container invariants
└── coverage/
    ├── coverage-model.ts   # change — evidence-class distribution counts works only (kind != source-group)
    ├── coverage-history.ts # change — search history keyed per ScopeRef
    └── coverage-render.ts  # change — per-scope rendering (case/thread/work-bundle/work)

src/…/(source-group acquisition verbs)
└── promote / acquire path # change — approve/acquire gate on isFetchableWork(source); a source-group is rejected loud

bibliography/
├── scopes.yml           # NEW — thread registry (empty/valid this build)
└── search-log.yml       # cut over — SRCH-0001 rewritten to scope: shape (hand-edit, one entry)
```

**Structure Decision**: extend the shipped `bibliography` tree; the genuinely-new units are `scope.ts` (the `ScopeRef` type + fail-loud resolver + `isFetchableWork`) and `scopes-registry.ts` (the thread registry loader). Everything else is a surgical change to existing files: the search-log cutover, the coverage work-vs-container counting + per-scope reporting, the approval gate, and threads-field validation. No file is replaced; no transitional path is introduced.

## Complexity Tracking

No constitution violations — not applicable.
