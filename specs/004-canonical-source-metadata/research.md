# Phase 0 Research: Canonical Source Metadata Model

Resolves the two `/speckit-plan`-deferred questions and the design/dependency decisions the plan depends on. Each entry: Decision · Rationale · Alternatives considered.

## R-001 — SSOT authoring direction (confirming the clarify decision)

**Decision**: Hybrid. The bibliographic **Source** (`bibliography/sources/PB-###.yml`) is hand-authored. Each **Repository Record** and its **asset roll-up** are *derived* by scanning the per-asset provenance the fetcher/object-store already writes; the derivation is keyed by `sourceId`.

**Rationale**: Bibliographic identity (canonical title, work-level IDs, work-vs-copy judgment) is editorial and cannot be reliably machine-derived; asset lists and per-copy provenance already exist as ground truth and would only drift if re-authored by hand. Matches the existing split: `source-registry.ts` hand-carries descriptive fields while the archive layout + provenance are derived from disk.

**Alternatives**: Fully authored (rejected — reintroduces the drift the feature removes); fully derived (rejected — cannot derive canonical bibliographic identity).

## R-002 — Reading human-authored YAML (`yaml` dependency)

**Decision**: Add the `yaml` package (npm `yaml`, MIT) as a runtime dependency, used **only to parse** the hand-authored Source SSOT. Generated views (CSV + the `PB-P00X.yml` stubs) are **hand-serialized** in fixed field order, reusing the deterministic approach already in `src/archive/provenance.ts` (single-line double-quoted scalars; fixed key order → byte-identical re-serialization).

**Rationale**: The SSOT is edited by humans, so it needs a real, forgiving parser; hand-rolling a YAML reader would be more code and more risk than a well-established 1-file dependency. Writing stays hand-serialized because determinism (FR-015) is easiest to guarantee with explicit field ordering — the project already proves this pattern for provenance. Parsed YAML is immediately narrowed by `bibliography/load.ts` validators (no `any` escapes the module boundary).

**Alternatives**: JSON SSOT (rejected — worse human ergonomics for editorial records; design specifies YAML and existing stubs are `.yml`); custom YAML reader (rejected — more code, more bugs than the dependency); `js-yaml` (viable; `yaml` chosen for its comment/round-trip fidelity should we later want to preserve authored comments).

## R-003 — Validation approach (schema + lint)

**Decision**: Hand-written TypeScript validators returning a structured `ValidationFinding[]` (never throwing for *content* problems; throwing only for unreadable/malformed files). `vocab.ts` holds the closed allowed-value sets. Referential integrity + identifier-leak checks live in `validate.ts`. No `zod`.

**Rationale**: The checks are relational (asset → repository → source) and cross-file, which is awkward to express in a single declarative schema; hand-written validators give precise, locating messages (SC-002/SC-007 require naming the offending identifier/orphan) and match the repo's fail-loud-but-explicit style without a new dependency. Distinguishing *findings* (reported, exit non-zero) from *malformed input* (thrown) mirrors the object-store contract's "absent vs error" split.

**Alternatives**: `zod` (rejected — good for shape, weak for cross-record referential integrity + custom locating messages; adds a dependency); JSON Schema (rejected — same relational limitation, plus a second schema language).

## R-004 — Identifier level classification

**Decision**: A single `identifiers.ts` defines `WorkLevelIdentifierType = 'isbn' | 'issn' | 'oclc'` and `CopyLevelIdentifierType = 'ark' | 'iiif-manifest' | 'scan-doi'`, plus `classifyIdentifier(type)` → `'work' | 'copy'`. Validation uses it to reject a copy-level id on a Source and a work-level id on a Repository Record (FR-007–FR-009). Unknown identifier types are a validation finding (fail loud), not silently accepted.

**Rationale**: Centralizing the level map makes the leak check (FR-018) a one-line lookup and gives one place to extend when a new identifier type appears (A-007: new types classify into the same two levels, never a third).

**Alternatives**: Inline string checks at each call site (rejected — duplicated, drift-prone).

## R-005 — Census reference mechanism for the Issue layer (deferred question A-003)

**Decision**: A serial's Repository Record references the existing census file by path convention `data/census/<sourceId>-<slug>.json` (the shape already in `src/model/census.ts` / `src/census/load.ts`). The Issue layer is **derived** from that census (issues, dates, page counts, arks) at load/validation time — not copied into the SSOT. The census remains authoritative for issue enumeration (SC-006).

**Rationale**: The census already exists, is built by `src/census/build.ts`, and carries exactly the issue enumeration needed (`totalIssues`, `issues[]` with `ark`/`date`/`label`/`pageCount`). Re-authoring or copying it would create a sixth representation (violates FR-014). Deriving keeps one source of truth for issue enumeration.

**Alternatives**: Embed issues in the Source YAML (rejected — duplicates the census, drift); a new census store (rejected — FR-014).

## R-006 — Per-view regeneration wiring (deferred question; migration mechanics)

**Decision**: `regenerate.ts` exposes one pure function per legacy view: `(sources: CanonicalModel) => string`. Each returns the exact file contents; the CLI `bib regenerate` writes them and `bib validate` re-runs them in-memory and diffs against the committed file to detect drift (SC-008). Field/column order is fixed and documented in `contracts/source-record.md`. `migrate.ts` performs the one-time fold (parse the 5 current representations → author initial `bibliography/sources/PB-###.yml`), then the same `regenerate.ts` produces the views. The migration explicitly re-adds PB-P001's SLQ Repository Record (currently absent from `source-registry.ts`, which only records `Gallica / BnF`).

**Rationale**: One generator per view, driven by the canonical model, guarantees the views can never disagree with the SSOT (they are a pure function of it) and makes drift a deterministic diff, not a heuristic. Reusing the same generators for migration and steady-state avoids two code paths.

**Alternatives**: Bidirectional sync (rejected — A-005, reintroduces drift); template engine (rejected — overkill for CSV + a small YAML stub; hand-serialization is already the house style).

## R-007 — Retirement of `src/archive/source-registry.ts`

**Decision**: `source-registry.ts`'s `sourceMeta()` is superseded by `bibliography/load.ts`. Callers migrate to the canonical loader; the singular `sourceArchive` field (the overwrite bug's origin) is removed. Retirement follows the existing `@deprecated` → importers-zero → delete discipline (the `check-deprecations` gate) rather than a hard cut, so no consumer breaks mid-migration.

**Rationale**: The registry is the concrete locus of the P1 bug; leaving it in place would keep a second, contradictory source-archive record. Staged retirement respects the repo's deprecation gate.

**Alternatives**: Hard delete immediately (rejected — breaks current importers before the SSOT is populated).

## Resolved unknowns summary

| Unknown | Status |
|---------|--------|
| SSOT direction | Resolved R-001 (hybrid) |
| YAML tooling | Resolved R-002 (`yaml` for read; hand-serialize writes) |
| Validation approach | Resolved R-003 (hand-written validators, no zod) |
| Identifier classification | Resolved R-004 (`identifiers.ts` level map) |
| Census reference (A-003) | Resolved R-005 (derive from existing census by path) |
| Regeneration + migration wiring | Resolved R-006 (one generator per view; reused for migrate) |
| Legacy registry disposition | Resolved R-007 (staged deprecation) |

No `NEEDS CLARIFICATION` remain.
