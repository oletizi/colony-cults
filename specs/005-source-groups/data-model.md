# Phase 1 Data Model: Source Groups

Extends the shipped canonical model (feature 004). Only the deltas are described here; the
Source / RepositoryRecord / Issue / Asset hierarchy is unchanged except as noted.

## Source (edited)

`src/model/source.ts` — `Source` gains one kind literal and one optional edge field.

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `kind` | `'periodical' \| 'monograph' \| 'source-group'` | **widened** | `source-group` marks a container of member Sources, never fetchable. |
| `partOf` | `string?` | **new** | The `sourceId` of the group this Source is a member of. Present only on members. Its presence does not change the member's own kind (a member is still a `monograph`/`periodical`). |
| `repositoryRecords` | `AuthoredRepositoryRecord[]?` | unchanged shape | MUST be absent/empty when `kind === 'source-group'` (validation-enforced). |

**Invariants (validation-enforced — see contracts/validation.md):**

1. `kind === 'source-group'` ⇒ no `repositoryRecords`, and the source is non-fetchable.
2. `kind === 'source-group'` ⇒ zero or more members; a **zero-member group is valid**
   (FR-005). Members are *not* listed on the group — they are derived (invariant 4).
3. `kind !== 'source-group'` ⇒ MUST NOT be referenced as a group; MUST NOT itself carry a
   member list (there is no member-list field on any kind — members express membership via
   `partOf`, so this is structurally impossible, but a `partOf` that points at a non-group is
   rejected — invariant 5).
4. **Group membership is derived from member `partOf` edges.** The group record holds no
   member list; a group's members = `{ s ∈ sources : s.partOf === group.sourceId }`. Single
   source of truth (Clarification: member carries `part_of`).
5. A member's `partOf` MUST resolve to an existing Source whose `kind === 'source-group'`.
   A dangling `partOf`, or a `partOf` pointing at a non-group source, is a validation error.

## Source Group (conceptual — a Source with `kind: 'source-group'`)

Not a separate type — a Source instance. Distinguishing properties:

- Identifier: an ordinary opaque `PB-###` id (e.g. `PB-P004`). Structure is NOT in the id.
- Holds: titles, `case`, `creator?`, `language?`, `notes?`. Holds **no** repository records.
- Members: derived; each member is a full Source with `partOf` set to this group's id.
- Lifecycle: a group itself is not "acquired"; its members move through the two linked status
  vocabularies below (Source lifecycle, then RepositoryRecord acquisition).

## Member (conceptual — a Source with `partOf` set)

- A full, independently-catalogued Source (its own opaque `PB-###` id) — becomes independently
  fetchable once it has a stable archival identity (ARK/DOI/ISBN/OCLC/repository id).
- `partOf` names exactly one group. Multi-group membership is out of scope (one level).
- Passes through its own Source lifecycle status (discovered → verified/approved, or excluded)
  and then, once a RepositoryRecord is authored for it, that record's separate acquisition status
  (wanted → … → archived) — see "Status vocabulary" below.

## Status vocabulary (edited — split into TWO linked state machines)

**Design-review update (2026-07-09):** the original design treated Source lifecycle and
RepositoryRecord acquisition as one flat 8-value `STATUS_VALUES` pipeline shared by both
entities. Review found this let an acquisition-only value (e.g. `archived`) be authored on a
`Source`, or a discovery-only value (e.g. `discovered`/`excluded`) be authored on a
`RepositoryRecord` — cross-domain values the type system and runtime validator should reject,
since a Source's lifecycle and a RepositoryRecord's acquisition status are genuinely different
state machines with different owners, different terminal states, and a one-way handoff between
them. `src/bibliography/vocab.ts` now defines two separate closed vocabularies instead:

```
Source lifecycle (SOURCE_LIFECYCLE_STATUS_VALUES):
  discovered ──verify+promote──> approved-for-acquisition ──handoff──┐
       └── verify rejects / out-of-scope ──> excluded (terminal)     │
                                                                      ▼
RepositoryRecord acquisition (REPOSITORY_ACQUISITION_STATUS_VALUES):
  wanted ──> to-collect ──> collecting ──> collected ──> archived
```

A Source's own lifecycle status (`SourceLifecycleStatus`, checked via `isSourceLifecycleStatus`)
tracks the candidate's position in Discover → Verify → Promote, and ENDS at
`approved-for-acquisition` (or terminates early at `excluded`). A RepositoryRecord's acquisition
status (`RepositoryAcquisitionStatus`, checked via the field-name-keyed `isAllowed('status', ...)`)
tracks a held copy's own Acquire → Preserve progress, and BEGINS at `wanted`/`to-collect` once a
RepositoryRecord is authored for an approved Source. The handoff between the two vocabularies is a
record-authoring event (a human/migration adds a `repositoryRecords` entry to a
`approved-for-acquisition` Source), not a validated state transition — there is no single field
that crosses both vocabularies.

| Value | Vocabulary | Meaning |
|-------|------------|---------|
| `discovered` | Source lifecycle | A candidate member found during Discover/Inventory; not yet verified/approved. |
| `approved-for-acquisition` | Source lifecycle | Verified and promoted; cleared for a RepositoryRecord to be authored. Terminal for the Source lifecycle. |
| `excluded` | Source lifecycle | A discovered candidate intentionally NOT promoted (duplicate / irrelevant / incomplete / superseded / out-of-scope). Retained in the SSOT; the reason lives in the record's `notes`. Terminal. |
| `wanted`, `to-collect`, `collecting`, `collected`, `archived` | RepositoryRecord acquisition | Unchanged existing acquisition/preservation states — now a self-contained vocabulary of their own, no longer sharing a tuple with the Source lifecycle values. |

All previously-valid RepositoryRecord acquisition status values continue to validate unchanged on
a RepositoryRecord (FR-008). **Cross-domain values are rejected**: a Source authored with
`status: archived` (or any acquisition-only value) fails loud at load with a cross-domain error; a
RepositoryRecord authored with `status: discovered`/`excluded`/`approved-for-acquisition` is
reported as a `vocab` validation finding.

## State transitions (member lifecycle)

```
(new candidate)
   └─> discovered ──verify+promote──> approved-for-acquisition ──(RepositoryRecord authored)──> wanted / to-collect
          │                                                                                            └─> collecting ─> collected ─> archived
          └── verify rejects / out-of-scope ──> excluded  (terminal; reason in notes; record retained)
```

- Backward transitions within the Source lifecycle vocabulary (e.g. `approved-for-acquisition` →
  `discovered` on a failed verification) are permitted; no ordering is *enforced* by validation
  within either vocabulary (status is a label, not a state machine) — consistent with the existing
  model, which does not enforce status order. What IS enforced is membership: a value must belong
  to the vocabulary of the entity it is authored on.

## Derived views impact (regenerate)

- `sources.csv`: one row per Source, including a source-group row (repository/acquisition
  columns empty) and member-stub rows (with their status).
- acquisition tracker/register: **no** row for a source group (nothing to acquire). Member stubs
  appear once they carry an acquisition status.
- Derivation must not assume every Source has ≥1 repository record (R-002).

## Migration (PB-P004)

Per R-003: `PB-P004.yml` → `kind: source-group`, drop `repositoryRecords`, keep everything else;
starts as a zero-member group. Idempotent `migrate.ts` step. No acquisition state lost (the
dropped record had no ARK).
