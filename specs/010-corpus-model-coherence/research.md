# Phase 0 Research: Corpus Model Coherence

Resolves the design record's open questions + the remaining implementation unknowns. Each: Decision / Rationale / Alternatives. The load-bearing model decisions (D1–D8) are settled in the design record and the spec; this file resolves the residual build-shape unknowns.

## R1 — `bibliography/scopes.yml` shape (thread registry)

**Decision**: A YAML list of thread records, each `{ id, name, description }`. `id` is a stable kebab-case slug (unique across the file); `name` is a human label; `description` is a one-line scope statement. No member list, no other fields. An empty list (`[]`) is valid. Validation (fail loud): duplicate id; missing required field; unknown key.

**Rationale**: Mirrors the search-log's hand-authored, append-friendly YAML shape; identity + description is exactly what a cross-cutting thread needs to be referenced and reported (FR-010/011). No member list keeps membership single-sourced on the Source (D7).

**Alternatives**: threads as `kind: thread` Source records (rejected — conflates a topic with a work/container, the very overloading this feature removes); a member list on the thread (rejected — D7, no fact stored twice).

## R2 — Thread membership on the Source (`threads:`)

**Decision**: `threads?: string[]` on a Source — a list of thread ids. Reverse membership ("works in thread X") is **derived** at read time by scanning sources (as coverage already scans). Validation (fail loud): every id in `threads[]` MUST resolve to a `scopes.yml` entry; an unknown thread id is rejected. The field is optional and, this build, expected empty everywhere (no population).

**Rationale**: Follows the existing `partOf` precedent — relationships authored on the member, reverse derived — so the model gains no second write-site for the same fact (D7). Coverage's existing whole-corpus scan makes derivation free.

**Alternatives**: a bidirectional cache (rejected — a second representation to keep in sync; back-compat-shaped debt); membership only on the thread (rejected — D7).

## R3 — `ScopeRef` representation in `search-log.yml`

**Decision**: The search-log entry's target is a nested `scope:` map: `scope: { kind: <case|thread|work-bundle|work>, id: <string> }`, replacing the retired scalar `campaign:`. The loader parses **only** `scope:`; a `campaign:` key (or any unknown top-level key) is a **hard error** (fail loud). The single existing entry (SRCH-0001) is rewritten by hand from `campaign: PB-P004` to `scope: { kind: work-bundle, id: PB-P004 }`.

**Rationale**: A discriminated `{ kind, id }` is the minimal faithful serialization of `ScopeRef` (D1); rejecting `campaign:` is the clean break (D3, FR-013). One hand-authored entry means the cutover is a one-line edit, not a `bib migrate`.

**Alternatives**: a flat `scopeKind` + `scopeId` pair (rejected — less legible, easy to half-set); keep `campaign:` as an alias (rejected outright — the clean-breaks constraint; it recreates the coherence problem).

## R4 — Where `ScopeRef` resolution + `isFetchableWork` live

**Decision**: One new module `src/bibliography/scope.ts` exposes the `ScopeRef` discriminated union, `resolveScopeRef(ref, corpus)` (fail-loud kind/referent validation per D1), and `isFetchableWork(source)` (= `source.kind !== 'source-group'`). Consumers (search-log validation, coverage, the approve/acquire gate) inject/call these; no consumer re-implements the rules.

**Rationale**: Composition + single-source-of-truth (Principle VI). Kind/referent agreement and the fetchable predicate are each authored once and reused, so a mismatch cannot be interpreted two ways.

**Alternatives**: inline the checks per consumer (rejected — duplicated, drift-prone, the "stored twice" smell in logic form).

## R5 — Per-scope coverage rendering

**Decision**: `bib coverage` reports search history grouped **per resolved scope**, labeled by kind — e.g. `work-bundle PB-P004`, `work PB-P001`, `thread survivor-settlement`, `case port-breton`. Measured-closure is reported per scope and is **search-evidence-based for every kind** (D8) — a `work` scope's line shows its repository-copy search state, never "closed because acquired". The evidence-class distribution counts works only (D6).

**Rationale**: Makes the decoupled scopes legible (FR-009) without a UI; keeps closure honest (D8/FR-012).

**Alternatives**: keep the per-source-group-only view (rejected — strands the new work/case/thread scopes); infer closure from acquisition (rejected — D8).

## R6 — Cutover discipline (clean break, not migrate)

**Decision**: Every retired shape (`campaign:`) becomes a hard error the moment the new shape lands; the one affected data file is rewritten in the same change. No reader accepts both shapes at any point; no "transitional" window exists. This is a hand/scripted rewrite of committed data to canonical, explicitly NOT `bib migrate` (which rebuilds the SSOT from stale legacy CSV inputs and corrupts curation — TASK-8).

**Rationale**: Operator directive (FR-013) — transitional states mislead agents; back-compat is tech debt. The corpus is small enough that a clean rewrite is trivial.

**Alternatives**: accept-both-then-remove (rejected — the transitional state the directive forbids); a `bib migrate`-style rebuild (prohibited).
