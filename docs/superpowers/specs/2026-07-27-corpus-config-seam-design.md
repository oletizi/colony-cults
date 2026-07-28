# Design: Corpus Config Seam (`impl:feature/corpus-config-seam`)

- Date: 2026-07-27
- Epic: `multi:feature/multi-corpus-generalization` (this is **spec 1 of 2**)
- Roadmap item: `impl:feature/corpus-config-seam` (part-of the epic)
- Status: designing (awaiting operator approval marker)
- Backend: `superpowers:brainstorming` via `/stack-control:design`.

## Problem domain

The `colony-cults` apparatus was built for a single research corpus (Port Breton /
Marquis de Rays). The operator wants to run **varied future research subjects** on the
**same shared core**, with the domain-specific parts pluggable — one operator, not a
distributable product.

A coupling assessment (Explore sweep over `src/`, 2026-07-27) established that the
apparatus is **already ~80% corpus-neutral** and the real single-corpus coupling is
**shallow and localized**, not threaded through logic:

- **Already agnostic / pluggable**: `case` is a per-`Source` field, archive paths are
  built generically as `cases/<case>/…` (the path layer is *already* multi-case);
  external sources sit behind a `RepositoryAdapter` interface + registry; the
  source-query client (spec 014) is a runtime registry; rights are **operator-authored,
  not jurisdiction-computed** (no date arithmetic anywhere); the canonical model,
  coverage audit, and asset-summaries are corpus-neutral.
- **Real coupling — four localized spots**: (1) `src/archive/location.ts` a *vestigial*
  static `SOURCE_LAYOUTS` map for 9 legacy sources (`deriveSourceLayout` already handles
  new ones from `source.case`); (2) `src/bibliography/scope.ts` a `PORT_BRETON_CASE_ID`
  constant + equality check; (3) `src/sourcegroup/id-alloc.ts` the `PB-P` id prefix / pad
  (only in *allocation*, not parsing/validation); (4) `src/browser/config.ts` a hardcoded
  default source list (already env-overridable).
- **The subtle knot is DOMAIN, not IDENTITY**: French-domain assumptions masquerading as
  infrastructure — the sole `DiscoveryMechanism` is BnF-SRU (French catalogue) and the
  census builder unconditionally runs `normalizeFrenchDate`. These hide behind generic
  seams and only bite at the **first non-French subject**.

There is no `Corpus` config object; the single-corpus assumption is a scattered handful
of constants. This spec introduces the seam that absorbs the **identity** coupling;
the **domain** coupling is spec 2 of the epic.

## Solution space

### Chosen — a `Corpus` config object threaded via DI; Port Breton as instance #1; one repo

- **Introduce a typed `Corpus` config** — e.g. `{ caseIds, idPrefix, idPadWidth,
  defaultSources, /* spec-2: */ discoveryMechanism, dateNormalizer }` — a required,
  injected value that the four coupling points read from instead of module constants.
- **Refactor the four hotspots to consume the injected `Corpus`**: retire/parameterize
  the `SOURCE_LAYOUTS` map (route all sources through `deriveSourceLayout`); replace
  `PORT_BRETON_CASE_ID` with the corpus's `caseIds` set (via `ScopeResolutionContext`);
  parameterize the id prefix/pad in `id-alloc.ts`; source the browser default list from
  a corpus manifest.
- **Port Breton becomes corpus-instance #1** — its `Corpus` config is authored faithfully
  from the current constants, a **behavior-preserving extraction**: the existing tests +
  `bib validate` + `bib coverage` stay green, and the 9 legacy sources' archive paths stay
  **byte-identical**. Zero behavior change is the acceptance bar for spec 1.
- **Stay in one repo** on the existing `cases/<case>/…` grain. A second corpus = a second
  `Corpus` config + its data under `cases/<case>/` + an env-driven browser deploy. **No
  repo restructure** — the assessment shows physical isolation buys a solo operator little
  now and costs multi-repo/versioning overhead.
- **Fail loud, no implicit default**: a `Corpus` must be selected (env/arg); there is no
  silent fall-back to Port Breton (Principle V). Composition/DI (VI); type-safe, `@/`
  imports, files ≤ 300–500 (VII).
