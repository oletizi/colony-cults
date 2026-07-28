# Phase 1 Data Model: Corpus Config Seam

New config layer + narrow policies. Existing SSOT types reused unchanged **(reused)**. Revised after the spec review (capability + override + browser-profile + collision modeling).

## CorpusManifest (new — `<corporaRoot>/<id>.yml`; production `corpora/<id>.yml`)

`basename == id`. Data, versioned.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` (discriminant) | loader rejects unsupported versions |
| `id` | string | == filename basename; unique across the repository |
| `cases` | `string[]` | ≥1; grammar `^[a-z][a-z0-9-]*$`; unique within + across manifests |
| `sourceIds` | `{ prefix: string; padWidth: number; allocatable: boolean }[]` | **non-empty list**; exactly ONE entry with `allocatable: true` (FR-002b). Prefix grammar `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$` — **no trailing delimiter** (Port Breton ships `PB-P` + pad 3 → `PB-P007`); `1 ≤ padWidth ≤ 8`; disjointness is compared across ALL policies of ALL corpora via the leading-substring rule (FR-002a) |
| `requiredCapabilities` | `{ repositories: string[]; sourceQueries: string[] }` | **names** of installed capabilities the corpus depends on (Model A); orthogonal to the registries |
| `archiveLayoutOverrides` | `{ [SourceId]: { relativePath, reason } } | null` | default `null`; used ONLY where generic layout differs from characterized legacy output |

Port Breton instance:
```yaml
schemaVersion: 1
id: port-breton
cases: [port-breton]
sourceIds:
  - { prefix: PB-P, padWidth: 3, allocatable: true }    # 92 primary sources, machine-allocated
  - { prefix: PB-S, padWidth: 3, allocatable: false }   # PB-S001/PB-S002, hand-authored secondary works
requiredCapabilities:
  repositories: [gallica, new-italy-museum, internet-archive, papers-past]
  sourceQueries: [papers-past, papers-past-article]
archiveLayoutOverrides: null   # pending the characterization gate
```
`sourceQueries` names **both** registered SourceConfigs the corpus actually exercises — verified: `papers-past-article` is referenced by `metadataSnapshot.path` in 32 committed Source records, and the search-log records both against `scope: {kind: case, id: port-breton}`. `requiredCapabilities` names what the corpus *depends on*, not just its discovery entry point.
Two policies because the corpus genuinely carries two namespaces (verified against the SSOT: 92 `PB-P###` + 2 `PB-S###`, all `case: port-breton`). `PB-P` and `PB-S` are disjoint under the leading-substring rule. Only `PB-P` is allocatable — `src/sourcegroup/id-alloc.ts` allocates nowhere else.
No `discoveryMechanism` / `dateNormalizer` (spec 2).

## BrowserProfile (new — `<corporaRoot>/<id>.browser.yml`)

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
| `SourceIdPolicy` | `{ prefix: string; padWidth: number }` — **singular**, derived from the corpus's ONE `allocatable: true` policy (FR-002b), so the allocation seam is unchanged | `sourcegroup/id-alloc.ts` |
| `ArchiveLayoutPolicy` | `overrides: ReadonlyMap<SourceId, { relativePath, reason }>` + `derived: ReadonlyMap<SourceId, SourceLayout>` (**precomputed** at construction — see below) | `archive/location.ts` |
| `BrowserProfile` | `{ corpus; defaultSources: ReadonlyArray<string> }` | `browser/config.ts` (deployment) |

## SelectedCorpus (new — composition-root value)

Resolved once (`--corpus` → `COLONY_CORPUS` → fail loud). Not injected whole; used to derive the narrow policies + validated at startup.

## `corporaRoot` (new — composition-root input, FR-016)

The directory holding **both** manifests and browser profiles, under **one convention**:

| Artifact | Path |
|---|---|
| manifest | `<corporaRoot>/<id>.yml` |
| browser profile | `<corporaRoot>/<id>.browser.yml` |

Resolved **once** at the composition root and injected — `<repoRoot>/corpora` in production, `tests/fixtures/corpora` under test. **Never a literal in a core module**: a hardcoded root makes SC-003 unsatisfiable, because adding a fixture corpus would then require a core edit. The loader/validator take it (plus `sourcesDir`, for existing-data validation) as parameters.

## Archive-layout resolution order (FR-017)

`sourceLayout(sourceId)` resolves in this **total** order:

1. manifest `archiveLayoutOverrides` (validated, carries a `reason`)
2. **runtime overlay** — `registerSourceLayout`, for source-group members created mid-run by `bib inventory` (semantics unchanged, including fail-loud conflict detection)
3. **precomputed generic derivation** (`derived`, built at policy construction)
4. **throw** — no default (Principle V)

**Binding constraint**: `sourceLayout(sourceId)` is **sourceId-only and synchronous** (reached deep inside the fetcher via `resolveFetchedDir`), while `deriveSourceLayout(source, fallbackCase)` needs a full `Source`. The derivation is therefore **precomputed by sourceId when the policy is constructed** at the composition root — where the corpus's Sources are already loaded — never computed lazily inside `sourceLayout`.

The exported API `registerSourceLayout` / `isSourceLayoutRegistered` / `deriveSourceLayout` is **retained unchanged**; `member-layout.ts` (`ensureMemberLayoutRegistered`) and the acquire pipeline depend on it. Only the static `SOURCE_LAYOUTS` map is retired.

## Validation rules (the config gate — strict policy)

**Per manifest**: supported schema version; corpus-id validity + `basename==id`; ≥1 case; case-id grammar + within-manifest uniqueness; source-ID prefix grammar (no trailing delimiter); `padWidth ∈ 1..8`.
**Repository-wide (ALL committed manifests)**: unique corpus ids; **prefix disjointness** — no configured prefix equals or is a leading substring of another; unique case ids; browser-profile `corpus` references a known corpus + unique profile ids; archive-override references a known Source in a Case of that corpus, relative path, no archive-root escape, no two Sources to one location, every override has a `reason`.
**Existing-data**: every existing Source ID globally unique; every Source under a Corpus conforms to **at least one of** its ID policies (FR-002b — this is what makes `PB-S001`/`PB-S002` valid without a grandfathering carve-out); the next allocated ID, drawn from the **allocatable** policy, cannot collide with any existing ID or another Corpus's namespace.
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
