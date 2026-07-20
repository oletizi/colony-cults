# Contract: `bib` CLI verbs

New verb group beside the existing `gallica` verbs (`src/cli/bibliography.ts`, wired through `src/index.ts`). Text in / text out; errors → stderr; non-zero exit on validation findings (matches the repo's fail-loud posture).

| Verb | Input | Output | Exit | Failure |
|------|-------|--------|------|---------|
| `bib validate` | reads SSOT + provenance | findings report (human; `--json` for machine) | `0` clean, `1` findings, `2` malformed input | throws (→ stderr, exit 2) on unreadable/malformed SSOT; findings (orphans, leaks, vocab, drift) → exit 1 |
| `bib regenerate` | reads SSOT + provenance | writes the 4 derived views | `0` written, `2` malformed | `--check` writes nothing and exits `1` if any view would change (drift), `0` if in sync |
| `bib show <sourceId>` | SSOT + derived roll-up | the canonical model for one source (human; `--json`) | `0`, `1` unknown id, `2` malformed | unknown `sourceId` → fail loud (message → stderr, **exit `1`**, no default); exit `2` reserved for unreadable/malformed SSOT |
| `bib migrate` | reads the 5 legacy representations | writes initial `bibliography/sources/PB-###.yml` (SSOT only; derived views are produced separately by `bib regenerate`) | `0`, `2` on conflict | idempotent; re-run yields no change; explicitly restores PB-P001 SLQ record |

## `bib validate` finding shape (`--json`)

```json
{
  "ok": false,
  "findings": [
    { "kind": "orphan-asset", "sourceId": "PB-P001", "detail": "asset f003.jpg resolves to no repository record", "path": "…" },
    { "kind": "identifier-leak", "sourceId": "PB-P002", "detail": "copy-level 'ark' present on Source", "identifier": "ark:/…" },
    { "kind": "vocab", "field": "status", "value": "acquired", "detail": "not in closed set" },
    { "kind": "view-drift", "view": "bibliography/sources.csv", "detail": "committed view differs from regeneration" }
  ]
}
```

Each finding MUST name the offending entity/identifier and a locating path (SC-002/SC-007).

## Determinism

`bib regenerate` and `bib validate --check` MUST produce byte-identical output for identical inputs (FR-015). Achieved by fixed field/column order (documented per view in `regenerate.ts`), reusing the `provenance.ts` single-line-scalar serialization discipline.
