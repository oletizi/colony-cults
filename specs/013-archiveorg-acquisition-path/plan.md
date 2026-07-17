# Implementation Plan: Internet Archive acquisition adapter

**Branch**: `feature/corpus-gap-closure` (long-lived; spec dir resolved via `.specify/feature.json`) | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-archiveorg-acquisition-path/spec.md`

## Summary

Add the **third** first-class repository adapter to the corpus-gap-closure pipeline (after
Gallica and the New Italy Museum): an **Internet Archive** adapter that turns a verified,
public-domain archive.org text item into a held corpus member in the uniform per-page-image
archive shape. It implements the shipped `RepositoryAdapter` seam
(`repository`/`resolve`/`collectRightsEvidence`/`acquire` — **no `search`**), registers under a new
`internet-archive` `RepositoryName` and `ia-item` copy identifier, and reuses the shipped
`bib inventory | verify-member | promote | acquire | reconcile | coverage` verbs unchanged.

Technical approach (from the design record + Phase 0 research): reach the document the **frugal**
way (one cheap PDF download to staging under `COLONY_ARCHIVE_ROOT`), enforce a **fail-closed quality
gate** before any B2 write, **select the master source from measured evidence** (explode the PDF
unless a dimension-ratio probe shows it is materially degraded, in which case fetch the archive's
full-resolution page-image set — `_jp2.zip` **or `_tif.zip`**), **explode into per-page image masters**
under a strict page-to-leaf invariant with per-page method provenance, **preserve the source PDF** as
a `repository-source` asset, upload to B2, and reconcile the `RepositoryRecord` to `archived`. First
consumer: the de Groote 1880 book `nouvellefrancec00groogoog` (SC-001). Discovery is manual-backed in
v1 (operator supplies the item id); the automated `advancedsearch` mechanism is captured for a later
spec (FR-014).

## Technical Context

**Language/Version**: TypeScript, executed with `tsx` (no `ts-node`, no `nox tsx`). ESM, `@/` import paths.

**Primary Dependencies**: shipped `RepositoryAdapter` + `RepositoryAdapterRegistry`
(`src/repository/`); `HttpClient` polite/rate-limited fetch client (`src/gallica/http-client.ts`);
`execCommand` injectable shell-out (`src/ocr/exec.ts`) driving **poppler** (`pdfimages`, `pdftoppm`,
`pdfinfo`); `S3ObjectStore` + `resolveObjectStoreConfig()` (`src/archive/`); metadata-snapshot store
(`src/sourcegroup/snapshot.ts`); `sha256OfBytes` (`src/archive/checksum.ts`). Poppler is a system
dependency already declared by `src/ocr/preflight.ts`.

**Storage**: per-session archive clone at `COLONY_ARCHIVE_ROOT` (staging scratch subdir); **B2** is the
only shared object store; git-tracked provenance + `bibliography/repository-responses/<sourceId>/` for
metadata snapshots.

**Testing**: vitest 3.2.7 (`npm test` → `vitest run`; `npm run typecheck` → `tsc --noEmit`).
Co-located `*.test.ts` beside source; fixtures under `__fixtures__/` (the real de Groote metadata JSON
in `bibliography/repository-responses/PB-P002/` is the seed fixture); fakes injected for the HTTP
client, the poppler runner, and the object store — **no network / no B2 / no live poppler in tests**.

**Target Platform**: Node.js CLI (macOS/Linux dev), poppler installed via `brew install ... poppler`.

**Project Type**: Single-project TypeScript CLI + library (the `colony-cults` tooling repo).

**Performance Goals**: N/A (correctness- and frugality-bound, not throughput-bound). The binding
constraint is Principle XII: minimize and never waste archive.org requests (one PDF download; the
58 MB image-set zip fetched only when the fidelity probe demands it).

**Constraints**: fail-loud / no fallbacks / no mock data outside tests (Principle V); no `any`, no
`as Type`, no `@ts-ignore` (Principle VII); source files ≤ 300–500 lines (so the adapter is split into
focused modules — see Structure); rights fail-closed at `acquire` (Principle IV / INV-B); never
`bib migrate` (INV-F); test-first (Principle VIII).

**Scale/Scope**: one adapter, one copy type, three closed-vocabulary widenings, two new
`RepositoryRecord` provenance fields (`qualityAssessment`, `excludedLeaves`), one role-vocabulary
refinement, a new poppler extraction module, and CLI wiring at five existing call sites. v1 acquires a
single known item end-to-end; the adapter is reusable for further archive.org items.

## Constitution Check

*GATE: evaluated against the 14 principles; the acquisition-relevant ones are load-bearing here.*

| Principle | Status | How this plan satisfies it |
|---|---|---|
| I. Evidence Before Narrative | ✅ | Every acquisition carries per-page method provenance + metadata snapshot; the OCR/text remains evidence-adjacent, scans authoritative. |
| III. Provenance Is Mandatory | ✅ | Per-asset provenance (sourceUrl, checksum, byteLength, objectStoreKey), `metadataSnapshots`, `qualityAssessment`, `excludedLeaves`, `originalUrl` = details page. |
| IV. Respect Copyright (Fail Closed) | ✅ | `collectRightsEvidence` proposes only; operator authors `rightsAssessment`; `acquire` throws before any fetch unless `public-domain` (INV-B). Google notice preserved, never declared void (FR-006). |
| V. Fail Loud, No Fallbacks | ✅ | `resolve` throws on unverifiable id / ambiguous files; count-mismatch fails loud; remote-bytes-change throws; no fabricated ids; no mock data outside tests. |
| VI. Composition Over Inheritance | ✅ | Adapter is a `class … implements RepositoryAdapter` with constructor DI of injected interfaces (http client, poppler runner, object store, clock) — mirrors the museum adapter; no inheritance. |
| VII. Type Safety | ✅ | `@/` imports, no `any`/`as`/`@ts-ignore`; new fields typed; role narrowed to a union; files kept ≤ 500 lines via module split. |
| VIII. Faithful Tool Adoption | ✅ | Fits the shipped seam exactly, drives the real `bib` verbs in order; this plan itself flows through the stack-control front door; test-first. |
| IX. Durable Work | ✅ | Commit per coherent unit; the plan + artifacts are committed via the `after_plan` hook. |
| X. No Git Hooks | ✅ | No hooks added or relied on. |
| XII. Respect the Source (Frugal) | ✅ | All access via the shipped polite `HttpClient` (no curl); one PDF download; image-set zip only when the probe warrants; `dryRun` = download-keep-verify-upload-if-good (D-11), fixing the museum `--dry-run` defect (TASK-29). |
| XIII. No Agent Memory | ✅ | All knowledge lives in these repo artifacts, not an agent store. |
| XIV. Operator Owns Scope | ✅ | Nothing cut; three spec-vs-reality gaps surfaced (research D-2/D-3/D-6) for the operator, not silently absorbed. |

**XI. Design Through the Design Skill**: N/A — this feature has **no UX/UI surface** (a CLI adapter +
provenance records). No markup/CSS is created. (Recorded explicitly so the gate is not silently skipped.)

**Gate result: PASS** (no violations; Complexity Tracking empty).

## Project Structure

### Documentation (this feature)

```text
specs/013-archiveorg-acquisition-path/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D-1..D-11, unknowns resolved, operator flags
├── data-model.md        # Phase 1 — entities, new fields, vocab widenings, transitions
├── quickstart.md        # Phase 1 — end-to-end validation (de Groote acquisition)
├── contracts/
│   ├── repository-adapter.md      # (existing, 011) authoritative interface — referenced, not duplicated
│   └── internet-archive-adapter.md # Phase 1 — IA-specific contract: resolve/rights/acquire behavior + invariants
└── tasks.md             # Phase 2 — /speckit-tasks (NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/repository/internet-archive/          # NEW — the adapter, split for the ≤500-line rule
├── adapter.ts                            # class InternetArchiveAdapter implements RepositoryAdapter
├── metadata.ts                           # archive.org item metadata API client + typed parse (files, scandata ref)
├── file-select.ts                        # deterministic source-file selection (primary PDF; reject OCR-only/encrypted; fail loud on ambiguity)
├── scandata.ts                           # scandata.xml parse → per-leaf pageType + recorded dimensions (range seed)
├── fidelity.ts                           # dimension-ratio probe (pdfimages -list vs scandata) → explode-PDF | fetch-image-set
├── extract.ts                            # per-page page-to-leaf explosion (pdfimages-lossless | pdftoppm-rasterised) + count verify
├── rights.ts                             # collectRightsEvidence: possible-copyright-status + grounded date/creator (no verdict)
├── index.ts                              # barrel
└── *.test.ts + __fixtures__/             # co-located tests; fixture = captured de Groote metadata/scandata

