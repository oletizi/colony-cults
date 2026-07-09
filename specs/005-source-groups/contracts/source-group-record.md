# Contract: Source-group & member SSOT record shape

The SSOT is `bibliography/sources/PB-###.yml` (one file per Source). This contract adds the
`source-group` kind and the `partOf` member edge. Field order for deterministic serialization
follows the existing 004 order, with `partOf` placed immediately after `kind`.

## A source group

```yaml
sourceId: PB-P004
kind: source-group          # NEW literal
case: port-breton
language: French
creator: various
titles:
  - text: French trial and legal proceedings relating to the Marquis de Rays
    role: canonical
notes: "Years: 1880s | ... Core source for the fraud prosecution and official findings."
# NO repositoryRecords block — a source group holds none.
# NO members list — members are derived from member-side `partOf` edges.
```

Rules:
- `kind: source-group` is REQUIRED to mark a group.
- `repositoryRecords:` MUST be absent (or empty). Presence ⇒ validation error `group-has-repository-records`.
- A group with no member files yet is VALID (zero-member group, FR-005).

## A member stub (discovered, not yet acquirable)

```yaml
sourceId: PB-P037           # own opaque id — NOT PB-P004-001
kind: monograph             # a member is a real Source of its own kind
partOf: PB-P004             # NEW edge — names exactly one source-group
case: port-breton
titles:
  - text: Acte d'accusation contre le Marquis de Rays
    role: canonical
status: discovered          # NEW status; matures to approved-for-acquisition → to-collect → ...
notes: "Candidate — ARK pending verification."
# repositoryRecords added once the member has a real archival copy to acquire.
```

Rules:
- `partOf` MUST resolve to an existing Source with `kind: source-group`. Otherwise validation
  error `dangling-part-of` (target missing) or `part-of-not-a-group` (target is not a group).
- A member is an ordinary Source: it MAY carry `repositoryRecords` once it has a stable archival
  identity, at which point it is independently fetchable.
- `status: discovered` / `approved-for-acquisition` are valid vocab values (see validation.md).
- Member id is opaque (`PB-###`), never a hierarchical `PB-P004-001` (FR-007).

## Serialization determinism

- Fixed field order (hand-serialized, per `provenance.ts` pattern); `partOf` serialized directly
  after `kind` when present, omitted entirely when absent.
- Regeneration of derived views is byte-reproducible with source-group and member rows present.
