# Phase 1 Data Model: Corpus Model Coherence

Extends the shipped `canonical-source-metadata` + `corpus-coverage-audit` model. Existing types (Source, RepositoryRecord, SearchLogEntry) are reused; the changes below are surgical. **No migration** — existing on-disk data is reinterpreted, and the one legacy search-log entry is rewritten by hand (clean break).

## ScopeRef (new — a discriminated reference, NOT a persisted entity)

```
type ScopeRef =
  | { kind: 'case';        id: string }   // id === 'port-breton'
  | { kind: 'thread';      id: string }   // id ∈ bibliography/scopes.yml
  | { kind: 'work-bundle'; id: SourceId } // id → a kind:'source-group' Source
  | { kind: 'work';        id: SourceId } // id → a kind != 'source-group' Source
```

`resolveScopeRef(ref, corpus)` validates **fail-loud** that `id` resolves **under the declared `kind`**:

| kind | resolves to | fail-loud when |
|---|---|---|
| `case` | the stable slug `port-breton` | id != `port-breton` |
| `thread` | an entry in `bibliography/scopes.yml` | id absent from the registry |
| `work-bundle` | a `kind: source-group` Source | id missing, or the Source is not a source-group |
| `work` | a fetchable Source (`kind != source-group`) | id missing, or the Source IS a source-group |

A ScopeRef that does not resolve under its kind (e.g. `{ kind: work, id: PB-P004 }` where PB-P004 is a source-group) is **rejected loud** — kind/referent agreement is checked, never assumed.

## Thread registry — `bibliography/scopes.yml` (new)

A YAML list; each entry:

| Field | Type | Notes |
|---|---|---|
| `id` | string | stable kebab-case slug, unique across the file |
| `name` | string | human label |
| `description` | string | one-line scope statement |

Owns thread **identity + description only** — never a member list (D7). An empty list is valid; **this build populates none** (FR-011).

## Source (existing — extended)

| Field | Type | Notes |
|---|---|---|
| `threads` | string[] (optional) | thread ids this work belongs to (many-to-many). Each MUST resolve to a `scopes.yml` entry (fail loud). Authored on the Source; reverse membership derived (D7 / partOf precedent). Expected empty this build. |

The `work` vs `work-bundle` distinction is the existing `kind`: `kind == 'source-group'` → a work-bundle (container); anything else → a fetchable work. `isFetchableWork(source) := source.kind !== 'source-group'`.

## SearchLogEntry (existing — cut over)

| Field | Type | Notes |
|---|---|---|
| `scope` | ScopeRef | REPLACES the retired `campaign` scalar. `{ kind, id }`, validated per ScopeRef resolution. |
| `id`, `date`, `repository`, `scope`, `coverage` | (required) | `remainingQuestions`, `notes` optional (unchanged). |

The loader reads **only** `scope:`; a `campaign:` key is a **hard error** (fail loud) — no dual-schema. The one existing entry SRCH-0001 is rewritten `campaign: PB-P004` → `scope: { kind: work-bundle, id: PB-P004 }`.

## Coverage projections (existing — changed)

- **Evidence-class distribution**: counts **works only** — Sources with `isFetchableWork` true; `kind: source-group` excluded (never `unclassified`, never a work) (D6/FR-008).
- **Search history**: grouped **per resolved ScopeRef**, labeled by kind (D6/FR-009).
- **Measured closure**: explicit + search-evidence-based **per scope kind** — never inferred from acquisition (D8/FR-012).

## Invariants (fail loud)

- Every persisted `ScopeRef` resolves **under its declared kind**, or the read fails loud (FR-002).
- A `campaign:` key anywhere in the search-log after cutover is a hard error (FR-004, clean break).
- Approval / acquisition applies only where `isFetchableWork(source)` is true; a source-group is rejected loud (FR-007).
- Every `threads[]` id on a Source resolves to a `scopes.yml` entry (FR-010).
- The evidence-class distribution never counts a container (FR-008).
- No transitional/back-compat representation exists for any changed shape (FR-013).
