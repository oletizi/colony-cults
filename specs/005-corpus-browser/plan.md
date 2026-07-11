# Implementation Plan: Corpus Browser

**Branch**: `feature/corpus-browser` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-corpus-browser/spec.md`

## Summary

A **static, build-time-generated Astro website** that presents each corpus page as a **facsimile beside its page-aligned parallel text** (raw French OCR + English translation, with per-page corrected-French available), inside the cool archival "Prospectus/Dossier" frame whose signature is a monospace **provenance rail**. v1 content is **PB-P001** (*La Nouvelle France*, 78 issues); the data layer is modelled as a periodical (Source → Issue → Page) with room to generalize.

**Technical approach**: Two layers.

1. **A headless TypeScript data layer** at `src/browser/` (root package, reuses `@/model` + `@/bibliography`) that reads the **local archive clone** and the **bibliography SSOT**, normalizes to an in-memory `Source → Issue → Page` model, splits per-page OCR from `issue.txt` form-feeds, pairs each page with `translation/pNNN.{fr,en}.txt` and its provenance sidecar, and **fails loud** on any missing/inconsistent layer. It also builds the per-page **search documents** and resolves image URLs through a pluggable **image-source provider** (`source-iiif` | `b2-cdn`). This layer is pure TS, unit-tested with the existing `vitest` setup — no Astro dependency, so the fail-loud contract is testable without a browser.
2. **An Astro static site** at `site/` that imports the data layer, renders `source → issue → page` routes, and mounts two client islands — **OpenSeadragon** (deep-zoom viewer) and **Pagefind** (client-side search over the build-time index). The reading view, navigation, search UI, and visual identity are implemented **through the `/frontend-design:frontend-design` skill** (Constitution Principle I), against the approved [design record](../../docs/superpowers/specs/2026-07-09-corpus-browser-design.md) and [reading-view mockup](../../docs/superpowers/specs/2026-07-09-corpus-browser-reading-view-mockup.html).

The corpus is **public-domain**; the build needs **no credentials**. A public deployment is a **deliberate export** step (OQ-4, deferred), not an incidental output of the internal build.

## Technical Context

**Language/Version**: TypeScript 5.3 on Node 20, ESM (`"type": "module"`), consistent with the existing package.

**Primary Dependencies**: **Astro** (static site generator + islands), **OpenSeadragon** (deep-zoom image viewer island), **Pagefind** (static client-side search, indexes built HTML). Reuses existing `yaml`, `fast-xml-parser`. No class inheritance; interface-first + DI per repo CLAUDE.md. (See research.md R-001/R-003/R-004 for each choice + alternatives.)

**Storage**: files, read-only at build. Inputs: the **local archive clone** (`../colony-cults-archive` by default; path is config, not a secret) — page images `fNNN.jpg`, `issue.txt` (form-feed OCR), `translation/pNNN.{fr,en}.txt` + `.yml` provenance sidecars — and the public **bibliography SSOT** (`bibliography/sources/PB-P001.yml`) for source-level metadata/ARK/census. Output: a static site under `site/dist/` plus the Pagefind index. No database.

**Testing**: `vitest` (`vitest run`) for the `src/browser/` data layer — unit tests for OCR page-splitting, translation pairing, provider URL construction, search-doc building, and the fail-loud paths; integration test that normalizes a real PB-P001 issue fixture. Astro build is validated via the quickstart run guide.

**Target Platform**: a static site served by any host (deploy target Netlify / Cloudflare Pages); modern browsers for the deep-zoom + search islands.

**Project Type**: web application — static site generator (`site/`) over a headless TS data library (`src/browser/`).

**Performance Goals**: not latency-bound. Build scope ~78 issues × ~8 pages ≈ 600+ page routes for PB-P001; the deep-zoom viewer must stay responsive (smooth pan/zoom) on high-resolution masters. Determinism of generated routes/search docs matters more than build throughput.

**Constraints**: `@/` import pattern (root `src`); no fallbacks/mock data outside tests — **throw** on missing/inconsistent corpus data (matches existing `sourceMeta` fail-loud); files 300–500 lines max; no `any`/`as`/`@ts-ignore`; no git hooks. **Strict CSP on the public host** → inline the display typeface as a data-URI `@font-face` and avoid external font/asset hosts (FR-016). **All UX/UI via `/frontend-design:frontend-design`** (Principle I).

**Scale/Scope**: v1 content = PB-P001 only; data layer generalizes to other periodical sources without rework (OQ-7 deferred; monograph/source-group shapes are later).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) has **one ratified principle** (Principle I) atop otherwise-unratified template placeholders. Principle I is checked here as a hard gate; the remaining governing rules are the repo + user CLAUDE.md guidelines.

| Principle / Rule | Compliance |
|------------------|-----------|
| **Constitution Principle I — all UX/UI work MUST go through `/frontend-design:frontend-design` (NON-NEGOTIABLE)** | PASS (planned) — this plan authors **no UI**. The data layer (`src/browser/`) is headless. Every user-facing surface (reading view, navigation, search UI, provenance rail, visual identity) is deferred to `/speckit-implement`, where its tasks are explicitly gated on the frontend-design skill (see tasks phase + research.md R-006). The approved design record + mockup were themselves produced under that skill. |
| No fallbacks / mock data outside tests; throw on missing | PASS — the loader + provider resolution fail loud, naming source/issue/page and the missing layer (FR-002, FR-013, edge cases). |
| `@/` import pattern | PASS — data layer uses `@/model`, `@/bibliography`, `@/browser/…`; the Astro site imports the data layer via the same alias. |
| Avoid class inheritance; interface-first + DI | PASS — the image-source provider is an **interface** with two implementations selected by config (DI), not a base class; the loader is pure functions + injected filesystem/archive path. |
| No `any` / `as` / `@ts-ignore` | PASS — parsed YAML/OCR narrowed via explicit validators; provider config is a discriminated union. |
| Files 300–500 lines | PASS — data layer split into `load/`, `providers/`, `search/`, `model.ts`; site components are per-surface. |
| No git hooks | PASS — verification lives in vitest + the quickstart run guide + `/verify`, not hooks. |

**Gate result: PASS** (no unjustified violations). The one material new surface is three build/UI dependencies (Astro, OpenSeadragon, Pagefind) — each is the design-chosen, load-bearing tool for a capability the spec requires, justified in research.md; there is no simpler alternative that delivers static generation + deep-zoom + client-side search.

**Post-Phase-1 re-check: PASS** — the data model and contracts introduce no class hierarchies, no `any`, and no UI; the provider is a two-variant interface; every generated route/search-doc is deterministic. Principle I remains satisfied because Phase 1 produced only headless contracts and design docs, no UI implementation.

## Project Structure

### Documentation (this feature)

```text
specs/005-corpus-browser/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── image-provider.md
│   ├── corpus-loader.md
│   ├── routes.md
│   └── search-document.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── browser/                     # NEW — headless data layer (no Astro dep; vitest-covered)
│   ├── model.ts                 # Source/Issue/Page view-model types for the browser
│   ├── load/
│   │   ├── corpus.ts            # archive-clone → normalized Source→Issue→Page (fail-loud)
│   │   ├── ocr-pages.ts         # split issue.txt on form-feeds → per-page raw OCR
│   │   └── translation.ts       # pair translation/pNNN.{fr,en}.txt + provenance sidecar
│   ├── providers/
│   │   ├── provider.ts          # ImageSourceProvider interface (DI) + config union
│   │   ├── source-iiif.ts       # build IIIF tile/image URLs from the source ARK
│   │   └── b2-cdn.ts            # build image URLs from object_store key + CDN base
│   ├── search/
│   │   └── documents.ts         # per-page search documents (FR + EN)
│   └── config.ts                # archive path, provider selection, CDN base (env/flag; no secrets)
├── model/  bibliography/  …     # existing — reused via @/model, @/bibliography
└── …

