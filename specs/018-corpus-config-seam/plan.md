# Implementation Plan: Corpus Config Seam

**Branch**: `main` (long-lived; dir resolved via `.specify/feature.json`) | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/018-corpus-config-seam/spec.md`; design `docs/superpowers/specs/2026-07-27-corpus-config-seam-design.md` (review-revised).

## Summary

A **composition-time configuration seam** that lets one shared core run varied research corpora. Corpus identity/policy becomes a validated **data manifest** (`corpora/<id>.yml`); it is selected explicitly (`--corpus` → `COLONY_CORPUS` → fail loud), resolved once at the application composition root, and injected downward as **narrow per-seam policies** (validCaseIds set; `SourceIdPolicy`; archive-layout policy; a separate `BrowserProfile`). The four localized single-corpus constants are removed from core modules and read from those policies. Port Breton is authored as corpus-instance #1, a **behavior-preserving** extraction (byte-identical paths, unchanged IDs/coverage, no data migration), and the seam is **proven by a synthetic second corpus** added as manifest+fixture only. Domain generalization (pluggable discovery + date normalizer) is explicitly deferred to epic spec 2.

## Technical Context

**Language/Version**: TypeScript via `tsx` (per constitution); no `ts-node`.

**Primary work**: a small, disciplined refactor + new config layer — no rewrite. Touches four hotspots (`archive/location.ts`, `bibliography/scope.ts`, `sourcegroup/id-alloc.ts`, `browser/config.ts`) + a new `corpus/` module (manifest type, typed loader, validator, composition-root selection) + narrow policy interfaces.

**Storage**: `corpora/<id>.yml` manifests (git-tracked data); existing bibliography SSOT + `cases/<case>/…` archive layout unchanged.

**Testing**: `vitest` — **characterization tests** capturing current `location.ts` outputs for the 9 legacy sources (byte-identical gate), validator unit tests, a selection-precedence test, and a **synthetic-second-corpus integration test** that proves core modules are untouched. `@/` imports, no `any`, files ≤ 300–500.

**Target Platform / Project Type**: local CLI (`tsx`) + the static browser build; single repository, `cases/<case>/` grain (no restructure).

**Performance / Scale**: negligible — config loads once at startup; validation is O(manifests).

**Constraints**: behavior-preserving for Port Breton (data unchanged); fail loud, no implicit default (V); composition/DI, narrow interfaces, no service locator (VI); type-safe (VII); faithful reuse of the shipped registries (VIII); no spec-2 fields.

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1. No violations — no Complexity Tracking.*

- **I. Evidence Before Narrative** — N/A (infrastructure refactor; no research claims).
- **II. Preserve Disagreement & Uncertainty** — N/A.
- **III. Provenance Is Mandatory** — PASS (no change to provenance; paths byte-identical).
- **IV. Respect Copyright** — N/A (rights logic untouched; already generic).
- **V. Fail Loud, No Fallbacks** — PASS. No selected/unknown/invalid corpus → loud failure at the load boundary; no implicit Port-Breton fallback.
- **VI. Composition Over Inheritance** — PASS. Narrow per-seam policy interfaces derived at the composition root and injected; the corpus is **not** a service locator; registries stay orthogonal.
- **VII. Type Safety** — PASS. `@/`, no `any`/`as`/`@ts-ignore`, files ≤ 300–500; typed manifest loader with a discriminated `schemaVersion`.
- **VIII. Faithful Tool Adoption** — PASS. Reuses the shipped repository/source-query registries + coverage/validate through their interfaces; never `bib migrate`; spec authored through the stack-control front door.
- **IX. Durable Work** — PASS. Committed + pushed per coherent unit.
- **X. No Git Hooks** — PASS.
- **XI. Design Through the Design Skill** — N/A. No UX/UI (the `BrowserProfile` is config, not a UI change); if the browser's *rendering* ever changes it routes through `/frontend-design`.

## Project Structure

### Documentation (this feature)

```text
specs/018-corpus-config-seam/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/   # manifest schema, selection, narrow policies, validator
└── tasks.md     # /speckit-tasks
```

### Source Code (repository root)

```text
corpora/
├── port-breton.yml          # NEW — instance #1 (authored from current constants)
└── _fixtures/synthetic.yml  # NEW — test-only synthetic second corpus (proof of seam)

src/
├── corpus/                  # NEW — the seam
│   ├── manifest.ts          #   CorpusManifest type + typed loader (schemaVersion)
│   ├── validate.ts          #   config validator + repo-wide collision rules
│   ├── select.ts            #   --corpus → COLONY_CORPUS → fail loud (composition root)
│   └── policies.ts          #   derive narrow policies (validCaseIds, SourceIdPolicy, layout, browser)
├── archive/location.ts      # EDIT — retire SOURCE_LAYOUTS map → generic + validated overrides
├── bibliography/scope.ts    # EDIT — PORT_BRETON_CASE_ID → injected validCaseIds
├── sourcegroup/id-alloc.ts  # EDIT — module constants → injected SourceIdPolicy
├── browser/config.ts        # EDIT — default list → injected BrowserProfile
└── cli/                     # EDIT — thread --corpus + `bib validate-config`; wire composition root
```

**Structure Decision**: a new `corpus/` module owns the manifest/loader/validator/selection and derives narrow policies; the four hotspots are edited to consume injected policies (not the manifest). The composition root (CLI + browser build entrypoints) selects the corpus once and injects. No module receives an omnibus corpus object.

## Complexity Tracking

No constitution violations — not applicable.
