# Phase 1 Data Model: Corpus Config Seam

New config layer + narrow policies. Existing SSOT types (`Source`, `RepositoryRecord`, registries) are reused unchanged and noted **(reused)**.

## CorpusManifest (new — `corpora/<id>.yml`)

The selected canonical dataset + configuration boundary. Data, versioned.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` (discriminant) | typed loader rejects unsupported versions |
| `id` | string | unique across the repository (validator) |
| `cases` | `string[]` | ≥1; each unique within the manifest and across the repository |
| `sourceIds` | `{ prefix: string; padWidth: number }` | prefix unique across the repository; padWidth positive + bounded |

Spec-1 minimal shape. **No** `discoveryMechanism` / `dateNormalizer` (spec 2). Port Breton instance:
```yaml
schemaVersion: 1
id: port-breton
cases: [port-breton]
sourceIds: { prefix: PB-P, padWidth: 3 }
```

## Narrow per-seam policies (new — derived at the composition root)

Each hotspot consumes only its narrow interface; none receives the whole manifest.

| Policy | Shape | Consumer |
|---|---|---|
| `ScopeResolutionContext` | `{ validCaseIds: ReadonlySet<string>, …existing }` | `bibliography/scope.ts` (replaces `PORT_BRETON_CASE_ID`) |
| `SourceIdPolicy` | `{ prefix: string; padWidth: number }` | `sourcegroup/id-alloc.ts` (replaces module constants) |
| `ArchiveLayoutPolicy` | generic derivation + `overrides?: Map<SourceId, LayoutOverride>` | `archive/location.ts` (replaces `SOURCE_LAYOUTS`) |
| `BrowserProfile` | `{ corpus: string; defaultSources: string[] }` | `browser/config.ts` (replaces default list) — **deployment, not identity** |

## SelectedCorpus (new — composition-root value)

Resolved once from `--corpus` → `COLONY_CORPUS` → fail loud. Not injected as a whole; used to derive the narrow policies above and validated at startup.

## Validation rules (new — the config gate)

Per manifest: supported `schemaVersion`; valid corpus id syntax; ≥1 case; unique case ids within the manifest; valid source-ID prefix; positive bounded pad width.
Repository-wide (across ALL manifests): unique corpus ids; **unique source-ID prefixes**; **unique case ids**; no prefix that creates ambiguity with existing IDs.
At selection: the selected corpus exists; its referenced repositories ⊆ installed capabilities.

## Reused (unchanged)

- **Source** — `case` (exactly one), `sourceId` (opaque, globally unique).
- **RepositoryRecord**, **RepositoryAdapterRegistry**, **SourceQueryRegistry** — installed capabilities; the corpus references a subset, never owns them.
- **Coverage / search-log** — projections; consume `validCaseIds` transitively via scope.

## Invariants

- **Source IDs globally unique** across all corpora (unique prefixes; validator-enforced) — bare references stay unambiguous.
- **Case IDs unique** across the repository.
- **A corpus is data**, never executable config; **selection is explicit**, never derived from a case.
- **No omnibus corpus object** flows through core modules — only narrow policies.
- **Byte-identical** legacy archive paths (characterization gate); an override is exceptional + validated.
