# Phase 1 Data Model: Corpus Config Seam

New config layer + narrow policies. Existing SSOT types reused unchanged **(reused)**. Revised after the spec review (capability + override + browser-profile + collision modeling).

## CorpusManifest (new — `corpora/<id>.yml`)

`basename == id`. Data, versioned.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` (discriminant) | loader rejects unsupported versions |
| `id` | string | == filename basename; unique across the repository |
| `cases` | `string[]` | ≥1; grammar `^[a-z][a-z0-9-]*$`; unique within + across manifests |
| `sourceIds` | `{ prefix: string; padWidth: number }` | prefix grammar `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-$` (ends in delimiter); `1 ≤ padWidth ≤ 8` |
| `requiredCapabilities` | `{ repositories: string[]; sourceQueries: string[] }` | **names** of installed capabilities the corpus depends on (Model A); orthogonal to the registries |
| `archiveLayoutOverrides` | `{ [SourceId]: { relativePath, reason } } | null` | default `null`; used ONLY where generic layout differs from characterized legacy output |

Port Breton instance:
```yaml
schemaVersion: 1
id: port-breton
cases: [port-breton]
sourceIds: { prefix: PB-P, padWidth: 3 }
requiredCapabilities:
  repositories: [gallica, new-italy-museum, internet-archive, papers-past]
  sourceQueries: [papers-past]
archiveLayoutOverrides: null   # pending the characterization gate
```
No `discoveryMechanism` / `dateNormalizer` (spec 2).

## BrowserProfile (new — `corpora/<id>.browser.yml`)

Deployment defaults, one conventional profile per corpus (separate from identity).

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | |
| `id` | string | unique across profiles |
| `corpus` | string | must reference a known corpus |
| `defaultSources` | `string[]` | `CORPUS_SOURCES` env overrides |

Absence is valid for non-browser commands; required only by browser-deploy / browser-default-consuming commands.

## Narrow per-seam policies (new — derived at the composition root; immutable)

| Policy | Shape | Consumer |
|---|---|---|
| `ScopeResolutionContext` | `{ validCaseIds: ReadonlySet<string>, …existing }` | `bibliography/scope.ts` |
| `SourceIdPolicy` | `{ prefix: string; padWidth: number }` | `sourcegroup/id-alloc.ts` |
| `ArchiveLayoutPolicy` | generic derivation + `overrides: ReadonlyMap<SourceId, { relativePath, reason }>` | `archive/location.ts` |
| `BrowserProfile` | `{ corpus; defaultSources: ReadonlyArray<string> }` | `browser/config.ts` (deployment) |

## SelectedCorpus (new — composition-root value)

Resolved once (`--corpus` → `COLONY_CORPUS` → fail loud). Not injected whole; used to derive the narrow policies + validated at startup.

## Validation rules (the config gate — strict policy)

**Per manifest**: supported schema version; corpus-id validity + `basename==id`; ≥1 case; case-id grammar + within-manifest uniqueness; source-ID prefix grammar; `padWidth ∈ 1..8`.
**Repository-wide (ALL committed manifests)**: unique corpus ids; **prefix disjointness** — no configured prefix equals or is a leading substring of another; unique case ids; browser-profile `corpus` references a known corpus + unique profile ids; archive-override references a known Source in a Case of that corpus, relative path, no archive-root escape, no two Sources to one location, every override has a `reason`.
**Existing-data**: every existing Source ID globally unique; every Source under a Corpus conforms to its ID policy (unless grandfathered); the next allocated ID cannot collide with any existing ID or another Corpus's namespace.
**At selection**: selected corpus exists; `requiredCapabilities` ⊆ installed capabilities.
**Policy**: every committed manifest MUST validate before ANY corpus runs (drafts live outside `corpora/`).

## Reused (unchanged)

- **Source** (`case` exactly one; `sourceId` opaque, globally unique), **RepositoryRecord**, **RepositoryAdapterRegistry**, **SourceQueryRegistry**, coverage/search-log.

## Invariants

- Source IDs **globally unique** via **disjoint prefix namespaces** + existing-data validation.
- Case IDs unique across the repository; grammar-constrained.
- Corpus + BrowserProfile are **data**, never executable; selection explicit, never case-derived.
- **No omnibus corpus object** through core modules — only narrow, **immutable** policies.
- **Byte-identical** legacy archive paths (characterization gate); an override is exceptional, validated, and carries a reason.
- The corpus **names** required capabilities but never owns the registry.
