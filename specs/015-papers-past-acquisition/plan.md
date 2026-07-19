# Implementation Plan: Papers Past Acquisition Adapter

**Branch**: `feature/corpus-gap-closure` (numbered spec dir) | **Date**: 2026-07-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-papers-past-acquisition/spec.md`

## Summary

Add a `RepositoryAdapter` for Papers Past (NLNZ) so `bib acquire` can mirror one discrete public-domain Papers Past newspaper article — its page-image facsimile (N sequenced `/imageserver/...` GIF segments) — into the corpus archive + B2, end-to-end, parallel to the museum/IA adapters. The adapter reads the Incapsula-WAF-gated article page through the shipped spec-014 real-browser `BrowserSession` (persist-before-analysis) and fetches image bytes INSIDE that same WAF-cleared context via `BrowserSession.fetchBytes` (research R1 CONFIRMED: the `/imageserver/` CDN is WAF-gated too, so the stateless client fails; the byte-fetch stays guarded fail-loud against a non-GIF/challenge response). Rights are evidence-first (the adapter surfaces NLNZ's "No known copyright (New Zealand)" verbatim, no verdict) and fail-closed on an operator public-domain `RightsAssessment`. The de Rays article (SRCH-0018/0019) is made acquirable as a source-group member reusing the existing member-acquire path. OCR text is out of scope as an acquired asset (the existing OCR/translation pipeline produces it from the held facsimile; operator decision, clarified 2026-07-19).

## Technical Context

**Language/Version**: TypeScript (ESM), Node 22, `@/` → `src/` import alias

**Primary Dependencies**: spec-014 `BrowserSession` (real Playwright, WAF-clearing) — its `navigate` reads the article page AND its `fetchBytes` fetches the image bytes inside the same WAF-cleared context (research R1 CONFIRMED: the `/imageserver/` CDN is WAF-gated too, so a stateless `HttpClient` `getBytes` fails); `node-html-parser` (mechanical article parse); `@/archive/s3-object-store` `S3ObjectStore` + `resolveObjectStoreConfig` (B2); `@/archive/checksum` (sha256); the existing `RepositoryAdapter` framework + registry.

**Storage**: content-addressed objects in B2 under `archive/papers-past/<article-id>/<sha256>.{gif,txt}`; provenance `.yml` in the archive clone; `assets` recorded on the `papers-past` `RepositoryRecord` (`bibliography/sources/*.yml`).

**Testing**: vitest; unit tests with `FakeBrowserSession` (scripting both `navigate` HTML and `fetchBytes` image bytes) + fake `ObjectStore` (no network, no host); env-gated live acquisition + image-CDN-reachability (browser byte-fetch) scenarios.

**Target Platform**: local CLI (`bib acquire`) on the operator host.

**Project Type**: single project (CLI + library modules), existing repo structure.

**Performance Goals**: n=1 article; not throughput-bound. Politeness (paced byte fetch) over speed.

**Constraints**: fail-loud everywhere (Principle V — no fallbacks/mocks outside tests); files ≤ 500 lines; no `any`/`as`/`@ts-ignore`; governed reads only (no curl/WebFetch/ad-hoc browser); per-session archive clone + fail-closed rights.

**Scale/Scope**: one adapter (~single-asset museum shape), ~3 model/registry line-additions, CLI wiring, one corpus member + source-group, tests. MVP: one-article acquisition.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle II (Integration-First / capture-don't-cut)**: scope captured; the one operator scope decision (source-group membership vs TASK-27) was made explicitly via clarify, not a silent YAGNI cut. PASS.
- **Principle V (Fail-loud, no fallbacks)**: resolve fails loud on missing id/asset; acquire fails closed on rights and loud on remote-change / non-image response. No fallbacks outside tests. PASS.
- **Principle VI (Interface-first, DI, no inheritance)**: adapter is constructor-injected (`BrowserSession` — page read + WAF-cleared byte fetch, `ObjectStore`, clock); composes existing interfaces; no class inheritance. PASS.
- **Principle VIII (Faithful tool adoption)**: reuses the shipped `RepositoryAdapter` framework, the spec-014 browser (extended with `fetchBytes` for the WAF-gated CDN), and the object store — reinvents nothing; drives the Spec Kit chain in order. PASS.
- **Principle XII (Respect the Source)**: article reads go through the one governed browser mechanism (no ad-hoc channel); image bytes through the polite acquisition client; rights fail-closed. PASS.
- **INV (adapter invariants)**: no fabrication, rights fail-closed, typed result, single-adapter dispatch, idempotent, never-migrate — all honored. PASS.

No violations → Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/015-papers-past-acquisition/
├── plan.md              # This file
├── research.md          # Phase 0 (R1 image fetch, R2 OCR — out of scope, R3 facsimile, R4-R7 reuse)
├── data-model.md        # Phase 1 (vocab additions, ResolvedArticle, RightsEvidence, AcquiredAsset, key layout)
├── quickstart.md        # Phase 1 (7 validation scenarios)
├── contracts/           # Phase 1 (adapter.md, cli.md)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── model/
│   └── identifiers.ts             # + 'papers-past' to CopyLevelIdentifierType / COPY_LEVEL_TYPES
├── repository/
│   ├── adapter.ts                 # + 'papers-past' to RepositoryName
│   ├── registry.ts                # + IDENTIFIER_TYPE_REPOSITORY row
│   └── papers-past/
│       ├── types.ts               # ParsedArticle result interface (interface-first)
│       ├── adapter.ts             # PapersPastAdapter (resolve/collectRightsEvidence/acquire)
│       ├── parse.ts               # mechanical article parse (title, image URLs, metadata, rights, optional OCR)
│       └── index.ts               # barrel
└── cli/
    ├── bib-acquire-papers-past.ts # buildPapersPastAdapterForMember (mirror bib-acquire-museum.ts)
    ├── bib-sourcegroup-acquire.ts # wire the builder into runAcquireCli + registry
    └── bib-inventory.ts           # inventory repository allowlist (gallica/new-italy-museum/internet-archive → +papers-past)

tests/unit/repository/papers-past/
├── adapter.test.ts                # resolve / rights-evidence / acquire (fail-closed, idempotent, dry-run, image-guard)
└── parse.test.ts                  # parse-from-fixture (the persisted de Rays article HTML)
tests/integration/repository/papers-past/
└── acquire.test.ts                # env-gated live acquisition + image-CDN reachability

bibliography/sources/PB-P0NN.yml   # the de Rays article Source + papers-past record (+ NZ-press source-group)
```

**Structure Decision**: single project, existing layout; the adapter lives under `src/repository/papers-past/` mirroring `src/repository/new-italy-museum/`; CLI wiring mirrors `bib-acquire-museum.ts`. No new top-level structure.

## Complexity Tracking

No Constitution violations — none.
