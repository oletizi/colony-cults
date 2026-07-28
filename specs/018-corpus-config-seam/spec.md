# Feature Specification: Corpus Config Seam

**Feature Branch**: `018-corpus-config-seam`

**Created**: 2026-07-27

**Status**: Draft

**Input**: Design record `docs/superpowers/specs/2026-07-27-corpus-config-seam-design.md` (revised after third-party review). Spec 1 of the `multi:feature/multi-corpus-generalization` epic. Full scope, no YAGNI.

## Context

The apparatus was built for a single research corpus (Port Breton). A coupling assessment found it is already ~80% corpus-neutral, with the real single-corpus coupling concentrated in **four localized spots**: the archive `SOURCE_LAYOUTS` map, the bibliography `PORT_BRETON_CASE_ID` constant, the `PB-P` source-ID allocator, and the browser default source list. This feature introduces a **composition-time configuration seam** so the same shared core runs varied research subjects: corpus identity/policy becomes **data** (a validated manifest), selected explicitly and injected as **narrow per-seam policies**. Port Breton becomes the first corpus-instance as a **behavior-preserving extraction** — no data changes, no rewrite, one repository. Domain-specific generalization (a pluggable discovery mechanism + date normalizer for non-French subjects) is **epic spec 2**, deliberately out of scope here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select the active corpus explicitly (Priority: P1)

An operator selects which corpus a corpus-dependent command operates on, explicitly, with no implicit default. Selection precedence is `--corpus` CLI argument, then `COLONY_CORPUS` environment variable, then fail loud. The corpus is resolved **once** and its policies flow down; commands do not re-derive it from a case operand.

**Why this priority**: The selection seam is the load-bearing behavior — everything else depends on a single, unambiguous "which corpus is active."

**Independent Test**: Run a corpus-dependent command with `--corpus port-breton`; it operates on Port Breton. Run it with no `--corpus` and no `COLONY_CORPUS`; it fails loud with a descriptive error. Run it with `--corpus does-not-exist`; it fails loud at the load boundary.

**Acceptance Scenarios**:

1. **Given** `--corpus port-breton`, **When** a corpus-dependent command runs, **Then** it operates on that corpus's cases/policies.
2. **Given** neither `--corpus` nor `COLONY_CORPUS`, **When** a corpus-dependent command runs, **Then** it fails loud (non-zero exit, descriptive message) — **no implicit Port-Breton default**.
3. **Given** `--corpus` and `COLONY_CORPUS` both set, **When** a command runs, **Then** the CLI argument wins.
4. **Given** an unknown corpus id, **When** selected, **Then** it fails loud naming the missing manifest.

---

### User Story 2 - Port Breton runs unchanged as corpus-instance #1 (Priority: P1)

The existing Port Breton work operates identically after the extraction — its config is authored from the current constants into a manifest, with zero change to data, IDs, archive paths, or coverage output.

**Why this priority**: The extraction is worthless if it regresses the live corpus. Behavior preservation is the acceptance bar for the whole feature.

**Independent Test**: With `--corpus port-breton`, the full existing test suite + `bib validate` + `bib coverage` produce the same results as before the change; the 9 legacy sources' archive locations are byte-identical.

**Acceptance Scenarios**:

1. **Given** the Port Breton manifest, **When** every existing Source is loaded/validated, **Then** all validate unchanged and their IDs are unchanged.
2. **Given** a new Port Breton member is allocated, **When** its ID is generated, **Then** it uses the same prefix + pad width as before.
3. **Given** the 9 legacy sources, **When** their archive locations are computed through the generic layout, **Then** every path string is **byte-identical** to the pre-change output (verified by a characterization comparison; a validated per-Source override is used only where a path is not generically reproducible).
4. **Given** the Port Breton corpus, **When** `bib coverage` runs, **Then** its output is semantically identical to before; no canonical data migration was required.

---

### User Story 3 - Add a second corpus without touching core code (Priority: P2)

A new corpus is added by authoring a manifest + data, with **no modification to any core implementation module** — proving the corpus-specific constants were removed, not relocated into a Port-Breton loader.

