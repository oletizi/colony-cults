# Contract: Validation (`bibliography/validate.ts`)

Pure function over the derived `CanonicalModel` + on-disk views. Returns `ValidationFinding[]`; **throws only** for unreadable/malformed input (exit 2), never for content findings (exit 1). No `zod` (R-003).

## Checks

| Check | Rule | Requirement | Finding kind |
|-------|------|-------------|--------------|
| Referential integrity — assets | every Asset resolves to a Repository Record | FR-017 | `orphan-asset` |
| Referential integrity — records | every Repository Record resolves to a Source | FR-017 | `orphan-record` |
| Identifier leak | no copy-level id on a Source; no work-level id on a Repository Record | FR-018/FR-009 | `identifier-leak` |
| Vocabulary | `status`/`rights`/`provider`/`ocr_status` ∈ closed set | FR-019 | `vocab` |
| Required core | `sourceId`, `titles[0]`, `kind`; per-copy `sourceArchive`+`status` present | FR-019 | `missing-required` |
| Uniqueness | `(sourceId, sourceArchive)` unique | data-model | `duplicate-copy` |
| Manifest-not-checksum | a copy references a manifest/asset-set, not a scalar checksum | FR-006 | `single-checksum` |
| View drift | each committed view equals its regeneration | FR-015/SC-008 | `view-drift` |

## `ValidationFinding`

```ts
interface ValidationFinding {
  kind: 'orphan-asset' | 'orphan-record' | 'identifier-leak' | 'vocab'
      | 'missing-required' | 'duplicate-copy' | 'single-checksum' | 'view-drift';
  sourceId?: string;
  detail: string;           // human message naming the offending entity
  path?: string;            // locating path (file / asset) where applicable
  identifier?: string;      // for identifier-leak
}
```

## Guarantees (map to Success Criteria)

- Seeded orphan (asset with no record; record with no source) → reported (SC-007).
- Seeded leak (copy-level id on Source) → reported and named (SC-002/SC-007).
- Fully consistent dataset → `findings: []`, `ok: true` (SC-007, no false positives).
- Hand-edited committed view → `view-drift` finding (SC-008).
