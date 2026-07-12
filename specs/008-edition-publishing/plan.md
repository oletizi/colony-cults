# Implementation Plan: Edition Publishing

**Branch**: `feature/edition-publishing` | **Date**: 2026-07-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-edition-publishing/spec.md`

## Summary

A governed `pdf:publish` CLI verb that distributes already-built facsimile-edition PDFs
(`build/pdf/<sourceId>/<issueId>.pdf`) to the public B2 bucket — fronted by the Cloudflare
read-through CDN — as **immutable, snapshot-versioned artifacts**, and records each publication
in the canonical bibliography SSOT as a per-edition `publications[]` entry on the `Source`
(distinct from `repositoryRecords[]`), with per-issue integrity (URL, sha256, pages) in a
referenced manifest file. Publishing is **rights-gated, fail-closed** (an affirmative
work-level `Source.rights` value is required; `likely`/absent/non-distributable is refused),
**idempotent** (`head(key)` sha256 match → skip), and **composable** (it publishes, it does not
build). It reuses the shipped `@/archive` object-store, checksum, and pin layers and the
`@/bibliography` SSOT read/write, and subsumes the deliberate public-export seam deferred from
spec 007. Technical approach detailed in [research.md](research.md); shapes in
[data-model.md](data-model.md); interfaces in [contracts/](contracts/).

## Technical Context

**Language/Version**: TypeScript 5.3, ESM (`"type": "module"`), executed with `tsx` (never
`ts-node`). `@/*` path imports.

**Primary Dependencies**: `@aws-sdk/client-s3` (via the existing `@/archive/s3-object-store`
`S3ObjectStore`), `yaml` (SSOT serialize/parse). No new runtime dependency. Node `node:crypto`
for sha256 (existing `@/archive/checksum`).

**Storage**:
- Public **Backblaze B2** bucket (`COLONY_S3_BUCKET`, path-style, `f004`/us-west-004), fronted
  by the Cloudflare CDN (`CORPUS_CDN_BASE=https://colony-cults-cdn.oletizi.workers.dev`).
- The **SSOT** at `bibliography/sources/<id>.yml` (extended: `rights`, `publications[]`) plus a
  new per-publication manifest file under `bibliography/publications/`.

**Testing**: `vitest` (`npm test`; a `tests/unit/publish/**` group). `FakeObjectStore`
(`tests/unit/archive/fake-object-store.ts`, in-memory `ObjectStore`) + temp SSOT dirs prove
idempotency/immutability/refusal with no network; a real end-to-end publish validates B2 + CDN.

**Target Platform**: Node CLI (macOS/Linux dev), same runtime as the rest of the toolchain.

**Project Type**: Single TypeScript CLI project (the `gallica-fetcher` toolchain) — one new
`scripts/*.ts` verb + a new `src/` module set, mirroring `pdf:build` / `site:export-public`.

**Performance Goals**: not latency-bound. Idempotent skip via `head` (a Class B-cheap metadata
call) so unchanged re-runs do zero uploads; upload is a Class A write (uncapped). CDN warm is a
best-effort, download-capped read class, handled non-fatally.

**Constraints**: fail-loud, no fallbacks/mock outside tests (Constitution V); no `any`/`as`/
`@ts-ignore` (VII); files 300–500 lines (VII); composition + injected collaborators
(`ObjectStore`, an HTTP GET, a `publishedAt`/clock supplier) over inheritance (VI); B2 secret
never logged. Rights fail-closed (IV). No CDN purge is ever required (immutable keys).

**Scale/Scope**: v1 targets whole-source publish of PB-P001 (~72 english-only issues) + the
reconcile back-fill of the already-served 72; both edition variants supported.

## Constitution Check

*GATE: evaluated against `.specify/memory/constitution.md` v1.0.0. Re-checked post-design.*

| Principle | How this plan complies |
|-----------|------------------------|
| I. Evidence Before Narrative | Each publication records the exact pinned snapshot + per-issue sha256 — the artifact is traceable/verifiable from the record alone (SC-001/002). |
| II. Preserve Disagreement | N/A (no claim reconciliation); the two URL schemes coexist explicitly (`keyScheme`) rather than one silently masking the other. |
| III. Provenance Is Mandatory | Publication carries variant, publishedAt, snapshot, cdnBase, rightsBasis, machineAssist + per-issue url/sha256/pages; committed as part of publishing (FR-008). |
| **IV. Respect Copyright (Fail Closed)** | **Central.** Affirmative, controlled `Source.rights` required; `likely`/absent/non-distributable → refused, nothing uploaded/recorded (FR-002, SC-003). Translated (`english-only`) editions carry a `machineAssist` label. |
| V. Fail Loud, No Fallbacks | Missing env/pin/built-PDF/rights → descriptive throw; a present-but-different versioned key → fail loud (never overwrite); no partial/placeholder publish (FR-011). Test-only fakes (`FakeObjectStore`). |
| VI. Composition Over Inheritance | New modules compose over injected `ObjectStore` (+ HTTP GET, clock) behind interfaces; no class inheritance (the counting test-store subclass is test-only). |
| VII. Type Safety | No `any`/`as`/`@ts-ignore`; `@/` imports; new modules kept ≤ 300–500 lines (verb split into resolve / gate / key+url / upload / record submodules). |
| VIII. Faithful Tool Adoption | Authored via the stack-control front door (`define` → this `extend` → `execute` → `ship`); reuses shipped `@/archive` + `@/bibliography` rather than reimplementing. |
| IX. Durable Work | The verb commits SSOT + manifest as part of publishing (FR-008); session work committed/pushed promptly. |
| X. No Git Hooks | No hooks added; enforcement lives in the verb + tests + review + CI. |
| XI. Design Through the Design Skill | No user-facing UI in this feature (a CLI verb + record shapes). The already-shipped review **index page** went through `/frontend-design`; this feature adds no new UI. |

**Gate result**: PASS. No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/008-edition-publishing/
├── plan.md              # This file
├── research.md          # Phase 0 — technical decisions
├── data-model.md        # Phase 1 — SourceRights, Publication, PublicationManifest, PublishedArtifactRef
├── quickstart.md        # Phase 1 — runnable validation scenarios
├── contracts/
│   ├── cli.md           # pdf:publish CLI contract (flags, guarantees G-1..G-10, exit codes)
│   └── ssot-publications.md   # on-disk rights + publications[] + manifest schema
├── checklists/
│   └── requirements.md  # spec quality checklist (passed)
└── tasks.md             # Phase 2 — created by /speckit-tasks (NOT here)
```

### Source Code (repository root)

```text
scripts/
└── publish-pdf.ts               # NEW — the pdf:publish verb (arg parse, preflight, main; mirrors build-pdf.ts + export-public.ts confirm-gate)

src/pdf/publish/                  # NEW module set (composed, injectable, each ≤ 300–500 lines)
├── resolve.ts                    #   resolve source + variant + built-PDF dir; enumerate issues (reuse @/pdf/render/batch enumerateItemIds / listSnapshotSourceIds)
├── rights-gate.ts                #   affirmative fail-closed Source.rights gate (new; reuses 'public-domain' + fail-closed shape from @/rights/gate)
├── version.ts                    #   snapshotShort from resolveArchiveRef() (@/pdf/config); fail loud on empty pin
├── key.ts                        #   versioned + legacy-flat key builders; cdn url = ${cdnBase}/${key}
├── upload.ts                     #   idempotent uploader over injected ObjectStore (head→compare sha256→put | skip | fail-loud-on-mismatch)
├── record.ts                     #   build Publication + PublicationManifest; write via @/bibliography serialize; commit
├── warm.ts                       #   best-effort, non-fatal CDN warm (reuse defaultHttpGet pattern)
└── publish.ts                    #   orchestration (dry-run | confirm | reconcile), record-and-continue batch, "published N failed M" summary

src/model/
├── source.ts                     # EXTEND — add optional rights?: SourceRights; publications?: Publication[]
├── publication.ts                # NEW — Publication, PublicationManifest, PublishedArtifactRef, SourceRights types
└── index.ts                      # EXTEND — re-export new types

src/bibliography/
├── vocab.ts                      # EXTEND — SourceRightsStatus controlled vocab (public-domain, …)
├── load.ts                       # EXTEND — add 'rights' + 'publications' to SOURCE_KEYS + validators (mirror repositoryRecords parse)
├── migrate-serialize.ts          # EXTEND — serializeSource emits rights + publications[] (fixed key order, omit-absent)
├── source-writer.ts              # NEW (small) — writeSourceFile(dir, serializeSource(...)) (no single-source writer exists today)
└── validate*.ts                  # EXTEND — publication checks: (variant,snapshotShort) uniqueness, manifest existence, rightsBasis present

tests/unit/publish/               # NEW — rights-gate refusal, idempotency (zero put), immutability, reconcile, key/url derivation (FakeObjectStore + temp SSOT)
tests/integration/publish/        # NEW — end-to-end publish shape (real store behind a guard / recorded fixtures)

package.json                      # EXTEND — "pdf:publish": "tsx scripts/publish-pdf.ts"
```

**Structure Decision**: Single-project layout, matching the shipped toolchain. The verb lives in
`scripts/publish-pdf.ts` (the established `pdf:`/`site:` standalone pattern), delegating to a new
composed `src/pdf/publish/` module set built from small, injectable, individually-tested parts —
so the object store, HTTP GET, and clock are injected (test with `FakeObjectStore` + temp dirs)
and no file exceeds the size limit. Model/bibliography extensions are additive (existing SSOT
files stay valid). No worktree/docs infra is created here (that is not `extend`'s job).

## Complexity Tracking

No Constitution Check violations — this section is intentionally empty.
