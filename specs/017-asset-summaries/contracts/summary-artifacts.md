# Contract: Summary artifacts + provenance sidecar (FR-C3 resolution)

Resolves the FR-C3 storage-contract detail deferred from clarify. Uses the canonical archive
writer only (`storeAsset` → `writeProvenance`); no second serializer.

## File names (in the issue directory, alongside `issue.txt` / `issue.en.txt`)

| Artifact | Path | Sidecar (via `companionYamlPath`) |
|----------|------|-----------------------------------|
| Thorough (issue) | `issue.summary.long.en.md` | `issue.summary.long.en.md.yml` |
| Concise (issue)  | `issue.summary.short.en.md` | `issue.summary.short.en.md.yml` |
| Thorough (source rollup) | `source.summary.long.en.md` | `source.summary.long.en.md.yml` |
| Concise (source rollup)  | `source.summary.short.en.md` | `source.summary.short.en.md.yml` |

## Thorough artifact format

```markdown
---
topics: [colonial recruitment, emigration, Port-Breton]
people: [Marquis de Rays]
places: [Nouvelle-France, Port-Breton]
dates: ["1880", "1881-03"]
claims:
  - "The enterprise advertised free passage to settlers."   # recorded, not asserted
---

<narrative prose finding-aid: what the issue contains, section by section...>
```

## Concise artifact format

Plain markdown, ~1–3 sentences (~60–80 words), no frontmatter. Distilled from the thorough; no
claim absent from the thorough.

## Sidecar (extends `ProvenanceFields`, additive-optional)

```yaml
type: summary-thorough          # or summary-concise
format: text/markdown
language: English
engine: claude-code-cli
model: claude-sonnet-5
retrieved: 2026-07-21
interpretation: machine-generated-summary   # "interpretation, not evidence" label
input_layers:
  - path: issue.txt
    sha256: <hex>
  - path: issue.en.txt
    sha256: <hex>
input_quality:                 # optional; present when input OCR tier is low
  tier: low
  note: "source OCR low-confidence; summary may inherit errors"
object_store: null
# ...inherited rights/catalog fields derived from the source page companion...
```

Rollup sidecars additionally carry `covered_issues: [...]` / `missing_issues: [...]` (FR-009).

## Invariants (tested)

- Every artifact has a sidecar and a manifest entry (written atomically by `storeAsset`;
  Constitution XV — no orphan).
- `interpretation: machine-generated-summary` present on every summary sidecar (FR-006).
- `input_layers` non-empty and each sha matches the input companion at generation time (FR-005 +
  idempotency key).
- Unrelated existing records re-serialize byte-identically (additive-optional convention).
