# Implementation Plan: Canonical Source Metadata Model

**Branch**: `feature/canonical-source-metadata` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-canonical-source-metadata/spec.md`

## Summary

Introduce a single canonical metadata model for acquired sources, replacing the flat, single-archive `SourceMeta` registry (`src/archive/source-registry.ts`) and the Gallica-specific `Source` interface (`src/model/source.ts`) that today lose provenance when a work is re-acquired from a second archive. The model is the hierarchy **Source → Repository Record → [Issue] → Asset**, with work-level identifiers on Source, copy-level identifiers on Repository Record, the acquisition axis kept distinct from the storage axis (reusing the archive-object-store `object_store` provenance block), and a per-copy asset manifest instead of a single checksum.

**Technical approach**: A hand-authored **Source SSOT** as public `bibliography/sources/PB-###.yml`; Repository Records and asset roll-ups **derived** from the per-asset provenance the fetcher already writes (hybrid direction, FR-013a). New `src/model/` types (Source generalized; new RepositoryRecord; Issue/Asset reused) plus a `src/bibliography/` module that (a) loads + validates the SSOT, (b) derives the repository/asset roll-up from archive provenance, (c) regenerates the four legacy views deterministically, and (d) runs referential-integrity + identifier-leak validation. A migration restores PB-P001's lost SLQ Repository Record. Deterministic YAML is hand-serialized in fixed field order (the established `provenance.ts` pattern) so committed views are byte-reproducible (FR-015). Exposed as CLI verbs under the existing `gallica`/`src/cli` surface.

## Technical Context

**Language/Version**: TypeScript 5.3 on Node 20, ESM (`"type": "module"`), run via `tsx`.

**Primary Dependencies**: existing — `@aws-sdk/client-s3` (object store), `fast-xml-parser` (OAI/IIIF). **Proposed addition** — `yaml` (parse human-authored Source records; see research.md R-002). No class inheritance; interface-first + DI per repo CLAUDE.md.

**Storage**: files. SSOT = public `bibliography/sources/PB-###.yml`. Derived views = `bibliography/sources.csv`, `bibliography/acquisition-tracker.csv`, the archive's `acquisition-register.csv`, per-source `PB-P00X.yml` stubs. Per-asset provenance stays where the fetcher writes it (`<asset>.provenance.json` / archive companion YAML), including the private `../colony-cults-archive`.

**Testing**: `vitest` (`vitest run`); unit under `tests/unit/`, integration under `tests/integration/`; fixtures under `tests/fixtures/`.

**Target Platform**: local developer CLI (macOS/Linux).

**Project Type**: single-project TypeScript CLI (Option 1).

**Performance Goals**: not latency-bound; corpus is on the order of tens of sources, ~78 issues for the first serial. Determinism (byte-identical regeneration) matters more than throughput.

**Constraints**: `@/` import pattern; no fallbacks/mock data outside tests (throw on missing data — matches existing `sourceMeta` fail-loud); files 300–500 lines max; no `any`/`as`/`@ts-ignore`; no git hooks. Deterministic serialization (fixed field order) for every generated artifact.

**Scale/Scope**: sources only (FR-020). ~6 sources today; designed to scale across Gallica, SLQ, Internet Archive, HathiTrust, Trove.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an **unratified template** (placeholder principles). In its absence the governing rules are the repo + user CLAUDE.md guidelines, checked here:

| Principle (CLAUDE.md) | Compliance |
|-----------------------|-----------|
| No fallbacks / mock data outside tests; throw on missing | PASS — validators + loaders fail loud (extends existing `sourceMeta` throw-on-unregistered). |
| `@/` import pattern | PASS — all new modules use `@/…`. |
| Avoid class inheritance; interface-first + DI | PASS — plain interfaces + pure functions + injected provenance reader. |
| No `any` / `as` / `@ts-ignore` | PASS — typed throughout; parsed YAML narrowed via explicit validators. |
| Files 300–500 lines | PASS — split into `model/`, `bibliography/{load,derive,regenerate,validate,migrate}`. |
| No new representation beyond SSOT (FR-014) | PASS — legacy files become generated views; no sixth store. |
| Determinism | PASS — fixed-order hand-serialization (reuses `provenance.ts` approach). |

**Gate result: PASS** (no unjustified violations). Adding the `yaml` dependency is the one new external surface; justified in research.md R-002 (human-authored YAML needs a real reader; hand-rolling one would be a worse dependency).

**Post-Phase-1 re-check: PASS** — the data model and contracts introduce no class hierarchies, no `any`, and no new persisted representation; every generated artifact has a fixed serialization order.

## Project Structure

### Documentation (this feature)

```text
specs/004-canonical-source-metadata/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── source-record.md         # SSOT YAML file format
│   ├── cli.md                   # bibliography CLI verbs
│   └── validation.md            # integrity + leak checks
├── checklists/
│   └── requirements.md  # from /speckit-specify + /speckit-clarify
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
src/
├── model/
│   ├── source.ts              # GENERALIZE: archive-independent work; titles-as-data; work-level IDs; kind
│   ├── repository-record.ts   # NEW: one archive's copy; copy-level IDs; acquisition + storage axes; manifest ref
│   ├── issue.ts               # reuse (serial fascicle; already exists)
│   ├── asset.ts               # reuse (per-file; already exists)
│   ├── identifiers.ts         # NEW: work-level vs copy-level identifier types + level classification
│   └── index.ts               # re-export new types
├── bibliography/
│   ├── load.ts                # NEW: read + validate bibliography/sources/PB-###.yml (SSOT)
│   ├── derive.ts              # NEW: roll up Repository Records + assets from per-asset provenance
│   ├── regenerate.ts          # NEW: deterministic generation of the 4 legacy views
│   ├── validate.ts            # NEW: referential integrity + identifier-leak + vocab checks
│   ├── vocab.ts               # NEW: closed allowed-value sets (status/rights/provider/ocr_status)
│   └── migrate.ts             # NEW: fold 5 representations → SSOT; restore PB-P001 SLQ record
├── cli/
│   └── bibliography.ts        # NEW: `bib <validate|regenerate|migrate|show>` verbs
└── archive/
    └── source-registry.ts     # RETIRE/REPLACE: SourceMeta singular sourceArchive is the bug

tests/
├── unit/
│   ├── bibliography/{load,derive,regenerate,validate,migrate}.test.ts
│   └── model/{identifiers,repository-record}.test.ts
└── integration/
    └── bibliography.test.ts    # end-to-end: PB-P001 two-copy restore + regenerate + validate
```

**Structure Decision**: Single-project layout (Option 1). New `src/bibliography/` module houses the canonical-model logic; `src/model/` gains the generalized/added types; the CLI verb lives beside the existing verbs. `src/archive/source-registry.ts` is retired once `bibliography/load.ts` + the SSOT supersede it.

## Complexity Tracking

No constitution violations require justification. The single added dependency (`yaml`) is tracked in research.md R-002. The migration (`migrate.ts`) is one-time but shipped as a repeatable, idempotent command so the PB-P001 restoration is verifiable and re-runnable.

## Phase 0 → Phase 1 status

- Phase 0 research: see [research.md](./research.md) — resolves the two `/speckit-plan`-deferred questions (census reference mechanism; per-view regeneration wiring) plus the `yaml`-dependency and validation-approach decisions.
- Phase 1 design: see [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).
- Agent context marker (`CLAUDE.md` SPECKIT block) points at this plan.
