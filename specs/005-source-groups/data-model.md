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
- Lifecycle: a group itself is not "acquired"; its members move through the status pipeline.

## Member (conceptual — a Source with `partOf` set)

- A full, independently-catalogued Source (its own opaque `PB-###` id) — becomes independently
  fetchable once it has a stable archival identity (ARK/DOI/ISBN/OCLC/repository id).
- `partOf` names exactly one group. Multi-group membership is out of scope (one level).
- Passes through the status pipeline (below) as it is discovered → verified → acquired.

## Status vocabulary (edited)

`src/bibliography/vocab.ts` — `STATUS_VALUES` gains three values: two prepended to the
acquisition lifecycle so the full pipeline is ordered, plus `excluded` as an off-pipeline
terminal state:

```
discovered → approved-for-acquisition → wanted → to-collect → collecting → collected → archived
     └──────────────> excluded  (intentional exclusion; reason in notes)
```

| Value | Change | Meaning |
|-------|--------|---------|
| `discovered` | **new** | A candidate member found during Discover/Inventory; not yet verified/approved. |
| `approved-for-acquisition` | **new** | Verified and promoted; cleared to enter the existing acquisition flow. |
| `excluded` | **new** | A discovered candidate intentionally NOT promoted (duplicate / irrelevant / incomplete / superseded / out-of-scope). Retained in the SSOT; the reason lives in the record's `notes`. Preserves discovery history without a separate store. |
| `wanted`, `to-collect`, `collecting`, `collected`, `archived` | unchanged | Existing acquisition/preservation states. |

All previously-valid status values continue to validate unchanged (FR-008). The three new values
are valid on any Source but are meaningful primarily on member stubs of a group.

## State transitions (member lifecycle)

```
(new candidate)
   └─> discovered ──verify+promote──> approved-for-acquisition ──> wanted / to-collect
          │                                                             └─> collecting ─> collected ─> archived
          └── verify rejects / out-of-scope ──> excluded  (terminal; reason in notes; record retained)
```

- Backward transitions (e.g. `approved-for-acquisition` → `discovered` on a failed verification)
  are permitted by the vocabulary; no ordering is *enforced* by validation (status is a label,
  not a state machine) — consistent with the existing model, which does not enforce status order.

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
