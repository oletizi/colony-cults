# Implementation Plan: Corpus Gap Closure

**Branch**: `feature/corpus-gap-closure` (long-lived; spec dir `specs/009-corpus-gap-closure` resolved via `.specify/feature.json`, not the branch name) | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-corpus-gap-closure/spec.md`; design record `docs/superpowers/specs/2026-07-13-corpus-gap-closure-design.md`.

## Summary

A governed, **non-coding research program** (with a small tooling tail) that closes the gap the `corpus-coverage-audit` measures. It runs an iterative, `bib coverage`-driven loop — search-and-log repositories → discover / inventory / verify / promote → acquire (any repository) → reconcile → re-measure → repeat — plus forward discovery (bibliographic mining + suspected/referenced resolution). It populates every audit dimension (search-log, known-extent, evidence-class, suspected/referenced) across the whole Port Breton case and all repositories, building per-repository acquisition/discovery adapters as sources demand. "Closed" is **measured, not zero**: a documented `irreducible` residual (never a bare `unknown`) is a valid terminal state for an open historical corpus. Approach: **reuse** the shipped `source-group-acquisition` pipeline and audit; add only the genuinely-missing capability (per-repository adapters, a search-and-log workflow, bibliographic mining), each behind a small, typed, composed unit.

## Technical Context

**Nature**: Primarily a **research program** executed as repeatable loops; the code tail is limited to per-repository adapters and search-and-log/discovery helpers that extend shipped tooling.

**Language/Version**: TypeScript executed with `tsx` (per constitution); no `ts-node`.

**Primary Dependencies (reused, shipped)**: `corpus-coverage-audit` (`bib coverage`, `search-log.yml`, evidence-class, `bib reconcile`), `source-group-acquisition` (`bib inventory | verify-member | promote | acquire | discover`), `gallica-fetcher` (IIIF/OAI acquisition), `canonical-source-metadata` (Source/RepositoryRecord SSOT), `archive-object-store` (B2).

**Storage**: git-tracked bibliography SSOT (`bibliography/sources/*.yml`, `bibliography/search-log.yml`); per-session archive clones for provenance; B2 object store for masters (the only shared asset store).

**Testing**: `vitest` for any new adapter/helper code (`@/` imports, no `any`, files ≤ 300–500 lines); research validation via `bib validate` + `bib coverage` (deterministic, writes-nothing).

**Target Platform / Project Type**: local CLI (`tsx`) + a human/agent-driven research process; single project.

**Performance / Scale**: one 19th-century case (Port Breton), ~13 known sources + open-ended discovery; polite, rate-limited repository access (reuse the fetcher's honoring of `Retry-After`); no throughput targets — cadence is research-paced, not machine-paced.

**Constraints**: fail-loud + no fabricated candidates (Principle V); per-item public-domain rights gate, copyright uncertainty blocks mirroring (Principle IV); reuse shipped pipeline, never `bib migrate` (Principle VIII); per-session archive clones only, never a shared working tree; single-work counting in coverage.

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1. No violations — no Complexity Tracking needed.*

- **I. Evidence Before Narrative** — PASS. The program's core is turning `unknown` into logged evidence; progress is the audit's measured output, never an asserted narrative.
- **II. Preserve Disagreement & Uncertainty** — PASS. Uncertainty is named, not smoothed: an unmeasured extent is an explicit `unexamined` (open) or `irreducible` (valid terminal) state — never a bare `unknown`; conflicts are recorded (search-log remaining-questions, documented residual).
- **III. Provenance Is Mandatory** — PASS. Every lead records its provenance (which search / which acquired source's bibliography); acquisitions carry full asset provenance via the shipped pipeline.
- **IV. Respect Copyright (Fail Closed)** — PASS. Per-item public-domain determination gates every acquisition; non-PD / uncertain sources are cataloged but NOT mirrored.
- **V. Fail Loud, No Fallbacks** — PASS. Discovery fails loud on ambiguous/unverifiable leads and never fabricates identifiers; a missing repository adapter is surfaced, not faked.
- **VI. Composition Over Inheritance** — PASS. New per-repository adapters are small units behind an injected `RepositoryAdapter` interface; external services shelled behind injected runners.
- **VII. Type Safety** — PASS. `@/` imports, no `any`/`as`/`@ts-ignore`, files ≤ 300–500 lines for any new code.
- **VIII. Faithful Tool Adoption** — PASS. Reuses the shipped pipeline through its sanctioned verbs; drives spec work through the stack-control front door; never `bib migrate` (stale legacy inputs) and never off-roads a raw `/speckit-*`.
- **IX. Durable Work** — PASS. Each loop iteration commits + pushes bibliography/search-log changes; session state lives in committed files (survives context loss).
- **X. No Git Hooks** — PASS. Enforcement is in the audit/CLI + review, never hooks.
- **XI. Design Through the Design Skill** — N/A. No UX/UI: the coverage surface is the shipped `bib coverage` CLI (and the separate `coverage-web-view` feature). This program adds no user-facing UI; if any is ever proposed, it must route through `/frontend-design` first.

## Project Structure

### Documentation (this feature)

```text
specs/009-corpus-gap-closure/
├── plan.md              # This file
├── research.md          # Phase 0 — methodology decisions (dry-round threshold, evidence-class vocab, adapter approach, search-log schema)
├── data-model.md        # Phase 1 — search-log record, campaign extent, candidate, evidence-class, lead (extending the shipped SSOT)
├── quickstart.md        # Phase 1 — how to run one gap-closure loop end-to-end
├── contracts/           # Phase 1 — RepositoryAdapter interface, search-log record schema, discovery-candidate shape
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

New/extended code is small and lives alongside the shipped bibliography + source-group tooling:

```text
src/
├── bibliography/            # SSOT + audit (shipped) — extended, not replaced
│   ├── search-log.ts        # (shipped) search-log read/validate — extended with an authoring/append path
│   └── coverage/            # (shipped) coverage model/report — extended: render the three-state extent (unexamined/irreducible), never a bare `unknown` (R9/T029)
├── sourcegroup/             # discover/inventory/verify/promote/acquire/reconcile (shipped) — reused
│   ├── discover.ts          # (shipped) — extended: bibliographic-mining candidate source
│   └── adapters/            # NEW — per-repository RepositoryAdapter implementations
│       ├── adapter.ts       #   the injected interface (search + resolve + acquire + rights)
│       ├── gallica.ts       #   wraps the shipped Gallica fetcher (present capability)
│       └── trove.ts         #   NEW — first non-Gallica adapter (PB-P005), then IA/HathiTrust/… as demanded
└── cli/
    └── bibliography.ts      # (shipped) bib sub-dispatch — add search-log authoring + mining verbs as needed
```

**Structure Decision**: extend the shipped `bibliography` + `sourcegroup` trees; the only genuinely new code is `sourcegroup/adapters/` (the multi-repository seam) plus a search-log authoring path, a bibliographic-mining discovery source, and the three-state campaign-extent field with its distinct coverage rendering (R9/T029). The research *process* (the loop, the judgment) is not code and lives in the operator/agent workflow described in `quickstart.md`.

## Complexity Tracking

No constitution violations — not applicable.
