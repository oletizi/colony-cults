# Quickstart: validate Corpus Model Coherence

Proves the four decouplings + the clean-break cutover end-to-end on the real corpus (13 sources, 1 case, 0 threads). Reuses shipped `bib validate` / `bib coverage`.

## Prerequisites

- Per-session archive clone + `COLONY_ARCHIVE_ROOT` set (as for any `bib` run).
- Baseline: `npx tsx src/index.ts bib validate` clean; `bib coverage` shows the pre-cutover state.

## 1. Scope + resolution (US1, INV-1)

- A search-log entry `scope: { kind: work, id: PB-P001 }` is accepted; `bib coverage` shows it under the `work PB-P001` scope with a date.
- `scope: { kind: work, id: PB-P004 }` (PB-P004 is a source-group) → **fail loud** (kind/referent mismatch).

## 2. Clean-break cutover (US1, INV-2, SC-005)

- The one existing entry SRCH-0001 is rewritten `campaign: PB-P004` → `scope: { kind: work-bundle, id: PB-P004 }`.
- Re-introducing any `campaign:` key → the loader **throws** (hard error). `grep -c 'campaign:' bibliography/search-log.yml` is 0.

## 3. Works-only counting (US2, INV-4, SC-002)

- `bib coverage` evidence-class distribution over the 11 classified works + 2 source-groups shows **`unclassified 0`** (the 2 containers excluded).

## 4. Fetchable-work approval (US3, INV-3, SC-003)

- Approve PB-P002 (a standalone work) → it advances to `approved-for-acquisition`; acquire accepts it.
- Approve/acquire a source-group → **rejected loud** (container prohibition preserved).

## 5. Per-scope coverage (US4, INV-SCOPE, SC-004)

- `bib coverage` lists search history per resolved scope (case/thread/work-bundle/work); every persisted ScopeRef resolves (a dangling/mismatched ref fails the report loud).

## 6. Thread machinery defined, not populated (US5, INV-5)

- `bibliography/scopes.yml` empty (`[]`) → `bib validate` + `bib coverage` succeed (no thread required).
- Add a thread `{ id, name, description }` and tag a Source `threads: [id]` → validates; a `threads:` id absent from `scopes.yml` → **fail loud**.

## Definition of done

`bib validate` clean; `bib coverage` shows `unclassified 0` and per-scope search history; SRCH-0001 rewritten and zero `campaign:` keys remain; standalone-work approval works and container approval fails loud; the thread registry validates empty. All pre-existing data (source-groups, classified works, reconciled statuses) remains valid — no migration breakage (INV-6, SC-006).
