# Implementation Plan: Source-Group Acquisition

**Branch**: `feature/source-group-acquisition` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-source-group-acquisition/spec.md`

## Summary

Build a reusable member-acquisition pipeline for source-groups — `Discover → Inventory → Repository verification → Research approval (Promote) → Acquire → Preserve` — as new `bib` subactions over the shipped canonical-metadata model, and run it end-to-end to acquire PB-P004's Marquis de Rays legal corpus. Deterministic software checks (`verify-member`) are separated from research judgment (`promote`); `promote` re-runs verification and records the verdict. Acquisition reuses the shipped fetcher unchanged, resolving the ARK from the selected RepositoryRecord. Discovery is a gated first task (a spike selecting one documented mechanism, fail-loud, no runtime fallback). Members are ordinary Sources with flat opaque `PB-P###` ids (atomically allocated) and `partOf` as the sole membership edge.

## Technical Context

**Language/Version**: TypeScript (ESM, `@/` path aliases), run via `tsx` (never `ts-node`).

**Primary Dependencies**: shipped in-repo modules — `@/model/source`, `@/model/repository-record`, `@/bibliography/{load,validate,vocab,migrate-serialize}`, `@/cli/{fetch,fetch-source,parse}`; the `yaml` package for SSOT serialization. New: one discovery-mechanism client (selected by the spike; BnF general-catalogue SRU lead).

**Storage**: git-tracked YAML SSOT under `bibliography/sources/<sourceId>.yml`; page-image masters to Backblaze B2 via the shipped object-store path; a new immutable metadata-snapshot store under `bibliography/` (path TBD in data-model).

**Testing**: `vitest` (`npm test`), `tsc --noEmit` for typecheck. TDD per project convention.

**Target Platform**: Node CLI (`gallica` bin → `src/index.ts`), macOS/Linux dev.

**Project Type**: Single-project CLI + library.

**Performance Goals**: not latency-bound; correctness- and provenance-bound. Network I/O (ARK resolution, discovery, fetch) dominates and is inherently bounded by the archive.

**Constraints**: fail-loud, no fallbacks or mock data outside tests; no `any`/`as`/`@ts-ignore`; composition over inheritance; files ≤300–500 lines; `@/` imports only.

**Scale/Scope**: PB-P004 corpus (a handful to a few dozen legal records) as v1; the pipeline is corpus-agnostic and reused across future source-groups.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an **unfilled template** in this installation; the effective governance is the project's `CLAUDE.md` + `TYPESCRIPT-ARCHITECTURE.md`. Gates evaluated against those:

- **Fail-loud, no fallbacks/mock-data outside tests** — PASS by design: every command throws informative errors on its defined failure conditions (FR-021); no runtime discovery fallback (FR-018); acquire refuses non-approved/non-public-domain members (FR-017).
- **Never bypass typing** (no `any`/`as`/`@ts-ignore`) — PASS: new code uses the shipped typed model; discovery client returns typed results.
- **Composition over inheritance, interface-first** — PASS: verbs are plain functions over injected dependencies (mirrors `runFetchSource`); the discovery mechanism is an interface with one implementation (the spike-selected client).
- **Reuse shipped model/fetcher; no new fetch code in v1** — PASS: acquisition wraps `runFetchSource`; the guardrail is unchanged (FR-015/FR-016).
- **Files ≤300–500 lines** — PASS (planned): one module per verb + shared helpers; see Structure.
- **`@/` imports, tsx not ts-node** — PASS.

**Post-Phase-1 re-check**: see end of this file. No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/006-source-group-acquisition/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI command contracts)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

New verbs join the existing `bib <subaction>` SSOT surface (dispatched in `src/index.ts` via `runBibliography`), keeping member operations next to the model they mutate:

```text
src/
├── cli/
│   └── bibliography.ts          # extend the bib sub-dispatch: inventory | verify-member | promote | exclude-member | acquire
├── sourcegroup/                 # NEW module — the member pipeline (one file per stage, ≤300–500 lines each)
│   ├── inventory.ts             # create member Source + RepositoryRecord (wanted) + metadata snapshot
│   ├── verify-member.ts         # deterministic checks (resolve/rights/required-fields/dedup) → Verdict
│   ├── promote.ts               # rerun verify → record verdict → discovered→approved-for-acquisition, wanted→to-collect
│   ├── exclude-member.ts        # discovered→excluded with reason
│   ├── acquire.ts               # resolve ARK from selected RepositoryRecord → runFetchSource (--object-store)
│   ├── id-alloc.ts              # atomic next-free PB-P### allocation (exclusive-create + retry)
│   ├── record-select.ts        # --archive selector over (sourceId, sourceArchive); infer-one / fail-loud-on-ambiguity
│   ├── snapshot.ts              # immutable metadata-snapshot write/read
│   └── discovery/
│       ├── discovery.ts         # DiscoveryMechanism interface + fail-loud dispatcher (one mechanism, no fallback)
│       └── <mechanism>.ts       # the spike-selected client (e.g. bnf-sru.ts) — added by the spike task
├── model/                       # REUSED as-is; possible additive field(s) for verification verdict + snapshot ref
└── bibliography/                # REUSED: load/validate/vocab/serialize; extend serialize for new optional fields

tests/  (co-located *.test.ts per repo convention, run by vitest)
```

**Structure Decision**: single-project CLI. Member operations are a new `src/sourcegroup/` module (pure functions + injected deps, mirroring `runFetchSource`), surfaced through the existing `bib` sub-dispatch rather than new top-level commands — they operate on the bibliography SSOT and belong with `bib migrate`/`bib show`. The shipped fetcher, model, and validation are reused; the only model surface additions are **additive optional fields** (verification verdict, snapshot reference), evaluated in data-model against a possible `004` amendment.

## Complexity Tracking

No Constitution Check violations. Section intentionally empty.

## Post-Design Constitution Re-Check

After Phase 1 (data-model + contracts + quickstart):

- The metadata-snapshot and verification-verdict additions are **additive optional fields** on the shipped model — no breaking change, no inheritance, no typing bypass. **PASS.**
- The `--archive` selector reuses the shipped `(sourceId, sourceArchive)` key — no new identifier scheme. **PASS.**
- Acquisition remains a thin wrapper over `runFetchSource` — no new fetch code. **PASS.**
- One open **operator decision** carried to tasks (not a violation): whether the metadata-snapshot + verdict fields land as an explicit amendment to `specs/004-canonical-source-metadata` or as feature-local additive fields. Default: additive fields here, cross-referenced to 004. See research.md D-07.