site/                            # NEW — Astro static site (UI via frontend-design)
├── astro.config.mjs
├── src/
│   ├── pages/
│   │   ├── index.astro                                   # corpus / source list
│   │   └── sources/[sourceId]/
│   │       ├── index.astro                               # issue list for a source
│   │       └── issues/[issueId]/pages/[pageId].astro     # reading view
│   ├── components/               # reading view, provenance rail, nav, search UI
│   └── islands/                  # OpenSeadragon viewer, Pagefind search
└── public/ | assets/             # inlined display font (data-URI @font-face)

tests/
├── unit/browser/                # ocr-pages, translation, providers, search docs, fail-loud
└── integration/browser/         # normalize a real PB-P001 issue fixture end-to-end
```

**Structure Decision**: A **headless data layer in the existing root `src/` package** (`src/browser/`, reusing `@/model` + `@/bibliography`, covered by the existing `vitest`) plus a **new `site/` Astro project** that consumes it. This keeps the fail-loud corpus logic testable without a browser and keeps the `@/` convention intact, while isolating the Astro/UI surface where the frontend-design gate applies. Astro/OpenSeadragon/Pagefind are added to the root `package.json`.

## Complexity Tracking

> No Constitution Check violations require justification. The three new dependencies are recorded in research.md (R-001/R-003/R-004) as the design-selected tools for required capabilities, not incidental complexity.
