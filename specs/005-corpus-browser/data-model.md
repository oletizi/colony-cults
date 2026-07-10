# Phase 1 Data Model: Corpus Browser

The browser's **view-model** — the normalized, in-memory shape the Astro site renders. It is derived at build time from the archive clone + bibliography SSOT; it is not persisted. Types live in `src/browser/model.ts`. Existing `@/model` types (`Source`, `Issue`, `Asset`, `RepositoryRecord`, provenance) are reused for the inputs; the view-model below is what the renderer consumes.

## Entities

### CorpusView

The whole browsable corpus for a build.

- `sources: SourceView[]` — one per source populated in v1 (PB-P001 only, but the shape holds many).

Validation: at least one source; every source resolvable end-to-end or the build throws.

### SourceView

- `sourceId: string` — canonical id, e.g. `PB-P001` (from the SSOT `sourceId`).
- `title: string` — canonical title (SSOT `titles[role=canonical]`).
- `kind: 'periodical'` — v1 shape (SSOT `kind`); the type is open to `'monograph' | 'source-group'` later (OQ-7 deferred).
- `ark: string` — the source's archival identifier (from the SSOT repository record / page sidecars) used by the `source-iiif` provider.
- `rights: string` — e.g. `public-domain`.
- `issues: IssueView[]` — ordered by date.

Validation: `ark` required when the active provider is `source-iiif`; `title` and `sourceId` required always.

### IssueView

- `issueId: string` — stable slug, derived from the issue directory name (e.g. `1879-08-15_bpt6k56068358`).
- `date: string` — ISO date (`1879-08-15`) parsed from the directory / sidecar.
- `sequence: number` — order within the source.
- `pages: PageView[]` — ordered by page number.
- `pageCount: number` — MUST equal the image count, the OCR form-feed segment count, and the `translation/pNNN.*` count, or the build throws (edge case: page-count mismatch).

### PageView

The unit the reading view renders.

- `pageId: string` — stable page identifier within the issue (e.g. `p001`).
- `folioId: string` — the image/view id (`f001`) — distinct from `pageId` though 1:1 for observed issues.
- `image: ImageDescriptor` — resolved by the active provider (below).
- `ocrFrench: string` — raw French OCR for this page (a form-feed segment of `issue.txt`); may be noisy.
- `correctedFrench: string | null` — corrected French (`translation/pNNN.fr.txt`) when present.
- `english: string` — English translation (`translation/pNNN.en.txt`).
- `provenance: ProvenanceRecord` — the provenance-rail facts (below).
- `ocrCondition: string | null` — a surfaced OCR-condition note (e.g. "Contraste insuffisant") when detected, so the reading view can frame noisy OCR.

Validation: `english` and `ocrFrench` required (throw if missing); `image` must resolve or throw; `provenance` fully populated or throw.

### ImageDescriptor

Provider-agnostic handle the viewer consumes (FR-012).

- `kind: 'iiif' | 'full-image'` — tile source vs single image.
- `url: string` — the IIIF info/image base (`iiif`) or the full-image URL (`full-image`).
- `width?: number` / `height?: number` — when known (for viewer sizing).

### ImageProviderConfig (discriminated union)

Selects how `ImageDescriptor`s are built (FR-011; DI, no inheritance).

- `{ kind: 'source-iiif' }` — build IIIF URLs from `SourceView.ark`.
- `{ kind: 'b2-cdn', cdnBase: string }` — build URLs from the archive `object_store` key + `cdnBase`.

Validation: the selected variant's required fields (e.g. `cdnBase`) MUST be present or the build throws — no fallback to the other provider (FR-013).

### ProvenanceRecord

The identifying facts rendered in the monospace provenance rail (FR-014), from the page sidecar + SSOT.

- `sourceId: string`
- `ark: string` — archival identifier / catalog ARK.
- `date: string` — issue date.
- `rights: string` — e.g. `public-domain`.
- `page: string` — page identifier.
- `sha256: string` — content hash from the sidecar.

Validation: all fields required per page; a missing field throws (SC-004: no page missing its provenance).

### SearchDocument

One per page, fed to the Pagefind index (per-page, both languages — FR-010/OQ-5).

- `pageId`, `issueId`, `sourceId` — identity + route target.
- `routeUrl: string` — the page reading-view URL.
- `french: string` — OCR (+ corrected French when present) for indexing.
- `english: string` — English translation for indexing.

## Relationships

```text
CorpusView 1───* SourceView 1───* IssueView 1───* PageView 1───1 ImageDescriptor
                                                          │
                                                          ├──1 ProvenanceRecord
                                                          └──1 SearchDocument
ImageProviderConfig ──(selects)──▶ how PageView.image is built
```

## Derivation & fail-loud rules (summary)

- **Page splitting**: `issue.txt` split on `\f` → N raw-OCR segments; N MUST equal image count and translation count (else throw with source/issue).
- **Translation pairing**: each `PageView` pairs `translation/pNNN.fr.txt` (→ `correctedFrench`) and `pNNN.en.txt` (→ `english`); a missing `english` throws.
- **Provider resolution**: `PageView.image` built by the active provider; missing provider config or missing per-source handle throws.
- **Provenance**: assembled from the page `.yml` sidecar (sha256, ark, rights, date) + SSOT; any missing field throws.
- **No fallbacks**: nowhere is a placeholder image, empty string, or default substituted for missing corpus data.
