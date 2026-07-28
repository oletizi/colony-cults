# Feature Specification: Corpus Config Seam

**Feature Branch**: `018-corpus-config-seam`

**Created**: 2026-07-27 (revised after third-party spec review)

**Status**: Draft

**Input**: Design record `docs/superpowers/specs/2026-07-27-corpus-config-seam-design.md`. Spec 1 of the `multi:feature/multi-corpus-generalization` epic. Full scope, no YAGNI.

## Context

The apparatus was built for a single research corpus (Port Breton). A coupling assessment found it is already ~80% corpus-neutral, with the real single-corpus coupling in **four localized spots**: the archive `SOURCE_LAYOUTS` map, the bibliography `PORT_BRETON_CASE_ID` constant, the `PB-P` source-ID allocator, and the browser default source list. This feature introduces a **composition-time configuration seam** so the same shared core runs varied subjects: corpus identity/policy becomes validated **data manifests**, selected explicitly and injected as **narrow per-seam policies**. Port Breton becomes corpus-instance #1 as a **behavior-preserving extraction** — no data changes, no rewrite, one repository. Domain generalization (pluggable discovery + date normalizer) is **epic spec 2**, out of scope here.

Model: `Repository └── Corpus ├── Case └── Source` + identity policies. Three distinct layers: the **corpus manifest** (dataset identity + naming policy), a **BrowserProfile** (deployment defaults), and the **capability registries** (installed repository/query implementations) — kept orthogonal.

## Command scope (normative)

A command is **corpus-dependent** when it reads or mutates canonical corpus data, allocates IDs, resolves scope, computes archive paths, produces coverage, or loads corpus-specific browser defaults — these require an explicitly selected corpus. **Exceptions** (do NOT require a selected corpus): `bib validate-config` (validates all manifests), generic help/version, and repository diagnostics that do not inspect corpus data. Ordinary `bib` commands that do not consume browser defaults do **not** require a `BrowserProfile`; only the browser deploy / browser-default-consuming commands do.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select the active corpus explicitly (Priority: P1)

An operator selects which corpus a corpus-dependent command operates on, explicitly, with no implicit default: `--corpus` → `COLONY_CORPUS` → fail loud. Resolved **once** at the composition root; policies flow down; commands never re-derive it from a case operand.

**Independent Test**: `--corpus port-breton` operates on Port Breton; no selection fails loud; unknown corpus fails loud at the load boundary.

**Acceptance Scenarios**:
1. **Given** `--corpus port-breton`, **When** a corpus-dependent command runs, **Then** it uses that corpus's cases/policies.
2. **Given** neither `--corpus` nor `COLONY_CORPUS`, **When** a corpus-dependent command runs, **Then** it fails loud — **no implicit Port-Breton default**.
3. **Given** both set, **When** a command runs, **Then** the CLI argument wins.
4. **Given** an unknown corpus id, **When** selected, **Then** it fails loud naming the missing manifest.
5. **Given** a command in the exceptions list (`bib validate-config`, help/version), **When** run with no selected corpus, **Then** it runs normally.

---

### User Story 2 - Port Breton runs unchanged as corpus-instance #1 (Priority: P1)

The existing Port Breton work operates identically after the extraction; its manifest is authored from the current constants, with zero change to data, IDs, archive paths, or coverage.

**Independent Test**: with `--corpus port-breton`, the suite + `bib validate` + `bib coverage` match pre-change; the 9 legacy archive locations are byte-identical.

**Acceptance Scenarios**:
1. **Given** the Port Breton manifest, **When** every Source loads/validates, **Then** all validate unchanged; IDs unchanged.
2. **Given** a new member allocation, **When** an ID is generated, **Then** same prefix + pad width.
3. **Given** the 9 legacy sources, **When** layouts compute through the generic derivation, **Then** every path string is **byte-identical** to the characterized pre-change output (a validated per-`Source` override supplies only a path the generic rule cannot reproduce).
4. **Given** the Port Breton corpus, **When** `bib coverage` runs, **Then** the **structured coverage snapshot** (§SC-001) is identical; no canonical data migration.

---

### User Story 3 - Add a second corpus without touching core code (Priority: P2)

After the seam is implemented, a new corpus is added as **fixtures only** — a manifest + browser profile + case data under a fixture root — with **no modification to any core implementation module**, proving the constants were removed, not relocated.

**Independent Test**: a synthetic second corpus lives under `tests/fixtures/corpora/…` (manifest + `<id>.browser.yml` profile beside it, same convention as production + case fixtures); running the same composition path against it — with `corporaRoot` injected at that fixture root (FR-016) — succeeds, and adding it touched only fixtures — enforced by the fixture layout, not git-diff introspection.