**Why this priority**: Port Breton passing alone does not prove a seam; a second corpus does. This is the feature's real success proof.

**Independent Test**: Add a small **synthetic second corpus** (different corpus id, case id, source-ID prefix, and browser-default policy; no real research content) as a manifest + fixture; select it and run corpus-dependent commands successfully — with the diff touching only config/data/fixtures, not core `src/` modules.

**Acceptance Scenarios**:

1. **Given** a synthetic second-corpus manifest + fixture, **When** it is selected, **Then** scope resolution, ID allocation, archive layout, and browser defaults all use *its* policies — with no change to any core module.
2. **Given** the second corpus, **When** an ID is allocated, **Then** it uses the second corpus's prefix/pad, and the ID is globally unique (its prefix differs from Port Breton's).

---

### User Story 4 - Validate corpus configuration (Priority: P2)

Corpus manifests are validated as a first-class gate — malformed or colliding config fails at the load boundary, and a command surfaces validation results.

**Why this priority**: Multiple manifests introduce collision risk (duplicate corpus ids, prefixes, case ids). Global source-ID uniqueness depends on this gate.

**Independent Test**: Run the config validator against the manifests; a manifest with an unsupported schema version, a duplicate prefix, a zero pad width, or a case-id/prefix that collides with another manifest fails loud with a specific message; the valid set passes.

**Acceptance Scenarios**:

1. **Given** a manifest with an unsupported `schemaVersion`, **When** validated, **Then** it fails loud.
2. **Given** two manifests sharing a source-ID prefix (or a case id), **When** validated repository-wide, **Then** the collision fails loud (protecting global source-ID uniqueness).
3. **Given** a manifest with no cases, or a non-positive/oversized pad width, **When** validated, **Then** it fails loud.
4. **Given** a selected corpus referencing an unavailable repository capability, **When** startup validation runs, **Then** it fails loud.

### Edge Cases

- A command that operates over the whole corpus (no single case operand) still resolves the corpus explicitly — never by case derivation.
- A command that creates a new Source before its case is fully materialized still has the corpus in hand (resolved at the composition root).
- The same case id appearing in two manifests is a validation error (case ids are repository-unique).
- A legacy archive path that the generic layout cannot reproduce → a validated, data-driven per-`Source` override (never a hardcoded infrastructure map); overrides are exceptional.
- Dev tooling setting `COLONY_CORPUS=port-breton` is explicit composition, not a code fallback.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Corpus identity/policy MUST be expressed as **data** — a manifest at `corpora/<id>.yml` with an explicit `schemaVersion`, loaded by a typed, validating loader. No code-defined corpus instances; no arbitrary module execution as configuration.
- **FR-002**: The system MUST implement the normative model: a **Corpus contains one or more Cases**; a `Source` belongs to **exactly one** Case; **Case IDs are unique across the repository**; **Source IDs are globally unique across all corpora**, guaranteed by unique per-corpus ID prefixes.
- **FR-003**: Corpus selection MUST be explicit with precedence `--corpus` → `COLONY_CORPUS` → **fail loud**; it MUST NOT be derived from a case operand; it MUST be resolved **once at the application composition root** and injected downward.
- **FR-004**: The four coupling points MUST consume **narrow per-seam policies** derived at the composition root — scope resolution gets `{ validCaseIds }`, ID allocation gets `SourceIdPolicy { prefix, padWidth }`, archive layout gets a layout policy, browser defaults get a **separate `BrowserProfile`** — NOT one omnibus corpus object threaded through modules.
- **FR-005**: `defaultSources` MUST be modeled as **deployment** (a `BrowserProfile`), not corpus identity.
- **FR-006**: The repository-adapter and source-query **registries MUST remain orthogonal** — a corpus MAY validate that its referenced repositories are a subset of installed capabilities, but MUST NOT own or become the registry (no service locator).
- **FR-007**: The vestigial `SOURCE_LAYOUTS` map MUST be retired behind a **characterization gate**: enumerate the 9 legacy Source fixtures, record every relevant location output, route them through the generic derivation, and compare **exact strings**. A path that is not generically reproducible MUST fall back to a **validated, data-driven per-`Source` override**, never a hardcoded map.
- **FR-008**: A **config validator** MUST exist (surfaced as `bib validate-config`, and run at startup for the selected corpus) checking: supported schema version; valid + unique corpus id; ≥1 case; unique case ids within a manifest; valid + unique source-ID prefix; positive bounded pad width; **repository-wide collisions across all manifests**; selected corpus exists and has its required capabilities.
- **FR-009**: A corpus-dependent command with no selected corpus, an unknown corpus, or invalid/colliding config MUST **fail loud** — no fallback, no partial run.
- **FR-010**: The extraction MUST be **behavior-preserving** for Port Breton: existing Sources validate unchanged, IDs unchanged, new IDs same prefix/pad, all 9 legacy archive locations byte-identical, `bib coverage` semantically identical, repository/source-query dispatch unchanged, **no canonical data migration**.
- **FR-011**: A **second corpus MUST be addable without modifying any core implementation module** (manifest + data/fixture only).
- **FR-012**: Spec-1 types MUST NOT declare the spec-2 domain fields (`discoveryMechanism`, `dateNormalizer`); domain generalization is epic spec 2.
- **FR-013**: The system MUST stay in **one repository** on the existing `cases/<case>/` grain — no repository restructure.