src/pdf/poppler/                          # NEW — injected poppler wrapper (composed on @/ocr/exec execCommand)
├── runner.ts                             # PopplerRunner interface + real impl: pdfimages(-list), pdftoppm, pdfinfo
└── runner.test.ts

src/model/
├── acquired-asset.ts                     # EDIT — narrow role? to a union incl. 'repository-source' | 'page-master'
├── identifiers.ts                        # EDIT — CopyLevelIdentifierType += 'ia-item'
├── repository-record.ts                  # EDIT — add qualityAssessment?, excludedLeaves?
└── quality-assessment.ts                 # NEW — QualityAssessment + ExcludedLeaf types (kept out of the record file for size)

src/repository/
├── adapter.ts                            # EDIT — RepositoryName += 'internet-archive'
└── registry.ts                           # EDIT — IDENTIFIER_TYPE_REPOSITORY.ia-item = 'internet-archive'

src/sourcegroup/acquire.ts                # EDIT — buildRegistry(...) registers the IA adapter
src/cli/
├── bib-inventory.ts                      # EDIT — asRepositoryName allowlist accepts 'internet-archive'
├── bib-acquire-internet-archive.ts       # NEW — buildInternetArchiveAdapterForMember peek-builder
└── bib-sourcegroup.ts                    # EDIT — runAcquireCli wires the IA peek-builder alongside the museum one
```

**Structure Decision**: Single-project layout (matches the repo). The adapter is deliberately split
into small modules (metadata / file-select / scandata / fidelity / extract / rights) so no file
approaches the 500-line ceiling that the museum adapter (~500 lines in one file) sits at — the poppler
extraction + fidelity logic is genuinely new surface and would otherwise blow the budget. The poppler
runner lives under `src/pdf/poppler/` (a reusable primitive, not IA-specific) composed on the existing
`src/ocr/exec.ts` `execCommand` so there is one shell-out chokepoint and tests inject a fake.

## Complexity Tracking

> No Constitution Check violations. No entries.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