**Acceptance Scenarios**:
1. **Given** the synthetic-corpus fixtures, **When** selected, **Then** scope resolution, ID allocation, archive layout, and browser defaults all use *its* policies — with no core-module change.
2. **Given** the second corpus, **When** an ID allocates, **Then** it uses the second corpus's prefix/pad and is globally unique (disjoint prefix namespace).

---

### User Story 4 - Validate corpus configuration (Priority: P2)

Corpus manifests, browser profiles, and archive-layout overrides are validated as a first-class gate; malformed/colliding config fails at the load boundary.

**Independent Test**: `bib validate-config` rejects each failure condition with a specific message and accepts the valid set.

**Acceptance Scenarios**:
1. **Given** an unsupported `schemaVersion`, **When** validated, **Then** fail loud.
2. **Given** two manifests whose prefixes collide (equal, or one a prefix of another), **When** validated repo-wide, **Then** fail loud (global source-ID uniqueness).
3. **Given** no cases, a case id colliding across manifests, or a pad width outside `1..8`, **When** validated, **Then** fail loud.
4. **Given** a selected corpus whose `requiredCapabilities` are not all installed, **When** startup validation runs, **Then** fail loud.
5. **Given** a browser profile referencing an unknown corpus, or an archive override referencing an unknown Source, **When** validated, **Then** fail loud.

### Edge Cases

