# Implementation Plan: Corpus Gap Closure

**Branch**: `feature/corpus-gap-closure` (long-lived; spec dir `specs/009-corpus-gap-closure` resolved via `.specify/feature.json`, not the branch name) | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-corpus-gap-closure/spec.md`; design record `docs/superpowers/specs/2026-07-13-corpus-gap-closure-design.md`.

## Summary

A governed, **non-coding research program** (with a small tooling tail) that closes the gap the `corpus-coverage-audit` measures. It runs an iterative, `bib coverage`-driven loop — search-and-log repositories → discover / inventory / verify / promote → acquire (any repository) → reconcile → re-measure → repeat — plus forward discovery (bibliographic mining + suspected/referenced resolution). It populates every audit dimension (search-log, known-extent, evidence-class, suspected/referenced) across the whole Port Breton case and all repositories. "Closed" is **measured, not zero**: a documented `irreducible` residual (never a bare `unknown`) is a valid terminal state for an open historical corpus. Approach: the loop is **research-first**, run interactively on the **shipped** `source-group-acquisition` pipeline and audit; tooling is **pulled into existence by the research, not designed ahead of it** — each genuinely-missing capability (a search-log authoring path, per-repository adapters, bibliographic mining, the three-state extent) is built as a small, typed, composed unit **only when a loop pass proves the concrete need**, authored + run as its own small spec through the front door at that point (define → execute). We do not pre-build a speculative adapter/mining/extent layer ahead of the research that would tell us what is actually required (FR-013 / R7).

## Technical Context

**Nature**: Primarily a **research program** run as an interactive, `bib coverage`-driven loop — **not** dispatched to an autonomous code executor (archival search + historical judgment are not autonomously executable; faking them would violate FR-008 / Principle I & V). The code tail is a **just-in-time tooling register**: per-repository adapters and search-log / discovery / extent helpers that extend shipped tooling, each built as its own small spec when a loop pass proves the concrete need — never pre-built.

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

**No code is written up front.** The program runs on the shipped `bibliography` + `sourcegroup` trees as they are today (`bib coverage | reconcile | inventory | verify-member | promote | acquire | discover | validate`). The units below are the **tooling register** (tasks.md Phase 4): each is built — as a small, typed unit extending the shipped tree, in its own small spec — *only when a research pass proves the concrete need*, never before.

```text
src/                          # extended in-place, on demand — none of this exists as new code until pulled:
├── bibliography/
│   ├── search-log.ts         # (shipped) read/validate — + an authoring/append path IF hand-authoring proves repetitive (T005)
│   └── coverage/             # (shipped) model/report — + render the three-state extent IF/when US6 records one (T029)
├── sourcegroup/
│   ├── discover.ts           # (shipped) — + a bibliographic-mining source IF manual mining proves repetitive (T018)
│   └── adapters/             # built only once a SECOND repository proves a shared seam is warranted (not at n=1):
│       ├── adapter.ts        #   the injected interface (T003)
│       ├── gallica.ts        #   only if shipped `bib acquire` proves insufficient (T004)
│       └── trove.ts          #   the first proven non-Gallica acquisition, PB-P005 (T015)
└── cli/
    └── bibliography.ts       # (shipped) bib sub-dispatch — new verbs added with the units above, as demanded
```

**Structure Decision**: the program is **research-first with just-in-time tooling** — the shipped `bibliography` + `sourcegroup` trees are used as-is; the genuinely-new units (search-log authoring, the `RepositoryAdapter` seam, per-repository adapters, bibliographic mining, the three-state extent + its coverage rendering) are the on-demand register, each built in its own small spec when a loop pass proves the need (R7: "built as sources demand, not pre-decomposed"; don't abstract a seam at n=1). Building them ahead of the research would design against a problem space we do not yet understand. The research *process* (the loop, the judgment) is not code and lives in the operator/agent workflow described in `quickstart.md`.

## Complexity Tracking

No constitution violations — not applicable.
