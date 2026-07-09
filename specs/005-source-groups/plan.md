# Implementation Plan: Source Groups

**Branch**: `feature/source-groups` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-source-groups/spec.md`

## Summary

Add a first-class **`source-group`** kind to the canonical model for research-defined
collections that are *discovered before they can be acquired* (trial corpora,
correspondence, parliamentary papers). A source group is a container of member Sources —
it holds **no** repository records, is **never** fetchable, and its members are linked by a
`part_of` edge on the member (the group's member list is derived). Fetching/acquiring a
source group **fails loud and informatively**, keyed on the source's kind — the concrete
resolution of backlog **TASK-3** (`PB-P004` today fails with an opaque "no archive layout
registered" error). The status vocabulary gains `discovered` and `approved-for-acquisition`
for the Discover → Inventory → Verify → Promote → Acquire → Preserve pipeline, and `PB-P004`
(Marquis de Rays legal corpus) is reclassified as the project's first source group.

**Technical approach**: Extend the shipped canonical model (feature 004) rather than add a
parallel structure. `Source.kind` (`src/model/source.ts`) gains `'source-group'` and Source
gains an optional `partOf?: string` edge; a source group is a Source with `kind:
'source-group'` and no `repositoryRecords`. Validation (`src/bibliography/validate.ts` +
`validate-checks.ts`) gains a group/member split check (group ⇒ no repository records,
non-fetchable; member `part_of` must resolve; non-group ⇒ no members) and vocab
(`src/bibliography/vocab.ts`) gains the two statuses. The fetch guardrail keys on the **SSOT
Source kind**, not the `src/archive/location.ts` layout registry: `runFetchSource`
(`src/cli/fetch-source.ts`) loads the source's canonical kind and refuses a `source-group`
with an actionable message *before* touching `sourceLayout` (which today throws the opaque
unregistered-source error). `PB-P004.yml` is migrated (its single `to-collect` repository
record dropped; it becomes an empty-but-valid group seeded with `status: discovered` member
stubs as they are found). Deterministic hand-serialization (the established `provenance.ts` /
004 pattern) keeps generated views byte-reproducible.

## Technical Context

**Language/Version**: TypeScript 5.3 on Node 20, ESM (`"type": "module"`), run via `tsx`.

**Primary Dependencies**: existing — `yaml` (Source SSOT parse, added in 004),
`@aws-sdk/client-s3`, `fast-xml-parser`. No new dependency. No class inheritance;
interface-first + DI per repo CLAUDE.md.

**Storage**: files. SSOT = `bibliography/sources/PB-###.yml`. Source groups and member stubs
are ordinary Source records in the same SSOT (no new store — Assumption in spec). Derived
views (`bibliography/sources.csv`, acquisition tracker/register) regenerate deterministically
and must tolerate source-group rows (no repository record).

**Testing**: `vitest` (`vitest run`); unit under `tests/unit/`, integration under
`tests/integration/`; fixtures under `tests/fixtures/`.

**Target Platform**: local developer CLI (macOS/Linux).

**Project Type**: single-project TypeScript CLI (Option 1).

**Performance Goals**: not latency-bound; corpus is tens of sources. Determinism (byte-identical
regeneration) matters more than throughput.

**Constraints**: `@/` import pattern; no fallbacks/mock data outside tests (throw on missing —
the guardrail is itself a fail-loud); files 300–500 lines max; no `any`/`as`/`@ts-ignore`; no
git hooks. Deterministic serialization (fixed field order) for every generated artifact.

**Scale/Scope**: one source group today (`PB-P004`) with ~5 prospective members; the model must
not forbid additional groups. One level of grouping (collection-of-collections out of scope).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an **unratified template**
(placeholder principles). In its absence the governing rules are the repo + user CLAUDE.md
guidelines, checked here:

| Principle (CLAUDE.md) | Compliance |
|-----------------------|-----------|
| No fallbacks / mock data outside tests; throw on missing | PASS — the guardrail is a deliberate loud throw; validators fail loud. |
| `@/` import pattern | PASS — all new/edited modules use `@/…`. |
| Avoid class inheritance; interface-first + DI | PASS — Source stays a plain interface; validation is pure functions. |
| No `any` / `as` / `@ts-ignore` | PASS — `kind` union widened by one literal; `partOf` is `string?`. |
| Files 300–500 lines | PASS — changes are additive edits to existing sub-500-line modules; new checks split into `validate-checks.ts`. |
| No new representation beyond SSOT | PASS — groups + member stubs are ordinary Source records; no parallel discovered/ store (spec Clarification). |
| Determinism | PASS — serialization extends the fixed-field-order pattern to `partOf`/group rows. |