- Whole-corpus commands (no single case operand) still resolve the corpus explicitly.
- A command creating a Source before its case exists still has the corpus in hand (composition root).
- The same case id in two manifests is a validation error.
- A legacy path the generic layout cannot reproduce → a validated per-`Source` override (with a reason), never a hardcoded map.
- A committed but malformed *unrelated* manifest **blocks all corpora** (strict policy, FR-015); drafts live outside `corpora/` until valid.
- Dev tooling setting `COLONY_CORPUS=port-breton` is explicit composition, not a fallback.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Corpus identity/policy MUST be **data** — a manifest `<corporaRoot>/<id>.yml` (production: `corpora/<id>.yml`) with explicit `schemaVersion`, read by a typed validating loader; **`basename == manifest.id`**. No code-defined instances; no arbitrary module execution.
- **FR-002**: The system MUST implement the normative model — a **Corpus contains ≥1 Cases**; a `Source` is in **exactly one** Case; **Case IDs unique across the repository** (grammar `^[a-z][a-z0-9-]*$`); **Source IDs globally unique across all corpora**.
- **FR-002a (ID namespace disjointness)**: Source-ID prefixes MUST match the grammar `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$`. **A trailing delimiter is NOT required** — the shipped Port Breton namespace is literally `PB-P` + a 3-digit pad (`PB-P007`, `src/sourcegroup/id-alloc.ts`), so a trailing-delimiter rule would make FR-010 (behavior-preserving, IDs unchanged) unsatisfiable: no manifest could express the existing namespace. **No configured prefix may equal, or be a leading substring of, another configured prefix — compared across ALL policies of ALL corpora, not merely one per corpus** (namespaces must be provably disjoint). This leading-substring rule is the actual disjointness invariant and is sufficient on its own, which is why the delimiter rule is dropped rather than replaced. `padWidth` MUST satisfy `1 ≤ padWidth ≤ 8`. Validation MUST additionally verify against **existing data**: every existing Source ID is globally unique; every Source under a Corpus conforms to **at least one of** that Corpus's ID policies; the next allocated ID cannot collide with any existing ID or another Corpus's namespace.
- **FR-002b (multiple ID policies per corpus)**: A Corpus MUST be able to declare **more than one** source-ID policy, because a single corpus legitimately carries more than one namespace — Port Breton ships **92 `PB-P###`** primary sources (machine-allocated) alongside **2 `PB-S###`** secondary scholarly works (hand-authored: `PB-S001`, `PB-S002`), and the shipped id pattern `^PB-[A-Z]?\d{3}$` already admits both. `sourceIds` is therefore a **non-empty list** of `{ prefix, padWidth, allocatable }`. **Exactly one policy per corpus MUST have `allocatable: true`** — the allocator needs one unambiguous target, and `src/sourcegroup/id-alloc.ts` only ever allocates into the `PB-P` namespace. A Source conforms if it matches **any** of its corpus's policies; new IDs are allocated **only** from the allocatable one. The narrow `SourceIdPolicy` injected into the allocator (FR-004) stays **singular** — it is derived from the allocatable policy — so the allocation seam is unchanged. `padWidth` MUST satisfy `1 ≤ padWidth ≤ 8`. Validation MUST additionally verify against **existing data**: every existing Source ID is globally unique; every Source under a Corpus conforms to that Corpus's ID policy (unless explicitly grandfathered); the next allocated ID cannot collide with any existing ID or another Corpus's namespace.
- **FR-003**: Corpus selection MUST be explicit — precedence `--corpus` → `COLONY_CORPUS` → **fail loud**; never derived from a case operand; resolved **once at the composition root** and injected downward.
- **FR-004**: The four coupling points MUST consume **narrow per-seam policies** derived at the composition root — scope resolution `{ validCaseIds: ReadonlySet<string> }`, ID allocation `SourceIdPolicy { prefix, padWidth }`, archive layout a layout policy, browser defaults a **separate `BrowserProfile`** — NOT one omnibus corpus object. Injected policies expose **immutable** collections (`ReadonlySet`/`ReadonlyArray`).
- **FR-005 (BrowserProfile)**: Browser default sources MUST be **deployment** config, stored as `<corporaRoot>/<id>.browser.yml` (`schemaVersion`, `id`, `corpus`, `defaultSources`) — one conventional profile per corpus, sitting beside its manifest under the same injected root (FR-016), selected with the corpus (`CORPUS_SOURCES` env override preserved). **A missing BrowserProfile MUST NOT fail non-browser commands**; only browser-deploy / browser-default-consuming commands require one.
- **FR-006 (required capabilities)**: The manifest MUST declare `requiredCapabilities: { repositories: string[], sourceQueries: string[] }` — **names of** installed capabilities the corpus depends on. This names requirements only; the registries remain orthogonal (the corpus never owns them).
- **FR-007 (archive-layout overrides)**: When the generic layout cannot reproduce a legacy path, the manifest MUST supply a **data-driven per-`Source` override** — `archiveLayoutOverrides: { <SourceId>: { relativePath, reason } }` (default `null`) — never a hardcoded map. The validator MUST enforce: the Source ID exists and belongs to a Case in that Corpus; the path is relative and cannot escape the archive root; two Sources cannot resolve to the same location; every override carries a `reason`; and an override is present **only** where the generic output differs from the characterized legacy output.
- **FR-008 (config validator)**: A validator (surfaced as `bib validate-config`; run at startup for the selected corpus) MUST check, per manifest: schema version; corpus-id validity + `basename==id`; ≥1 case; case-id grammar + within-manifest uniqueness; source-ID prefix grammar; pad width `1..8`. And **repository-wide** across ALL committed manifests: unique corpus ids; **prefix disjointness** (FR-002a); unique case ids; existing-data uniqueness/conformance (FR-002a); browser-profile references a known corpus + unique profile ids; archive-override references a known Source. At selection: the corpus exists and its `requiredCapabilities` ⊆ installed capabilities.
- **FR-009**: A corpus-dependent command with no selected corpus, an unknown corpus, or invalid/colliding config MUST **fail loud** — no fallback, no partial run.
- **FR-010**: The extraction MUST be **behavior-preserving** for Port Breton: existing Sources validate unchanged, IDs unchanged, new IDs same prefix/pad, all 9 legacy archive locations byte-identical, the coverage snapshot (SC-001) identical, repository/source-query dispatch unchanged, **no canonical data migration**.
- **FR-011**: After the seam exists, a **second corpus MUST be addable as fixtures/data only** (manifest + browser profile + case fixtures), with **no core implementation module changed**.
- **FR-012**: Spec-1 types MUST NOT declare the spec-2 domain fields (`discoveryMechanism`, `dateNormalizer`); domain generalization is epic spec 2.
- **FR-013**: The system MUST stay in **one repository** on the `cases/<case>/` grain — no restructure.
- **FR-014 (command scope)**: The corpus-dependent boundary + its exceptions (§Command scope) MUST be established; the implementation plan MUST carry the command table.
- **FR-015 (validation policy — strict)**: **Every committed manifest under the active corpora root MUST be valid before any corpus can run** (a malformed committed manifest blocks all corpora); draft/incomplete manifests live outside that root until valid. `bib validate-config` performs full validation of every manifest.
- **FR-016 (corpora root is injected, never hardcoded)**: The directory holding manifests and browser profiles MUST be an **explicit `corporaRoot` input resolved once at the composition root and injected downward** — never a literal in any core module. Production resolves it to `<repoRoot>/corpora`; tests inject `tests/fixtures/corpora`. Both artifacts follow **one convention** under that root: manifest `<corporaRoot>/<id>.yml`, browser profile `<corporaRoot>/<id>.browser.yml` — so a second corpus needs no second code path. The loader and validator MUST take the root (and the sources dir, for existing-data validation) as parameters. **A hardcoded corpora root would make SC-003 unsatisfiable**, since adding a fixture corpus would then require a core edit.
- **FR-017 (archive-layout resolution order)**: `archive/location.ts` MUST resolve a layout in this **total, documented order**: (1) the manifest's validated `archiveLayoutOverrides`; (2) the **runtime overlay** (`registerSourceLayout`, unchanged — source-group members created mid-run by `bib inventory`); (3) the **generic derivation**, precomputed per Source at policy-construction time; (4) **throw** — no default (Principle V). The exported runtime-overlay API (`registerSourceLayout`, `isSourceLayoutRegistered`, `deriveSourceLayout`) MUST be **retained with unchanged semantics**, including `registerSourceLayout`'s fail-loud conflict detection; `member-layout.ts` and the acquire pipeline depend on it. **Binding constraint**: `sourceLayout(sourceId)` is **sourceId-only and synchronous** (reached deep inside the fetcher via `resolveFetchedDir`), whereas `deriveSourceLayout` requires a full `Source` — therefore the generic derivation MUST be **precomputed by sourceId when the `ArchiveLayoutPolicy` is constructed at the composition root** (where the corpus's Sources are already loaded), never computed lazily inside `sourceLayout`.

### Key Entities *(include if feature involves data)*

- **Corpus manifest** (`<corporaRoot>/<id>.yml`): `schemaVersion`, `id` (== basename), `cases: string[]`, `sourceIds: { prefix, padWidth, allocatable }[]` (non-empty; exactly one `allocatable: true`), `requiredCapabilities: { repositories, sourceQueries }`, `archiveLayoutOverrides: { <SourceId>: { relativePath, reason } } | null`.
- **BrowserProfile** (`<corporaRoot>/<id>.browser.yml`): `schemaVersion`, `id`, `corpus`, `defaultSources` — deployment, one per corpus.
- **`corporaRoot`** (composition-root input): the injected directory holding manifests + profiles; `<repoRoot>/corpora` in production, a fixture root under test (FR-016).
- **Case**: subject grouping on `Source.case` (grammar `^[a-z][a-z0-9-]*$`); a Source is in exactly one Case.
- **Narrow policies**: `SourceIdPolicy { prefix, padWidth }`; `ScopeResolutionContext { validCaseIds: ReadonlySet<string> }`; archive-layout policy (generic + overrides); `BrowserProfile`.
- **Config validator / collision index**: the repository-wide uniqueness + prefix-disjointness + existing-data gate.
- **(Reused, unchanged)**: `Source`, `RepositoryRecord`, `RepositoryAdapterRegistry`, `SourceQueryRegistry`, coverage/search-log.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of existing Port Breton Sources validate unchanged; all 9 legacy archive locations byte-identical; the **structured coverage snapshot** is identical — comparing Source/group **counts, statuses, unresolved leads, extent reporting, repository holdings, ordering, and generated identifiers/links** (normalizing only an added selected-corpus label, if introduced); zero canonical data migrations.
- **SC-002**: A corpus-dependent command with no/unknown/invalid corpus exits non-zero with a descriptive error and never runs partially; exception commands run without a selected corpus.
- **SC-003**: A synthetic second corpus, added as **fixtures only** (`tests/fixtures/corpora/synthetic.yml` + `synthetic.browser.yml` beside it + case fixtures), is selected and operated successfully through the same composition path — with **zero** core `src/` implementation modules modified when adding it. Achievable only because `corporaRoot` is injected (FR-016).
- **SC-004**: None of the four corpus-specific constants remain as literals in core modules; each seam reads an injected policy.
- **SC-005**: The validator deterministically rejects every FR-008 / FR-002a / FR-007 failure condition with a specific message and accepts the valid set.

## Assumptions

- One repository, `cases/<case>/` grain; no restructure (later packaging split possible, out of scope).
- Port Breton is corpus-instance #1, a behavior-preserving extraction authored from the current constants.
- Registries self-register installed capabilities; the manifest **names** required capabilities (Model A) but never owns the registry.
- **Strict validation policy** for committed manifests (FR-015); drafts live outside `corpora/`.
- Domain generalization (discovery mechanism + date normalizer) is epic spec 2 — its fields deliberately absent.
- Global source-ID uniqueness is preserved via disjoint prefix namespaces (FR-002a) + existing-data validation; corpus-relative uniqueness is rejected (bare references like `PB-P061` must stay unambiguous).
