# Implementation Plan: New Italy Museum acquisition path

**Branch**: `feature/corpus-gap-closure` (numbered spec dir `specs/011-museum-acquisition-path`) | **Date**: 2026-07-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-museum-acquisition-path/spec.md`; design record `docs/superpowers/specs/2026-07-13-museum-acquisition-path-design.md` (HOW, source of truth).

## Summary

Build the corpus's first non-Gallica acquisition path. Extract spec 009's `RepositoryAdapter` seam as a **full cutover** (Gallica refactored into a `GallicaAdapter` wrapping the shipped fetcher; the hardwired `ark → fetch-source` path removed), then add a `NewItalyMuseumAdapter` that fetches the Musarch catalogue via the existing rate-limit-safe HTTP client and extracts item metadata with a **layered hybrid**: DOM-direct pull for mechanical fields (asset URL, accession id) + a `StructuredExtractor` over the reused `createEngine` engine seam (codex default) for prose fields + a deterministic verifier that grounds every extracted value in the fetched bytes. Rights are fail-closed and operator-recorded on the `RepositoryRecord` via a dedicated rights-assessment step. Add the honest `item` structural kind, the `accession` copy-identifier, `SuspectedLead.resolution`, and the three-state `knownMemberCount`, with coverage rendering both. Acquisition is convergent/idempotent and reconciles into the SSOT. Success is measured (masters+provenance in B2, reconciled; Gallica characterization tests green), never asserted.

## Technical Context

**Language/Version**: TypeScript ~5.3 on Node, executed via `tsx` (no ts-node). `@/` import path pattern; no `any`/`as`/`@ts-ignore`.

**Primary Dependencies** (all shipped, reused — not rebuilt): `src/sourcegroup/*` (inventory/verify-member/promote/acquire/reconcile/record-select), `src/engine/*` + `src/codex/*` + `src/claude/*` (the coding-agent callout seam), `src/gallica/*` (HTTP client + fetcher), `src/model/*` (source, repository-record, identifiers, rights), `src/bibliography/*` (load-coverage-fields, coverage register/render, vocab), `src/rights/*`, `src/archive/*` (provenance), `@aws-sdk/client-s3` (B2 object store).

**Storage**: git-tracked YAML SSOT (`bibliography/sources/*.yml`, `bibliography/search-log.yml`) + Backblaze B2 object store (image masters, keyed by checksum-bearing provenance). No new store.

**Testing**: `vitest` (`npm test` → `vitest run`), colocated `*.test.ts` beside source + `tests/unit|integration/`. Fixtures under `src/sourcegroup/__fixtures__` and `tests/fixtures/`. Injected fake runners for the engine + HTTP + object store (no real shell-out / network in tests).

**Target Platform**: local operator CLI (`bib` verbs via `tsx`) + the static coverage web view (Astro) it feeds.

**Project Type**: CLI tool + supporting library (single project).

**Performance Goals**: not latency-bound; correctness + politeness. Reuse the existing rate-limit-safe HTTP client for museum fetches (no new throttling policy).

**Constraints**: fail-loud, no fallbacks/mock outside tests; no back-compat/transitional shims (clean cutover); files 300–500 lines max; composition + DI over inheritance; never fabricate an identifier/date.

**Scale/Scope**: small-n — ~125 Musarch catalogue items total; a handful of identified PB-P006 public-domain candidates. Two adapters built (Gallica, New Italy Museum); the seam generalizes but further repositories are captured-when-reached (009 FR-013).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Evidence Before Narrative** — PASS. Every extracted museum field is grounded in a persisted verbatim page excerpt (FR-008/FR-010); no value without traceable page evidence.
- **II. Preserve Disagreement & Uncertainty** — PASS. Three-state extent (`unexamined`/`irreducible`/number) and the `resolution` states record uncertainty explicitly rather than smoothing to a bare `unknown` (FR-018/FR-019).
- **III. Provenance Is Mandatory** — PASS. Acquired assets carry local key, retrieval date, original URL, checksum, format (FR-002); extraction stamps model-assisted + engine + model + prompt-version + timestamp (FR-010); provenance credits the museum.
- **IV. Respect Copyright (Fail Closed)** — PASS. Only an operator-recorded `public-domain` state permits mirroring; restricted/uncertain block mirroring, keep the catalog entry (FR-015/FR-016). Rights judgment is human, never model-authored.
- **V. Fail Loud, No Fallbacks** — PASS. Ungrounded extraction, engine-absent, removed-Gallica-path reference, ambiguous adapter selection, bare-`unknown` extent, and remote-content-change all fail loud (FR-003/008/011/019/021/023). No fallback/mock outside tests.
- **VI. Composition Over Inheritance** — PASS. `RepositoryAdapter` is an injected interface; adapters and the `StructuredExtractor` are composed behind interfaces with constructor DI; the engine/HTTP/object-store are injected runners (not ambient). No class inheritance.
- **VII. Type Safety Is Non-Negotiable** — PASS. Typed adapter I/O (`ResolvedRepositoryItem`, `AcquisitionResult`, `AcquiredAsset`, `GroundedField`); no `any`/`as`/`@ts-ignore`; `@/` imports; files kept ≤500 lines (adapters/extractor/verifier split into focused modules).
- **VIII. Faithful Tool Adoption** — PASS. Authored through the stack-control front door (define → execute); reuses shipped `bib` verbs + the engine seam rather than reimplementing.
- **IX. Durable Work — Commit & Push Early and Often** — PASS. Each task commits+pushes on coherence (enforced in execution, not a hook).
- **X. No Git Hooks, Ever** — PASS. No hooks added; enforcement stays in skills/CLI/review/CI.

**Result**: no violations; Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/011-museum-acquisition-path/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (adapter, structured-extractor, cli)
├── checklists/
│   └── requirements.md  # from /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root) — real directories

```text
src/
├── repository/                     # NEW — the adapter seam
│   ├── adapter.ts                  #   RepositoryAdapter interface + typed I/O
│   ├── registry.ts                 #   deterministic dispatch (ark->Gallica, accession->museum) + explicit --repository
│   ├── gallica/adapter.ts          #   GallicaAdapter (wraps src/gallica fetcher; the cutover target)
│   └── new-italy-museum/
│       ├── adapter.ts              #   NewItalyMuseumAdapter (fetch + resolve + rights-evidence + acquire)
│       ├── musarch-dom.ts          #   DOM-direct mechanical-field pull (asset URL, accession)
│       └── extractor.ts            #   binds StructuredExtractor to the museum schema + verifier
├── extraction/                     # NEW — extraction contract (engine-agnostic)
│   ├── structured-extractor.ts     #   StructuredExtractor<T>, GroundedField, GroundedExtraction
│   └── grounding-verifier.ts       #   deterministic excerpt-on-page + date-contains-value verifier
├── sourcegroup/                    # REUSE + refactor — dispatch through the adapter
│   ├── acquire.ts                  #   cut over: select record -> registry.select -> adapter.acquire
│   ├── inventory.ts                #   --repository selection; museum resolve path
│   ├── verify-member.ts / promote.ts  # unchanged group-member path (museum items are members)
│   └── reconcile.ts                #   unchanged
├── model/                          # REUSE + extend
│   ├── source.ts                   #   + kind 'item'
│   ├── identifiers.ts              #   + 'accession' CopyLevelIdentifierType
│   ├── repository-record.ts        #   + authoritative rights fields + assets
│   └── rights.ts                   #   + rightsStatus/basis/jurisdiction/assessedBy/assessedAt
├── rights/                         # REUSE + add the rights-assessment step
├── bibliography/                   # REUSE + extend
│   ├── load-coverage-fields.ts     #   + resolution key; three-state knownMemberCount
│   ├── vocab.ts                    #   + resolution vocab; extent states
│   └── coverage/coverage-render.ts #   render resolution + three-state extent
├── engine/ · codex/ · claude/      # REUSE unchanged (createEngine seam)
└── cli/bib-sourcegroup.ts          # REUSE + wire --repository + rights-assess verb
```

**Structure Decision**: Single-project TypeScript CLI+library. The one genuinely new area is `src/repository/` (the adapter seam) and `src/extraction/` (the engine-agnostic structured extractor + verifier). Everything else is an extension of a shipped module. Modules are split so no file exceeds ~500 lines (adapter interface, registry, each adapter, DOM pull, extractor, verifier are separate files).

## Complexity Tracking

> No Constitution Check violations — this section intentionally empty.