**Gate result: PASS** (no unjustified violations; no new dependency).

**Post-Phase-1 re-check: PASS** — the data model adds one kind literal + one optional edge
field and pure validation checks; no class hierarchy, no `any`, no new persisted representation.

## Project Structure

### Documentation (this feature)

```text
specs/005-source-groups/
├── plan.md              # This file
├── research.md          # Phase 0 output — the 3 design decisions below
├── data-model.md        # Phase 1 output — Source-group + member + status vocab
├── quickstart.md        # Phase 1 output — validate + guardrail + migration walkthrough
├── contracts/           # Phase 1 output
│   ├── source-group-record.md   # SSOT shape for a group + member stub
│   ├── validation.md            # group/member split findings
│   └── fetch-guardrail.md       # refuse-to-fetch contract (TASK-3)
├── checklists/
│   └── requirements.md  # from /speckit-specify + /speckit-clarify (16/16)
└── tasks.md             # /speckit-tasks output (NOT created here)
```

### Source Code (repository root)

```text
src/
├── model/
│   ├── source.ts              # EDIT: kind += 'source-group'; add optional partOf?: string edge
│   └── index.ts               # re-export unchanged (Source already exported)
├── bibliography/
│   ├── vocab.ts               # EDIT: STATUS_VALUES += 'discovered', 'approved-for-acquisition'
│   ├── load-fields.ts         # EDIT: parse/narrow the new kind + partOf field
│   ├── validate.ts            # EDIT: wire the new group/member split check into validate()
│   ├── validate-checks.ts     # EDIT/NEW: validateSourceGroups() — the split + dangling part_of + non-group-has-members
│   ├── model.ts               # EDIT: derivation tolerates source-group (no repositoryRecords)
│   ├── regenerate.ts          # EDIT: CSV/view rows for a source-group (no repository record)
│   └── migrate.ts             # EDIT/NEW: PB-P004 monograph→source-group migration (idempotent)
├── cli/
│   └── fetch-source.ts        # EDIT: guardrail — refuse source-group by canonical kind, informatively
└── archive/
    └── location.ts            # EDIT (minimal): sourceLayout stays authoritative for fetchable kinds;
                               #   the guardrail runs BEFORE it so a group never reaches the registry

tests/
├── unit/
│   ├── bibliography/{validate-checks,vocab,migrate}.test.ts   # group split, new statuses, PB-P004 migration
│   └── model/source.test.ts                                   # kind union + partOf
└── integration/
    └── source-groups.test.ts  # end-to-end: PB-P004 validates as group; fetch refuses informatively; regenerate clean
```

**Structure Decision**: Single-project layout (Option 1), extending the 004 modules in place.
No new module directory — source groups are a kind of Source, so the change lives in
`src/model/source.ts`, the `src/bibliography/` validation+vocab+migrate files, and the one
`src/cli/fetch-source.ts` guardrail seam. `src/archive/location.ts` is deliberately NOT extended
with a source-group layout: a group is never fetchable, so it has no archive layout, and the
guardrail intercepts before `sourceLayout` is consulted.

## Complexity Tracking

No constitution violations require justification. One decision carries residual risk and is
tracked in research.md R-001: the guardrail keys on the **SSOT canonical kind**, which means
`runFetchSource` must load the bibliography (or a lightweight kind lookup) rather than relying
solely on the `location.ts` layout registry. R-002 covers the empty-group derivation (a
source-group row in the CSV views with no repository record). R-003 covers the idempotent
`PB-P004` migration and where the dropped `to-collect` repository record's intent is preserved.

## Phase 0 → Phase 1 status

- Phase 0 research: see [research.md](./research.md) — R-001 guardrail seam (SSOT kind vs layout
  registry), R-002 empty-group view derivation, R-003 PB-P004 migration.
- Phase 1 design: see [data-model.md](./data-model.md), [contracts/](./contracts/),
  [quickstart.md](./quickstart.md).
- Agent context marker (`CLAUDE.md` SPECKIT block) points at this plan.