- **Scope = identity generalization only.** Domain generalization (a second
  `DiscoveryMechanism` + a pluggable `dateNormalizer`) is **epic spec 2**, triggered by
  and specced against the first non-French subject — the interfaces are already ready;
  only the French implementations are hardcoded. Captured, not cut.

### Rejected — big-bang rewrite / new abstraction layer

Re-architect the core for multi-corpus. Rejected: the assessment shows the core is
already neutral and the coupling is ~4 files; a rewrite is risk without benefit.

### Rejected — repo restructure now (monorepo workspaces or separate per-corpus repos)

Split into a published `corpus-toolkit` package + per-corpus repos/workspaces. Rejected
**for spec 1**: the path layer is already multi-case and the coupling is shallow, so
physical isolation is unnecessary for one operator and adds real overhead. Kept as a
**later optional packaging step** if a corpus ever grows big enough to warrant it — the
`Corpus` seam does not foreclose it.

### Rejected — leave single-corpus / template-fork per corpus

Copy the repo per subject. Rejected: forks diverge and cannot share core improvements —
the whole point is a shared core.

### Rejected — generalize the French-domain bits now

Build the pluggable discovery/date capabilities in spec 1. Rejected as premature: there
is no non-French subject yet and the interfaces are already in place. **Deferred to spec
2 (triggered by the first non-French subject) — captured in the epic, not dropped.**

## Decisions

1. A **typed `Corpus` config object threaded via DI** absorbs the identity coupling.
2. **Refactor the four hotspots** (location layout map, scope case-id, id-alloc prefix,
   browser default sources) to read the injected `Corpus`.
3. **Port Breton = corpus-instance #1**, a behavior-preserving extraction — **zero
   behavior change** (green tests, byte-identical legacy paths) is the spec-1 bar.
4. **One repo, `cases/<case>/` grain**; a second corpus = config + data + env deploy. **No
   repo restructure now** (kept as a later optional step).
5. **Identity generalization only**; **domain generalization is epic spec 2**, triggered
   by the first non-French subject — captured, not cut.
6. **Fail loud** (a `Corpus` is required, no implicit Port-Breton default); composition/DI;
   type-safe.

## Open questions

_Carry into `/stack-control:define`; none are blockers._

- **`Corpus` config shape + selection**: a manifest file (`corpuses/<name>.yml`) vs code;
  selected by an env var (`COLONY_CORPUS`), a CLI arg, or derived from the case being
  operated on.
- **`caseIds` cardinality**: one case per corpus vs a corpus spanning multiple case-ids.
- **`SOURCE_LAYOUTS` retirement**: fully route through `deriveSourceLayout` vs keep as a
  per-corpus override — verify the 9 legacy sources' paths are reproduced **byte-identically**.
- **Minimal `Corpus` fields for spec 1** (`caseIds`, `idPrefix`, `idPadWidth`,
  `defaultSources`) vs declaring the spec-2 domain fields (`discoveryMechanism`,
  `dateNormalizer`) in the type now.
- **Relationship to the shipped registries**: does `Corpus` select which repository
  adapters / source-query configs are in scope, or is that orthogonal (they self-register
  and a corpus just uses what it references)?
- **Browser deploy corpus selection**: env is already supported; formalize which manifest
  field drives it.

## Provenance

- Origin: interactive `superpowers:brainstorming` via `/stack-control:design`, 2026-07-27.
  Operator chose "you, varied domains, pluggable core" and was explicitly unsure of the
  repo shape. A **coupling assessment** (Explore agent over `src/`) established the coupling
  is shallow (~4 files) and the core already ~80% corpus-neutral, which **revised the
  recommendation away from a repo restructure** toward this `Corpus` config seam + DI.
- Scope framed as the **`multi:feature/multi-corpus-generalization` epic**: **spec 1** =
  this identity seam; **spec 2** = pluggable domain capabilities (a second discovery
  mechanism + a pluggable date normalizer), triggered by the first non-French subject.
- Refactors/reads: `bibliography/` (model + scope), `sourcegroup/` (id-alloc + pipeline),
  `archive/location.ts` (layout), `browser/config.ts`; declares the seam against the
  shipped `repository` + `sourcequery` registries.
- Handoff target: `/stack-control:define` (spec 1).
