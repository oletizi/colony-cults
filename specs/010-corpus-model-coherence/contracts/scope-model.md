# Contract: the Scope model + its touchpoints

The single new seam is `ScopeRef` resolution + `isFetchableWork`; everything else is a surgical change to shipped `bib` behavior. All errors are **fail-loud** (Principle V); no shape has a transitional/alias form (FR-013).

## `ScopeRef` + resolution (`src/bibliography/scope.ts`)

```
type ScopeRef =
  | { kind: 'case';        id: string }
  | { kind: 'thread';      id: string }
  | { kind: 'work-bundle'; id: SourceId }
  | { kind: 'work';        id: SourceId };

resolveScopeRef(ref: ScopeRef, corpus: Corpus): ResolvedScope   // throws on any invariant breach
isFetchableWork(source: Source): boolean                        // = source.kind !== 'source-group'
```

- `resolveScopeRef` throws unless `id` resolves **under `ref.kind`** (see data-model table). `{kind:work, id:<a source-group>}` throws; `{kind:work-bundle, id:<a non-group>}` throws; `{kind:thread, id:<absent from scopes.yml>}` throws; `{kind:case, id:!='port-breton'}` throws.
- `isFetchableWork` is the single predicate every approval/acquisition/counting consumer calls — never re-derived inline.

## Thread registry (`src/bibliography/scopes-registry.ts` + `bibliography/scopes.yml`)

- Loads a YAML list of `{ id, name, description }`; an empty list is valid.
- Fail loud on: duplicate `id`, missing required field, unknown key.
- Owns identity + description only — **no member list**.

## Search-log cutover (`search-log.ts` + `validate-search-log.ts`)

- An entry targets `scope: ScopeRef`. The loader parses **only** `scope:`.
- **INV-CUT**: a `campaign:` key (or unknown top-level key) is a **hard error** — never a tolerated alias or silently-ignored key.
- Each entry's `scope` MUST `resolveScopeRef` or validation fails loud.

## Approval / acquisition gate (source-group acquisition verbs)

- **INV-APPROVE**: `approved-for-acquisition` and the approve path apply only where `isFetchableWork(source)` is true. Approving or acquiring a `source-group` (work-bundle) is **rejected loud** — the container prohibition is preserved. Approval is independent of group membership.

## Coverage (`coverage/*`)

- **INV-COUNT**: the evidence-class distribution counts works only (`isFetchableWork`); a container is never `unclassified` and never a work.
- **INV-SCOPE**: search history + measured-closure are reported **per resolved ScopeRef** (labeled by kind); every persisted ref resolves or the report fails loud.
- **INV-CLOSURE**: measured closure is search-evidence-based for every scope kind; acquisition alone never closes a scope.

## Assertable invariants (test targets)

- **INV-1**: `resolveScopeRef` throws on a kind/referent mismatch (each of the four kinds) — no ref is silently reinterpreted.
- **INV-2**: the search-log loader throws on a `campaign:` key (clean break) and accepts a well-formed `scope:` entry.
- **INV-3**: `isFetchableWork` is false for `kind: source-group` and true otherwise; approve/acquire rejects a container loud.
- **INV-4**: the evidence-class distribution over the current corpus (11 works + 2 groups) yields `unclassified 0` with the 2 groups excluded.
- **INV-5**: a Source `threads: [id]` with `id` absent from `scopes.yml` fails validation; an empty registry + no `threads` validates clean.
- **INV-6**: `bib validate` is clean after the SRCH-0001 rewrite and all pre-existing data remains valid (no migration breakage).
