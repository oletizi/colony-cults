# Phase 0 Research: Page-range (excerpt) acquisition

All open questions were resolved during design (see `docs/superpowers/specs/2026-07-15-page-range-acquisition-design.md`) and verified against the codebase this session. No `NEEDS CLARIFICATION` remained.

## Decision 1 — Constrain the existing loop, do not add a parallel path

**Decision**: Add an optional `folios?: number[]` to the fetch context in `src/fetch/issue.ts`; when present, iterate that set instead of `for (let page = 1; page <= pageCount; page += 1)` (issue.ts:239). Everything else in the per-page pipeline (IIIF fetch, checksum, B2 master, per-page provenance) is untouched.

**Rationale**: The per-page pipeline is already folio-granular and shared by `fetchMonograph`/`fetchIssue`. The loop bound is the ONLY thing that assumes "whole document". Constraining it is minimal, reuses every integrity guarantee, and keeps the `--pages`-absent path byte-identical.

**Alternatives considered**: A dedicated `fetch-excerpt` verb + `excerpt` Source kind (rejected by operator scope — more surface, more model change); a one-off manual IIIF fetch bypassing the pipeline (rejected — violates faithful-tool-adoption + provenance guarantees).

## Decision 2 — Folios are IIIF folios (physical image ordinals), not printed page numbers

**Decision**: `--pages` values are IIIF folios — the `page` index the loop already passes to `iiifImageUrl(ark, page)` → `.../f{n}/...`. Mapping a printed page number to a folio is out of scope; the caller supplies confirmed folios (the pinpoint step, e.g. Gallica `ContentSearch`, returns them).

**Rationale**: The folio is the fetcher's native unit. Accepting printed pages would require a mapping layer (Gallica Pagination) and could silently fetch the wrong images when front-matter offsets the numbering. Folios are unambiguous.

**Alternatives considered**: Accept printed page numbers with a mapping step (rejected — scope + a silent-wrong-page failure mode).

## Decision 3 — Record intended extent as `RepositoryRecord.folios: number[]`

**Decision**: Add optional `folios?: number[]` to `RepositoryRecord` (`src/model/repository-record.ts`) with loader/serializer/validate round-trip. Absent on whole-document records (unchanged). It documents the committed excerpt extent; `--pages` is the fetch's source of truth.

**Rationale**: Without a recorded extent, a 3-of-200 acquisition reads as an incomplete whole-document fetch. The field makes the excerpt self-describing and lets a future `validate` assert held == declared.

**Alternatives considered**: A free-text note only (rejected — not machine-checkable); a range string like `"48-50"` (rejected — a normalized `number[]` is unambiguous and directly consumable).

## Decision 4 — Completeness is held == declared, not held == pageCount

**Decision**: An excerpt is complete when its held folios equal its declared `folios`, independent of the document's `pageCount`.

**Rationale**: Verified there is NO `held==pageCount` gate anywhere — `verifyIssueDir`/reconcile re-hash the files PRESENT; the manifest is a per-file integrity map. So nothing must be relaxed; the `folios` field simply makes intended extent explicit.

**Alternatives considered**: Introduce a document-completeness gate and exempt excerpts (rejected — the gate does not exist; adding one to then exempt it is pure complexity).

## Decision 5 — Dry-run + reconcile scope to the selected folios

**Decision**: `--dry-run --pages` scopes the size estimate (`dryRunDocument`/`estimateIssue`, `src/cli/fetch-shared.ts` + `src/fetch/estimate.ts`) to the selected folios. `reconcile` needs no change (verifies present files); with `folios` recorded, its summary can report "N/N declared folios in object store".

**Rationale**: A dry run must preview what will actually be fetched. Reconcile already verifies present files, so an excerpt verifies correctly with no change.

## Decision 6 — Monograph/document path only; periodical path is a usage error

**Decision**: `--pages` is honored on `fetch-source` (single-document/monograph path). On the periodical `fetch-issue` multi-issue path it is a usage error in v1 (operator-decided scope).

**Rationale**: The motivating case (a decision inside one fascicule) fetches a single document ark via `fetch-source`. Multi-issue page ranges have no coherent meaning without more design.
