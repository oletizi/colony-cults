# Implementation Plan: Coverage (Gap Audit) Web View

**Branch**: `feature/coverage-web-view` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-coverage-web-view/spec.md`; approved design record `docs/superpowers/specs/2026-07-12-coverage-web-view-design.md`.

## Summary

A public `/coverage` research-status page in the corpus-browser Astro site that renders the
existing corpus-coverage-audit **coverage report** — per-campaign coverage, evidence-class
distribution, unresolved-references register, and repository × campaign search history. The
page is built statically by importing the pure `buildCoverageReport({ sources, searchLog })`
projection over the committed bibliography (no archive, no snapshot, no committed derived
artifact). A thin, testable helper `loadCoverageReport(repoRoot?)` wraps the exact CLI load
call; the Astro page composes four small section components; one masthead link makes it
discoverable. Every gap is a count or the literal `unknown` — never a percentage. All UI is
authored through `/frontend-design:frontend-design` (Constitution XI).

## Technical Context

**Language/Version**: TypeScript (build-time Node) + Astro components (host project's stack).

**Primary Dependencies**: the shipped corpus-coverage-audit projection
`buildCoverageReport` (`src/bibliography/coverage/coverage-model.ts`) and loaders
`loadAllSources` (`@/bibliography/load`) + `loadSearchLog` (`@/bibliography/search-log`); the
existing Astro site (`site/`), its `/sources/<id>` routes, and its masthead. **No new runtime
dependencies.**

**Storage**: read-only over committed research data — `bibliography/sources/*.yml` and
`bibliography/search-log.yml`. Nothing written; no derived artifact committed.

**Testing**: vitest unit test for `loadCoverageReport` (path resolution + well-formed report
from the committed bibliography; the projection itself is already covered by the coverage-audit
suite); site build as the integration check that `/coverage` renders.

**Target Platform**: statically built site (Netlify), rendered at build time in Node.

**Project Type**: web (existing static Astro site over a headless `src/` data layer).

**Performance Goals**: build-time only, trivial (~11 sources); no runtime/latency concern.

**Constraints**: fail-loud, no fallbacks/mock data outside tests; `@/` imports; files
≤300–500 lines; no `any`/`as`/`@ts-ignore`; no git hooks; **no coverage percentage/ratio/
progress indicator**; all UI via `/frontend-design`.

**Scale/Scope**: one case, ~11 sources, one live campaign (`PB-P004`); a single page with four
sections and one nav link.

## Constitution Check

*GATE: passed before Phase 0 and re-checked after Phase 1 design.*

| Principle | Verdict | Basis |
|-----------|---------|-------|
| III. Provenance Is Mandatory | PASS | The view surfaces provenance-bearing coverage facts (campaign ids, owners, sources searched); it invents none, and cross-links to the held record. |
| IV. Respect Copyright (Fail Closed) | PASS | Renders derived *counts* and citations over the already-public-domain corpus; mirrors no new content; publishes no copyrighted material. |
| V. Fail Loud, No Fallbacks | PASS | Malformed bibliography → `loadAllSources` throws → build fails naming the item; empty inputs render explicit empty states, never a fabricated or partial report. |
| VI. Composition Over Inheritance | PASS | A thin helper + four focused section components composed by one page; no inheritance. |
| VII. Type Safety Is Non-Negotiable | PASS | No `any`/`as`/`@ts-ignore`; `@/` imports; every file ≤300–500 lines. |
| VIII. Faithful Tool Adoption | PASS | Authored through the stack-control front door and Spec Kit's prescribed order; reuses the shipped projection unchanged. |
| IX. Durable Work | PASS | Committed and pushed per coherent unit. |
| X. No Git Hooks | PASS | None added; enforcement stays in skills/CLI/review/CI. |
| XI. Design Through the Design Skill | PASS | The page, section components, empty states, and nav link are authored through `/frontend-design`; no markup/CSS before it. |

No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/008-coverage-web-view/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── load-coverage-report.md
│   └── coverage-view.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/bibliography/coverage/
├── coverage-model.ts          # EXISTING — buildCoverageReport + CoverageReport (unchanged)
└── load-coverage-report.ts    # NEW — thin build helper: load + build the report

site/src/
├── pages/
│   └── coverage/
│       └── index.astro        # NEW — the /coverage page; composes the four sections
├── components/
│   ├── Masthead.astro         # EXISTING — add one coverage nav link
│   └── coverage/              # NEW — four focused section components
│       ├── CampaignCoverage.astro
│       ├── EvidenceDistribution.astro
│       ├── ReferenceRegister.astro
│       └── SearchHistory.astro

tests/unit/bibliography/
└── load-coverage-report.test.ts   # NEW — helper resolves paths + returns a report
```

**Structure Decision**: Extend the existing site in place. The build helper lives beside the
projection it wraps (`src/bibliography/coverage/`); the page and its four section components
live under `site/src/` alongside the current routes/components; the masthead gains one link.
No new top-level project or build target.

## Complexity Tracking

No constitution violations — nothing to justify.
