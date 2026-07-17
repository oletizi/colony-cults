# Contract: CLI surface (`bib` verbs)

Extends the shipped `bib` source-group verbs (`src/cli/bib-sourcegroup.ts`). No parallel museum command (design architecture C rejected).

## `bib inventory` (extended)

```
bib inventory <locator> --group <sourceGroupId> --repository <name> [--kind archival-item] [--dry-run]
```

- `--repository <name>` (**required when the locator is a raw URL/accession**, i.e. non-ARK): names the adapter (`new-italy-museum`). For an ARK locator the repository is unambiguous. The registry returns exactly one adapter or fails loud (INV-D).
- Resolves via `adapter.resolve(locator)`; creates a member Source (`partOf` the group, `status: discovered`), defaulting `kind: archival-item` for museum items. Fails loud on an unverifiable locator (no fabricated id).

## `bib rights-assess` (new)

```
bib rights-assess <sourceId> [--archive <root>]
```

- Runs `adapter.collectRightsEvidence`, surfaces the grounded evidence (excerpt, date + its model `interpretation`, credit), and requires the operator to **confirm the date's interpretation/meaning** (not just its presence) before it contributes to the judgment. On confirmation writes `rights.{rightsRaw,rightsStatus,rightsBasis,rightsJurisdiction,assessedBy:operator,assessedAt}` to the RepositoryRecord. Never auto-clears rights.

## `bib acquire` (cut over)

```
bib acquire <sourceId> --object-store [--dry-run] [--checkpoint] [--checkpoint-every <N>]
```

- Selects the RepositoryRecord, **dispatches the adapter deterministically by its copy-identifier type** (`ark`→Gallica, `accession`→museum), enforces `rights.rightsStatus === 'public-domain'`, then `adapter.acquire(record, ...)`. Convergent/idempotent (INV-E). Returns the typed `AcquisitionResult`. No ARK-only assumption remains.

## `bib verify-member` / `bib promote` (unchanged)

Museum items are group members (`partOf → PB-P006`); the existing group-member verify/promote path applies with no change (FR-017).

## `bib coverage` (extended render)

- Renders each suspected lead's `resolution.status` distinctly (resolved ≠ open); renders the discriminated `knownExtent` state (`measured`/`unexamined`/`irreducible`) with basis; a bare `unknown` never appears (it fails loud at load).

## `bib reconcile` (unchanged)

Advances the RepositoryRecord acquisition status from the acquire result / object-store presence.
