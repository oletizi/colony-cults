# Contract: authored YAML field shapes

The hand-authored SSOT shapes this feature adds. All fields are optional/additive; existing
files load unchanged.

## `Source` (in `bibliography/sources/<sourceId>.yml`) — evidence class + references

```yaml
sourceId: PB-P007
kind: monograph
partOf: PB-P004
# ... existing fields ...
evidenceClass: pamphlet            # optional; must be in EVIDENCE_CLASS_VALUES
references:                        # optional; citations mined from THIS source
  - citedAs: "la Nouvelle France"  # required
    citedKind: journal             # optional; must be in CITED_KIND_VALUES
    basis: explicit-citation       # optional; FREE-FORM prose (not validated)
    # resolvedTo omitted -> referenced-but-unidentified
    notes: "titled as an extract from this journal"
  - citedAs: "Prospectus de la Nouvelle-France"
    citedKind: pamphlet
    basis: "advertised in the colony's promotional matter"
    resolvedTo: PB-P012            # optional; MUST resolve to an existing sourceId
```

## Source-group (`kind: source-group`) — believed extent + suspected gaps

```yaml
sourceId: PB-P004
kind: source-group
# ... existing fields ...
knownMemberCount: unknown          # optional; non-negative integer OR the literal 'unknown'
                                   #   (group-only; on a non-group source => fail loud)
suspected:                         # optional; inferred, uncited gaps (group-only)
  - description: "appeal-court records for the de Rays trial"
    basis: "trial testimony references an appeal not yet located"   # required, FREE-FORM
    evidenceClass: trial-record    # optional
    notes: "not available online as of last search"
```

## `bibliography/search-log.yml` — append-only search history

```yaml
# append-only, date-ordered; ids unique and stable
- id: SRCH-0001                    # required; stable flat-opaque; UNIQUE across the file
  date: 2026-07-03                 # required; ISO date
  repository: State Library of Queensland   # required
  campaign: PB-P004                # required; a source-group sourceId
  scope: "de Rays trial records, 1880s"     # required
  coverage: "catalogue searched; 2 hits, both already held"   # required
  remainingQuestions:              # optional
    - "appeal-court records not online"
  notes: "revisit after digitisation project completes"       # optional
- id: SRCH-0002
  date: 2026-07-05
  repository: Gallica / BnF
  campaign: PB-P004
  scope: "Marquis de Rays pamphlets"
  coverage: "OAI search; 1 new candidate inventoried (PB-P007)"
```

## Validation summary (fail-loud)

| Field | Rule |
|-------|------|
| `evidenceClass` | ∈ `EVIDENCE_CLASS_VALUES` |
| `references[].citedKind` | ∈ `CITED_KIND_VALUES` (when present) |
| `references[].resolvedTo` | resolves to an existing `sourceId` |
| `references[].basis`, `suspected[].basis` | free-form; NOT validated |
| `knownMemberCount`, `suspected` | only on `kind: source-group`; count is int≥0 or `'unknown'` |
| `search-log.yml` `id` | unique across file; entry has required fields |
