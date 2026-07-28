# Design: Corpus Config Seam (`impl:feature/corpus-config-seam`)

- Date: 2026-07-27 (revised same day after third-party review)
- Epic: `multi:feature/multi-corpus-generalization` (this is **spec 1 of 2**)
- Roadmap item: `impl:feature/corpus-config-seam` (part-of the epic)
- Status: designing (awaiting operator approval marker)
- Backend: `superpowers:brainstorming` via `/stack-control:design`.

## Problem domain

The `colony-cults` apparatus was built for a single research corpus (Port Breton /
Marquis de Rays). The operator wants to run **varied future research subjects** on the
**same shared core**, with domain-specific parts pluggable — one operator, not a
distributable product.

A coupling assessment (Explore sweep over `src/`, 2026-07-27) established the apparatus
is **already ~80% corpus-neutral** and the real single-corpus coupling is **shallow and
localized** — not threaded through logic:

- **Already agnostic / pluggable**: `case` is a per-`Source` field; archive paths build
  generically as `cases/<case>/…` (the path layer is *already* multi-case); external
  sources sit behind a `RepositoryAdapter` interface + registry; the source-query client
  (spec 014) is a runtime registry; rights are **operator-authored, not
  jurisdiction-computed** (no date arithmetic); the canonical model, coverage audit, and
  asset-summaries are corpus-neutral.
- **Real coupling — four localized spots**: (1) `src/archive/location.ts` a *vestigial*
  static `SOURCE_LAYOUTS` map for 9 legacy sources (`deriveSourceLayout` already handles
  new ones from `source.case`); (2) `src/bibliography/scope.ts` a `PORT_BRETON_CASE_ID`
  constant + check; (3) `src/sourcegroup/id-alloc.ts` the `PB-P` id prefix / pad (only in
  *allocation*, not parsing/validation); (4) `src/browser/config.ts` a hardcoded default
  source list (already env-overridable).
- **The subtle knot is DOMAIN, not IDENTITY**: French-domain assumptions masquerading as
  infrastructure — the sole `DiscoveryMechanism` is BnF-SRU and the census builder
  unconditionally runs `normalizeFrenchDate`. These bite only at the **first non-French
  subject** → epic **spec 2**, not here.

## Corpus / Case model (normative — resolves review clarification 1)

- A **Corpus** is *the selected canonical research dataset and configuration boundary.*
- A Corpus **contains one or more Cases.** A **Case** is a subject grouping stored on each
  `Source` (`Source.case`) and used in archive paths (`cases/<case>/…`).
- A `Source` belongs to **exactly one** Case (already the model).
- **Case IDs are unique across the repository** (a Case ID does not recur in two corpora).
- **Source IDs are GLOBALLY unique across all corpora in the repository** — bare
  references like `PB-P061` must stay unambiguous. Global uniqueness is guaranteed by
  **unique per-corpus ID prefixes**, enforced by the config validator (below).
- **`bib coverage` reports exactly one selected corpus.**
- **Spec 1 ships Port Breton as a corpus (`port-breton`) with exactly one case
  (`port-breton`).** Whether a *future* subject is a new Case within a corpus or a new
  Corpus is a per-addition operator choice the model already supports — deferred, not
  blocking.

## Solution space

### Chosen — narrow policy interfaces derived from a data manifest, selected at the composition root

- **Configuration is DATA, not code.** A **corpus manifest** (`corpora/<id>.yml`) with an
  explicit `schemaVersion` and a **typed, validated loader**. No arbitrary module
  execution as config. Minimal spec-1 shape:

  ```yaml
  schemaVersion: 1
  id: port-breton
  cases: [port-breton]
  sourceIds: { prefix: PB-P, padWidth: 3 }
  ```

  Directory is `corpora/` (not the awkward `corpuses/`).
