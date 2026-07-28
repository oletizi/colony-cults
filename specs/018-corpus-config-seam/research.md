# Phase 0 Research: Corpus Config Seam

Most decisions were resolved in the design + third-party review; recorded here with rationale + alternatives. The one genuinely empirical item is the characterization gate (R4).

## R1 — Config format: data manifest, not code

**Decision**: `corpora/<id>.yml` with an explicit `schemaVersion`, read by a typed loader with a discriminated version. No code-defined corpus instances; no arbitrary module execution as config.

**Rationale**: new corpora need no implementation change; config is inspectable without reading code; schema validation is a fail-loud boundary; a later repo split can move the manifest with the data.

**Alternatives**: TS-defined instances (rejected — couples adding a corpus to code + risks arbitrary execution); untyped JSON (rejected — no fail-loud boundary).

## R2 — Selection: explicit, composition-root, fail-loud

**Decision**: precedence `--corpus` CLI arg → `COLONY_CORPUS` env → fail loud; resolved **once** at the application composition root; policies injected downward; core functions never re-inspect env or derive from a case operand.

**Rationale**: derivation from a case is ambiguous the moment a command spans the whole corpus, creates a Source before its case exists, has no operand, or two manifests share a case id. One resolution point keeps behavior deterministic.

**Alternatives**: derive-from-case (rejected — ambiguous); per-module env reads (rejected — scatters selection, breaks DI).

## R3 — Narrow per-seam policies, not an omnibus object

**Decision**: derive `{ validCaseIds }`, `SourceIdPolicy { prefix, padWidth }`, an archive-layout policy, and a separate `BrowserProfile` at the composition root; each hotspot consumes only its narrow interface.

**Rationale**: Constitution VI — small, testable, swappable units; prevents the config seam from spreading as a large dependency through neutral modules and avoids a service locator.

**Alternatives**: inject one fat `Corpus` everywhere (rejected — omnibus dependency + service-locator smell).

## R4 — `SOURCE_LAYOUTS` retirement: characterization gate (empirical)

**Decision**: before deleting the map — (1) enumerate the 9 legacy Source fixtures; (2) snapshot every relevant `location.ts` output for them; (3) route them through the generic `deriveSourceLayout`; (4) compare **exact strings** incl. punctuation/capitalization/special names; (5) if any path is not generically reproducible, add a **validated, data-driven per-`Source` layout override** (against real Source IDs), never a hardcoded infrastructure map; overrides are exceptional.

**Rationale**: byte-identical archive paths are non-negotiable (existing masters/provenance live at those paths). A characterization snapshot makes the guarantee testable, not asserted.

**Alternatives**: assume generic reproduction (rejected — risks silent path drift); keep the map (rejected — the coupling we are removing).

## R5 — Global source-ID uniqueness via unique prefixes + collision validator

**Decision**: Source IDs are globally unique across all corpora; enforced by unique per-corpus prefixes and a repository-wide collision validator.

**Rationale**: bare references (`PB-P061`) must remain unambiguous; corpus-relative uniqueness would make a reference ambiguous without carrying the corpus id.

**Alternatives**: corpus-relative uniqueness (rejected — hazardous for existing bare references).

## R6 — `defaultSources` is deployment (BrowserProfile)

**Decision**: browser default sources live in a separate `BrowserProfile { corpus, defaultSources }`, derived at browser composition; not in the corpus identity manifest.

**Rationale**: a corpus may use many adapters while a deployment exposes a subset; conflating them couples identity to a UI/deployment concern. (`CORPUS_SOURCES` env already overrides.)

## R7 — Registries orthogonal

**Decision**: the corpus never owns `RepositoryAdapterRegistry` / `SourceQueryRegistry`; at composition it may validate referenced repositories ⊆ installed capabilities.

**Rationale**: registries describe installed capabilities; the corpus describes dataset identity. Keeping them separate avoids a service locator.

## R8 — No spec-2 domain fields now

**Decision**: `discoveryMechanism` / `dateNormalizer` are not declared in the spec-1 type; epic spec 2 introduces a separate capability config (or new schema version) shaped by its first real consumer (the first non-French subject).

**Rationale**: declaring them now forces Port Breton to name domain capabilities before the abstraction is understood, or admit placeholders.
