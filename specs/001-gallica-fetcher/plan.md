# Implementation Plan: Gallica Fetcher

**Branch**: `feature/gallica-fetcher` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-gallica-fetcher/spec.md`; design source of truth `docs/superpowers/specs/2026-07-08-gallica-fetcher-design.md`.

## Summary

A reusable TypeScript CLI that mirrors public-domain BnF Gallica sources for the Colony Cults archive using Gallica's documented web-service + IIIF APIs (not the anti-bot HTML UI). It builds a per-source issue census (public repo), fetches full-resolution page images into the private sibling archive, and optionally self-OCRs those images into searchable PDF/A + text. A per-item rights gate, a non-overridable archive-only write guard, checksum-based resumability, and dry-run mode are load-bearing requirements.

## Technical Context

**Language/Version**: TypeScript 5.x, run with `tsx` on Node.js ≥ 20 (global `fetch`, `node:crypto`, `node:util.parseArgs`).

**Primary Dependencies**: kept minimal — `fast-xml-parser` (parse the `Issues` / `Pagination` / `OAIRecord` XML); OCR is a shell-out to external tools (`img2pdf`, `ocrmypdf`, `pdftotext`, Tesseract with `fra`), not a library. Arg parsing via `node:util.parseArgs` (no dep). Rate limiting/backoff implemented in-house (small, testable; no dep).

**Storage**: filesystem only. Census JSON → public repo under `data/census/`. Page images, PDF/A, text, and per-asset provenance JSON sidecars → private sibling repo `../colony-cults-archive` (per-source / per-issue tree).

**Testing**: `vitest` — unit tests for pure logic (census parsing, path guard, checksum, backoff, rights parsing) and integration tests against **recorded fixtures** of the four Gallica endpoints (no live network in CI).

**Target Platform**: developer CLI on macOS/Linux (Node ≥ 20). OCR requires the operator-installed toolchain.

**Project Type**: single project — a CLI library with a thin command layer.

**Performance Goals**: politeness-bounded, not throughput-bound. Default ≤ 2 concurrent requests and a conservative rate (≈1 request/sec) with exponential backoff, so a full 78-issue run completes without tripping host protection. No hard latency target (respectful mirroring, not real-time).

**Constraints** (from global engineering rules): no fallbacks/mock data outside tests — fail loud with descriptive errors; `@/` import pattern; no `any`, no `as`, no `@ts-ignore`; composition over inheritance (interface + DI, no class inheritance); each file ≤ 300–500 lines.

**Scale/Scope**: first source 78 issues × ~8–12 pages (order of hundreds of MB); must generalize to the other Port Breton Gallica sources (`PB-P002/003/004`), including single-document (monograph) sources.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is the unratified template — no project-specific principles are declared, so there are no constitution gates to violate. In its place, this plan is held to the operator's standing global engineering rules (captured under **Constraints** above) and the approved design record's decisions. No violations: the design is composition-based, fail-loud, typed strictly, and file-modular by construction.

- Fail-loud / no fallbacks: rights gate throws; missing OCR toolchain throws; 403 retries then throws.
- Strict typing (`@/`, no `any`/`as`): enforced by tsconfig + lint intent.
- Modularity (files ≤ 300–500 lines): the layered structure below keeps each unit small and single-purpose.

**Post-Phase-1 re-check**: the design artifacts (data-model, contracts) introduce no new complexity or gate concerns — still clean.

## Project Structure

### Documentation (this feature)

```text
specs/001-gallica-fetcher/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI + Gallica API contracts)
│   ├── cli.md
│   └── gallica-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── model/            # types: Source, Census, Issue, Page, Asset, Provenance, Rights (no logic)
├── gallica/          # GallicaClient: Issues, Pagination, OAIRecord, IIIF image; HttpClient with UA + rate-limit + backoff
├── rights/           # rights gate: parse OAIRecord dc:rights; assertPublicDomain(ark) throws otherwise
├── census/           # build census from Issues+Pagination; deterministic JSON serialize
├── archive/          # archive-path resolver + non-overridable write guard; provenance sidecar writer; checksum (sha256)
├── fetch/            # fetch pipeline: per-issue image fetch, resumability (skip-if-recorded), size estimation for dry-run
├── ocr/              # OCR pipeline: dependency preflight; img2pdf → ocrmypdf → pdftotext shell-out
├── cli/              # command layer: parseArgs, census/fetch-issue/fetch-source/ocr, global flags, dry-run reporting
└── index.ts          # CLI entry (bin)

tests/
├── unit/             # census parse, path-guard, checksum, backoff, rights parse, dry-run report
├── integration/      # census→fetch flow against fixtures; guard refusal; resumability
└── fixtures/         # recorded Issues/Pagination/OAIRecord XML + a small IIIF image

data/
└── census/           # public census output (e.g. pb-p001-la-nouvelle-france.json)

package.json · tsconfig.json (paths: @/* → src/*) · vitest.config.ts
```

**Structure decision**: single project, layered by responsibility. The dependency direction is one-way: `cli → {census, fetch, ocr} → {gallica, rights, archive} → model`. `HttpClient` (politeness) is the only I/O boundary to the network; `archive` is the only I/O boundary that writes preservation assets, and it owns the guard so no other layer can bypass it.

## Complexity Tracking

No constitution gates exist to violate, and the design introduces no exceptional complexity (minimal deps, one network boundary, one write boundary). Nothing to justify.

## Phase notes

- **Phase 0 (research.md)**: resolves residual unknowns — the exact IIIF full-native image URL form + page enumeration, the OCR route decision (self-OCR, recorded), the `fra` toolchain install, and politeness parameters. All primary premises were verified live during design (Issues/Pagination/OAIRecord/IIIF = 200; `.texteBrut` = 403).
- **Phase 1**: `data-model.md` (entities + validation + provenance sidecar shape), `contracts/` (CLI command surface + Gallica endpoint contracts), `quickstart.md` (end-to-end validation). Agent context marker in `CLAUDE.md` updated to point at this plan.