### Key Entities *(include if feature involves data)*

- **Corpus manifest** (`corpora/<id>.yml`): `schemaVersion`, `id`, `cases: string[]`, `sourceIds: { prefix, padWidth }`. The selected canonical dataset + config boundary.
- **Case**: a subject grouping stored on each `Source` (`Source.case`) and used in archive paths; a Source is in exactly one Case.
- **SourceIdPolicy**: `{ prefix, padWidth }` — the narrow input to the ID allocator.
- **BrowserProfile**: `{ corpus, defaultSources }` — deployment policy, separate from corpus identity.
- **ScopeResolutionContext**: carries `{ validCaseIds: ReadonlySet<string> }` (+ existing scope data).
- **Archive-layout policy**: the generic derivation + optional validated per-`Source` overrides.
- **Config validator / collision rules**: the repository-wide uniqueness gate.
- **(Reused, unchanged)**: `Source`, `RepositoryRecord`, `RepositoryAdapterRegistry`, `SourceQueryRegistry`, coverage/search-log.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of existing Port Breton Sources validate unchanged; all 9 legacy archive locations are byte-identical; `bib coverage` output is semantically identical; zero canonical data migrations.
- **SC-002**: A corpus-dependent command with no selected corpus, an unknown corpus, or invalid/colliding config exits non-zero with a descriptive error, and never runs partially.
- **SC-003**: A synthetic second corpus (distinct corpus id, case id, source prefix, browser-default policy) is selected and operated successfully, with the change set touching **only** config/data/fixtures — **zero** core `src/` implementation modules modified.
- **SC-004**: None of the four corpus-specific constants (the `port-breton` `SOURCE_LAYOUTS` entries, `PORT_BRETON_CASE_ID`, the `PB-P` allocator literal, the browser default source list) remain as literals in core modules; each seam reads an injected policy.
- **SC-005**: The config validator rejects every malformed/colliding manifest condition enumerated in FR-008 with a specific message, and accepts the valid set — deterministically.

## Assumptions

- One repository, `cases/<case>/` grain; **no** restructure (a later packaging split remains possible but is out of scope).
- Port Breton is corpus-instance #1, a behavior-preserving extraction; its manifest is authored faithfully from the current constants.
- Repository adapters and source-query configs self-register as installed capabilities; a corpus references a subset. The corpus never owns the registry.
- Domain-specific generalization (pluggable discovery mechanism + date normalizer) is **epic spec 2**, triggered by the first non-French subject; its fields are deliberately absent here.
- Dev tooling MAY set `COLONY_CORPUS=port-breton` for convenience — that is explicit composition, not a code fallback.
- Global source-ID uniqueness is preserved because bare references (e.g. `PB-P061`) must stay unambiguous; corpus-relative uniqueness is explicitly rejected.
