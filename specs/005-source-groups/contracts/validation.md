# Contract: Source-group validation findings

New checks added to `src/bibliography/validate.ts` (wired into `validate()`) and implemented in
`src/bibliography/validate-checks.ts` as `validateSourceGroups(model): ValidationFinding[]`.
Each finding reuses the existing `ValidationFinding` shape (`kind`, message, offending id).

## New finding kinds (added to `ValidationFindingKind`)

| Finding kind | Trigger | Message (shape) |
|--------------|---------|-----------------|
| `group-has-repository-records` | A Source with `kind: source-group` carries ≥1 repository record | `source group "<id>" must not hold repository records` |
| `non-group-has-part-of-member` | (structural) a non-group source is referenced as a member's group target | covered by `part-of-not-a-group` below |
| `dangling-part-of` | A member's `partOf` names a `sourceId` that does not exist | `member "<id>" has part_of "<target>" but no such source exists` |
| `part-of-not-a-group` | A member's `partOf` names an existing source whose `kind !== 'source-group'` | `member "<id>" has part_of "<target>", which is not a source group (kind: <k>)` |

Notes:
- **Zero-member group is NOT a finding** (FR-005) — validation never flags a group for having no
  members.
- **Non-group holding members** is structurally impossible (no member-list field), so it needs no
  check; membership is only ever asserted member-side via `partOf`, and `part-of-not-a-group`
  guards the inverse.

## Interaction with existing checks

- **Identifier-leak / vocab / uniqueness / required-core** checks run unchanged over group and
  member records (a group is a Source; a member is a Source).
- **View-drift** check: regenerated views must include the source-group row and member rows;
  drift detection compares byte-for-byte, so regeneration (R-002) must emit them deterministically.
- A source group is exempt from any "must have a repository record to be acquirable" expectation —
  there is no such existing check, and none is added (a group is intentionally non-acquirable).

## `validate()` wiring

`validate(model, opts)` appends `validateSourceGroups(model)` to its findings list alongside the
existing leak/view-drift checks. Order is not significant (findings are aggregated). A clean model
(valid PB-P004 group + any members) yields zero source-group findings.
