# Bibliography — SSOT + coverage audit

The bibliography is the single source of truth for the corpus. Every fact is
authored once, on the node that owns its evidence. Audit views are **generated**
and never committed.

## Authored (committed) files

- `sources/<sourceId>.yml` — one canonical `Source` per work (+ its held copies).
- `search-log.yml` — append-only repository search history (see the header in that
  file for the entry shape).

## Coverage & discovery fields (all optional, additive)

On a `Source`:

- `evidenceClass` — genre / evidence class (`book`, `pamphlet`, `prospectus`,
  `newspaper`, `trial-record`, `gov-report`, `map`, …), orthogonal to `kind`.
  Validated against a closed-but-extensible vocabulary.
- `references[]` — citations mined from this source: `citedAs` (required),
  `citedKind?` (validated vocab), `basis?` (free-form prose), `resolvedTo?`
  (a `sourceId`, set once the cited work is identified), `notes?`. A reference
  without `resolvedTo` is *referenced-but-unidentified*.

On a source-group (`kind: source-group`) only:

- `knownMemberCount` — believed total extent (a non-negative integer or the literal
  `unknown`); the denominator, distinct from the derived actual member count.
- `suspected[]` — inferred, uncited gaps: `description`, `basis` (free-form, why
  inferred), `evidenceClass?`, `notes?`. A gap grounded in a direct citation
  belongs in that source's `references[]`, not here.

## Generated views (stdout only — never committed)

```
gallica bib coverage          # human-readable report
gallica bib coverage --json   # machine-readable
```

The coverage report derives, per campaign: member counts by lifecycle state,
`knownMemberCount` vs. actual (gap as a number **or** the literal `unknown`);
the corpus-wide evidence-class distribution; the unresolved-references register
(unresolved `references[]` + `suspected[]`, grouped by campaign, with a
`[no campaign]` bucket for standalone sources); and the repository × campaign
search-history matrix plus a repository-axis rollup. Counts are per **work**
(a source held at multiple archives counts once). There is deliberately **no
headline coverage percentage** — unknowns are shown as `unknown`.

Every derived view is completely regenerable from the committed source data, so
no snapshot is ever committed. `bib validate` checks the authored fields
(vocabularies, `resolvedTo` referential integrity, group-only fields,
`knownMemberCount` shape, and search-log id uniqueness / required fields).