- **Narrow policy interfaces at each seam — NOT one omnibus `Corpus` object injected
  everywhere** (Constitution VI). The composition root loads the manifest once and derives
  a narrow policy for each hotspot:
  - scope resolution ← `{ validCaseIds: ReadonlySet<string> }` (via `ScopeResolutionContext`)
  - ID allocation ← `SourceIdPolicy { prefix, padWidth }`
  - archive layout ← an archive-layout policy (see SOURCE_LAYOUTS below)
  - browser defaults ← a **separate** browser-source policy (see below)
  Core modules consume the narrow interface, never the whole manifest.
- **Selection is explicit, established once, injected downward** (resolves review
  clarification 2). Precedence: **`--corpus` CLI arg → `COLONY_CORPUS` env → fail loud.**
  **No derivation from a case operand** (ambiguous the moment a command spans the corpus,
  creates a source before its case exists, or has no operand). Loaded at the application
  composition root and passed down as the narrow policies above; core functions do **not**
  re-inspect env.
- **`defaultSources` is deployment, not identity** — it is removed from the core manifest.
  Browser default sources become a **separate `BrowserProfile`** (`{ corpus, defaultSources }`)
  derived at browser composition, keeping identity and deployment distinct. (`CORPUS_SOURCES`
  env already overrides; this formalizes the fallback's home.)
- **Registries stay orthogonal** (resolves the registry open-question): the corpus does
  **not** own the `RepositoryAdapterRegistry` / `SourceQueryRegistry` and is not a service
  locator. Those describe *installed capabilities*; at composition the app may **validate
  that the selected corpus's referenced repositories ⊆ available capabilities**, but the
  corpus never becomes the registry.
- **`SOURCE_LAYOUTS` retirement via a characterization gate** — enumerate the 9 legacy
  Source fixtures, record every relevant `location.ts` output, route them through the
  generic `deriveSourceLayout`, and compare **exact strings** (incl. punctuation /
  capitalization / historical special names). If a path cannot be reproduced generically,
  keep a **data-driven per-`Source` layout override** (validated against real Source IDs) —
  **never** a hardcoded infrastructure map, and overrides must be exceptional.
- **Config validation is a first-class gate.** A validator checks: supported schema
  version; valid unique corpus ID; ≥1 case; unique case IDs within a manifest; valid +
  unique source-ID prefix; positive bounded pad width; **repository-wide collisions across
  all manifests** (corpus IDs, prefixes, case IDs); selected corpus exists and has its
  required capabilities. Surfaced as `bib validate-config`, and **run at startup for the
  selected corpus** (fail loud at the load boundary).
- **No spec-2 fields in the spec-1 type.** `discoveryMechanism` / `dateNormalizer` are
  **not** declared now — they'd force Port Breton to name domain capabilities before the
  abstraction is understood, or admit placeholder values. Spec 2 introduces a separate
  capability configuration (e.g. a `CorpusRuntime`) or a new schema version, shaped by its
  first real consumer.
- **Port Breton = corpus-instance #1**, a faithful extraction from the current constants.
  Fail loud, type-safe (`@/`, no `any`, files ≤ 300–500), composition/DI.

### Rejected — one omnibus `Corpus` object injected through every module

Inject a single fat `Corpus` everywhere the constants lived. Rejected (review): it spreads
a large dependency through otherwise-neutral modules and invites a service-locator. Narrow
per-seam policies derived at the composition root are the disciplined form.

### Rejected — big-bang rewrite / new abstraction layer

The core is already neutral and the coupling is ~4 files; a rewrite is risk without benefit.

### Rejected — repo restructure now (workspaces or separate per-corpus repos)

The path layer is already multi-case and the coupling is shallow; physical isolation buys
a solo operator little now and costs multi-repo/versioning overhead. Kept as a **later
optional packaging step** the seam does not foreclose.

### Rejected — leave single-corpus / template-fork per corpus

Forks diverge and cannot share core improvements — the whole point is a shared core.

### Rejected — generalize the French-domain bits (discovery/date) now

Premature: no non-French subject yet; the interfaces are ready. **Deferred to epic spec 2
(triggered by the first non-French subject) — captured, not dropped.**

## Decisions

1. **Data manifest** (`corpora/<id>.yml`, `schemaVersion` + typed validated loader), not
   code-defined instances.
2. **Narrow per-seam policy interfaces** (validCaseIds set; `SourceIdPolicy`; archive-layout
   policy; browser-source policy) derived at the composition root — **not** an omnibus
   `Corpus` object threaded through modules.
3. **Explicit selection**: `--corpus` → `COLONY_CORPUS` → **fail loud**; **no** derivation
   from a case; resolved once at the composition root and injected down.
4. **Corpus/Case model** as normatively defined above; **Source IDs globally unique** across
   all corpora (via unique prefixes, validator-enforced).
5. **`defaultSources` is deployment**, moved out of corpus identity into a separate
   `BrowserProfile`.
6. **Registries orthogonal** — corpus validates references ⊆ capabilities but never owns
   the registry.
7. **`SOURCE_LAYOUTS` retirement behind a characterization gate**; data-driven per-Source
   override only if a path is not generically reproducible.
8. **First-class config validation** (`bib validate-config` + startup validation).
9. **No spec-2 domain fields** in the spec-1 type; domain capabilities are epic spec 2.
10. **Port Breton = corpus-instance #1**; one repo, `cases/<case>/` grain, no restructure.

## Acceptance criteria (resolves review point on "zero behavior change")

**Preserved behavior (data unchanged):**
- Every existing Port Breton `Source` validates unchanged; existing IDs unchanged.
- New Port Breton IDs allocate with the same prefix + width.
- All 9 legacy archive locations are **byte-identical**.
- `bib coverage` output is semantically identical for the selected Port Breton corpus.
- Repository + source-query dispatch behavior unchanged; **no canonical data migration**.

**Deliberate new behavior (invocation changes — an intentional interface change):**
- A corpus-dependent command with **no** selected corpus **fails loud** (no implicit
  Port-Breton default; dev tooling may set `COLONY_CORPUS=port-breton`, which is explicit
  composition, not a code fallback).
- Selecting an **unknown** corpus fails loud; **invalid/colliding** config fails at the
  load boundary.
- **A small synthetic second corpus** (different corpus ID, case ID, source prefix, and
  browser-default policy — no real research content) can be **selected without modifying
  any core implementation module.** This is the load-bearing proof that the constants were
  *removed*, not relocated into a Port-Breton loader — Port Breton regression alone does
  not prove the seam.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **Manifest field for browser-deploy selection** — formalize which `BrowserProfile`/env
  field drives a deploy (env already works).
- **Whether any legacy path needs a per-`Source` layout override** — determined empirically
  by the characterization gate, not assumed.
- **Future corpus granularity** — when the second subject arrives, whether it is a new Case
  in the Port Breton corpus or a new Corpus (the model supports both; an operator call then).
- **`bib validate-config` surface vs startup-only** — both are in scope; confirm the CLI
  verb shape in define.

## Provenance

- Origin: interactive `superpowers:brainstorming` via `/stack-control:design`, 2026-07-27;
  operator chose "you, varied domains, pluggable core" and was unsure of the repo shape. A
  **coupling assessment** (Explore over `src/`) established the coupling is shallow (~4
  files), revising the recommendation from a repo restructure to this `Corpus` config seam.
- **Revised the same day after a third-party design review** (high-merit; adopted
  essentially in full): the normative Corpus/Case model + global source-ID uniqueness
  (clarification 1); explicit `--corpus`→`COLONY_CORPUS`→fail-loud selection at the
  composition root (clarification 2); the ID namespace / collision-validator + narrow
  `SourceIdPolicy` (clarification 3); data-manifest config with schema versioning; narrow
  per-seam policy interfaces instead of an omnibus object; `defaultSources` reclassified as
  deployment; registries kept orthogonal; a characterization gate for `SOURCE_LAYOUTS`; a
  first-class config validator; the split acceptance contract; and the synthetic-second-
  corpus proof. Removed the speculative spec-2 fields from the spec-1 type.
- Epic: **spec 1** = this identity seam; **spec 2** = pluggable domain capabilities (a
  second discovery mechanism + a pluggable date normalizer), triggered by the first
  non-French subject.
- Handoff target: `/stack-control:define` (spec 1).
