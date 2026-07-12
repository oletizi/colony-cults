# Implementation Plan: Corpus Print PDF

**Branch**: `feature/corpus-print-pdf` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-corpus-print-pdf/spec.md`

**Design record**: `docs/superpowers/specs/2026-07-11-corpus-print-pdf-design.md`

## Summary

Generate print-native PDF facsimile editions — one per bibliographic item — from the existing
corpus-browser normalized snapshot. Each edition is a facing-page spread (verso = facsimile scan,
recto = the facing page's French OCR │ English translation), wrapped in a provenance title page and
colophon. The generator **consumes the pinned snapshot** (never re-derives the corpus), reads
source catalog metadata from the committed bibliography SSOT, fetches print-resolution image bytes
from B2 at build time (IIIF full-size as alternate), and drives **Typst** (an external CLI) to
compose the PDF. Delivered as a `pdf:build` npm verb sibling to `site:snapshot`, plus a new
`src/pdf/` data layer mirroring `src/browser/`. Internal-first; publishes nothing.

## Technical Context

**Language/Version**: TypeScript (ESM), executed with `tsx` on Node 20 (Constitution: `tsx`, never
`ts-node`).

**Primary Dependencies**: reuses `@/browser/load/snapshot` (snapshot read), `@/archive`
(`S3ObjectStore`, `resolveObjectStoreConfig` — B2 byte fetch), `@/bibliography` + `@/model` (source
metadata), `@aws-sdk/client-s3`, `yaml`. **External build dependency: the Typst CLI** (`typst
compile`) — documented, not an npm package; the build fails loud if the binary is absent.

**Storage**: reads the pinned snapshot `site/data/<sourceId>.json.gz` + the pin `site/data/archive-source.json`;
reads committed `bibliography/sources/<sourceId>.yml`; fetches image bytes from B2; writes PDFs to a
build output directory (`build/pdf/<sourceId>/<itemId>.pdf`) and caches fetched images under a
build temp dir. No database.

**Testing**: `vitest`. New split `pdf:test` → `tests/unit/pdf tests/integration/pdf`. Unit tests use
an in-memory `ObjectStore` fake and a fake `TypstRunner` (no network, no Typst binary). One
integration fixture exercises a real PB-P001 issue end-to-end to a Typst *input document* (JSON),
asserting the edition-builder guarantees.

**Target Platform**: local CLI — Node 20 + the Typst binary installed; network access to B2 for
image bytes.

**Project Type**: single project (root `src/` package) — a headless TS data + render layer plus a
CLI script, matching the corpus-browser structure decision.

**Performance Goals**: not latency-critical; correctness and **reproducibility** over speed. A batch
build spans 78 issues + 4 monographs; each build incurs one B2 Class-B read per embedded image
(noted; mitigation is TASK-12, out of scope). No hard throughput target.

**Constraints**: fail-loud, no fallbacks/mock data outside tests (Constitution V); deterministic,
reproducible PDFs from a fixed pin (SC-004); `@/` imports, no `any`/`as`/`@ts-ignore`
(Constitution VII); every source file ≤ 300–500 lines; the Typst template's typography/layout MUST
be designed via `/frontend-design` before any template markup (Constitution XI / FR-013).

**Scale/Scope**: v1 corpus = PB-P001 *La Nouvelle France* (78 issues) + Port Breton monographs
PB-P008–PB-P011; the data layer is source-agnostic so any snapshot source builds without
item-specific code (FR-015).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against the ratified constitution (`.specify/memory/constitution.md`, v1.0.0):

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Evidence Before Narrative | PASS | Facsimile scan is the authoritative element (FR-003); OCR/translation labeled machine-derived; propaganda framed as evidence, never truth (FR-005). |
| II. Preserve Disagreement & Uncertainty | PASS | Noisy OCR is shown *beside* the authoritative scan, not silently corrected; nothing forced to a false resolution. |
| III. Provenance Is Mandatory | PASS | Colophon carries pinned archive commit + per-image object-store key + sha256 + machine-assist label (FR-005, FR-016); sha256 verified on every fetch. |
| IV. Respect Copyright (Fail Closed) | PASS | Internal-first, publishes nothing (FR-012); public distribution deferred; reads private archive/B2 only locally; the v1 corpus is public-domain. |
| V. Fail Loud, No Fallbacks | PASS | Missing per-page EN, missing scan, unretrievable image, sha256 mismatch → descriptive error (FR-009, FR-011); no placeholder/mock outside tests. |
| VI. Composition Over Inheritance | PASS | Typst and B2 fetch behind injected interfaces (`TypstRunner`, `ObjectStore`); no class inheritance; reuses `@/archive`, `@/browser`. |
| VII. Type Safety | PASS | `@/` imports; no `any`/`as`/`@ts-ignore`; module split keeps every file ≤ 300–500 lines. |
| VIII. Faithful Tool Adoption | PASS | Typst driven as an external CLI, not reimplemented; the feature is authored through the stack-control front door; the snapshot is reused, not re-derived. |
| IX. Durable Work — Commit & Push | PASS | Each coherent unit committed and pushed (this plan, each phase). |
| X. No Git Hooks, Ever | PASS | No hooks added or depended on. |
| XI. Design Through the Design Skill | PASS (gated) | The Typst template's typography/layout is produced via `/frontend-design` **before** any template markup (FR-013); sequenced as a hard prerequisite in tasks. |

No violations → Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/007-corpus-print-pdf/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── cli.md               # pdf:build command + flag contract
│   ├── edition-builder.md   # snapshot+SSOT → Edition model contract
│   ├── image-fetch.md       # print-resolution byte fetch + sha256 verify contract
│   └── typst-template.md    # Edition JSON → Typst input contract
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/pdf/                         # NEW — headless PDF data + render layer (mirrors src/browser/)
├── model.ts                     #   pure types: Edition, EditionPage, TitlePageMeta, ColophonMeta, ImageAsset
├── config.ts                    #   env-only config (output dir, image provider, archive pin resolution)
├── load/
│   ├── edition.ts               #   snapshot + SSOT → Edition (orchestrator; fail-loud on gaps)
│   ├── source-meta.ts           #   title-page metadata from bibliography SSOT (reuse @/bibliography)
│   └── colophon.ts              #   colophon assembly (pin, per-image key+sha256, machine-assist label)
├── images/
│   ├── fetch.ts                 #   print-res byte fetch behind ImageByteSource interface
│   ├── b2-source.ts             #   B2 masters via @/archive S3ObjectStore.get(key) (primary)
│   └── iiif-source.ts           #   IIIF Image API full-size (alternate)
└── render/
    ├── typst-input.ts           #   Edition → Typst input JSON (serialize, stable keys)
    ├── typst-runner.ts          #   TypstRunner interface + real exec impl (shell out, DI)
    └── build.ts                 #   compose: resolve → fetch → serialize → invoke Typst → write PDF

scripts/build-pdf.ts             # NEW — npm `pdf:build` main(); sibling to build-snapshot.ts
pdf/template/                    # NEW — Typst template + embed-licensed fonts (design via /frontend-design)
├── edition.typ                  #   the facing-page template (authored AFTER frontend-design)
└── fonts/                       #   OFL / embed-permissive Didone + grotesque faces

tests/unit/pdf/                  # NEW — unit tests (in-memory ObjectStore + fake TypstRunner)
tests/integration/pdf/           # NEW — one real PB-P001 issue → Typst input JSON, guarantees G-1..G-n

src/browser/model.ts             # TOUCHED (additive) — extend per-page provenance with machine-assist label
```

**Structure Decision**: A new **`src/pdf/` domain folder** in the existing root TypeScript package,
layered exactly like `src/browser/` (`model.ts` pure types → `load/` → `images/` → `render/`,
env-only `config.ts`), reusing `@/browser`, `@/archive`, `@/bibliography`, `@/model`. The CLI entry
is a **`scripts/build-pdf.ts`** with a bare `main()` wired as npm `pdf:build`, matching
`scripts/build-snapshot.ts` / `scripts/export-public.ts` (not the `gallica`/`translate` bin/handler
machinery). The **Typst template + fonts** live at repo-root `pdf/template/` (sibling to `site/`),
authored only after the `/frontend-design` pass. The single additive change to the closed
corpus-browser model is carrying the translation machine-assist label into the snapshot so the
colophon is reproducible from the pin (see research.md Decision 3).

## Complexity Tracking

> No Constitution Check violations — section intentionally empty.
