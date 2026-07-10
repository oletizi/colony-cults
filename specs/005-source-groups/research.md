# Phase 0 Research: Source Groups

Three decisions the plan deferred. Each resolves a "how" the spec deliberately left open.

## R-001 — Where the fetch guardrail keys on `source-group` (the TASK-3 seam)

**Context.** Today `runFetchSource` (`src/cli/fetch-source.ts`) dispatches on
`sourceLayout(sourceId).kind`, where `sourceLayout` (`src/archive/location.ts`) reads a
**hardcoded** `SOURCE_LAYOUTS` registry containing only `PB-P001/PB-P002/PB-P003`. `PB-P004`
is absent, so `sourceLayout('PB-P004')` throws `no archive layout registered for source
"PB-P004"` — the opaque error the spec (US1) and backlog TASK-3 call out. There are two
`kind` fields: the SSOT `Source.kind` (`src/model/source.ts`) and the layout registry's
`SourceLayout.kind`.

**Decision.** The guardrail keys on the **SSOT canonical `Source.kind`**, not the layout
registry. `runFetchSource` loads the source's canonical record (via `loadAllSources` from
`@/bibliography/load`, or a focused kind lookup helper over it) and, when
`kind === 'source-group'`, throws a loud, informative error **before** `sourceLayout` is
consulted:

> `fetch-source: "PB-P004" is a Source Group — it has no archival object to fetch. Discover
> and inventory its members, then fetch the members.`

**Rationale.** (a) The SSOT is the authoritative source of truth for what a source *is*
(feature 004); the layout registry is authoritative only for *how a fetchable source is laid
out on disk*. A group is never fetchable, so it has no layout — putting it in `SOURCE_LAYOUTS`
would be a category error. (b) Keying on the SSOT kind satisfies FR-003 (key on kind, not
naming convention) directly. (c) Intercepting before `sourceLayout` converts the opaque
registry throw into the actionable message, which *is* the TASK-3 fix.

**Alternatives considered.**
- *Add a `source-group` entry to `SOURCE_LAYOUTS`.* Rejected — a group has no on-disk layout;
  this pollutes a fetchable-layout registry with a non-fetchable kind and still needs a
  refuse-branch downstream.
- *Leave the opaque `sourceLayout` throw and just improve its message.* Rejected — it would
  fire for any unregistered id, not specifically for groups; it cannot distinguish "a group,
  by design" from "you forgot to register this".

**Residual risk.** `runFetchSource` gains a dependency on the bibliography loader. Keep it a
narrow kind lookup so a fetch of an ordinary source does not pay a full-corpus load cost;
covered in the guardrail contract.

## R-002 — How a source-group appears in the derived CSV/views (empty group tolerated)

**Context.** The regeneration path (`src/bibliography/regenerate.ts`, `model.ts` derivation)
rolls repository records + assets into `sources.csv` and the acquisition tracker/register. A
source group has **no** repository records and may have **zero** members (FR-005), so the
existing per-repository-record row logic produces nothing for it.

**Decision.** A source group emits **one** row in the source-level view (`sources.csv`)
carrying its `sourceId`, titles, `kind: source-group`, and `case`, with the
repository/acquisition columns empty (it is not being acquired). It emits **no** row in the
acquisition tracker/register (there is nothing to acquire). Member stubs (ordinary Sources
with `part_of`) appear as their own source rows exactly like any other source, with their
`status` (`discovered` / `approved-for-acquisition` / …) shown.

**Rationale.** Keeps one row per Source in the source-level view (a group is a Source), while
correctly omitting groups from acquisition tracking. Derivation must therefore not *assume*
every source has ≥1 repository record — a small tolerance change, not a new code path.

**Alternatives considered.**
- *Omit groups from `sources.csv` entirely.* Rejected — the group is a real catalogued source;
  hiding it from the source view loses the very record the feature adds.
- *Synthesize a placeholder repository record for the group.* Rejected — contradicts FR-004/FR-005
  (a group holds no repository records) and would make it look acquirable.

## R-003 — PB-P004 migration shape (idempotent) and the dropped `to-collect` record

**Context.** `bibliography/sources/PB-P004.yml` is today `kind: monograph`, `creator: various`,
with a single `repositoryRecords: [{ sourceArchive: Gallica / BnF, status: to-collect }]`.
Migration must make it a valid source group without breaking regeneration/validation.

**Decision.** Rewrite `PB-P004.yml` to `kind: source-group`, **remove** the `repositoryRecords`
block (a group holds none), and keep `case: port-breton`, titles, and notes. The record becomes
a **zero-member group** initially (valid per FR-005); members are added as `part_of: PB-P004`
Source stubs with `status: discovered` as they are found (indictment / proceedings / sentencing
/ appeal / government report). The single dropped `to-collect` repository record carried no ARK
(nothing was collectable), so no acquisition state is lost — its intent ("this corpus is wanted,
go find it") is exactly what the group + discovery pipeline now expresses. The migration is
shipped as an **idempotent** step in `src/bibliography/migrate.ts` (re-running on an
already-migrated record is a no-op), matching the 004 migration pattern.

**Rationale.** Preserves identifier `PB-P004` and all descriptive metadata; the only removed data
is a placeholder repository record with no archival identity. Zero-member start is legitimate and
avoids inventing member ids before the members are actually discovered/verified.

**Alternatives considered.**
- *Convert the single `to-collect` record into the first member.* Rejected — it names no specific
  work (creator `various`, no ARK); it is the *corpus*, not a member. Fabricating a member from it
  would create an un-verifiable stub.
- *Keep the record and add `members` alongside.* Rejected — violates FR-005 (group holds no
  repository records); validation would reject it.

**Note on adjacent records.** Trial newspaper coverage stays in the `PB-N###` series (not a
PB-P004 member); candidate `ark:/12148/bpt6k5785971m` is recorded only as a
verification-pending candidate, never auto-promoted (FR-010) — these are cataloguing actions,
not part of the migration code.
