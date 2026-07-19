# Phase 1 Data Model: Papers Past Acquisition Adapter

Typed entities and the model/vocabulary additions. No `any`/`as`/`@ts-ignore` (Principle VII). All additions extend existing types; none are migrated in place (INV-never-migrate).

## Vocabulary additions

- **`CopyLevelIdentifierType`** (`src/model/identifiers.ts`) — add `'papers-past'` to the union and to `COPY_LEVEL_TYPES`. The identifier `value` is the Papers Past article code (e.g. `HNS18840103.2.19.3`, the `oid`). A `CopyIdentifier` is `{ type: 'papers-past', value: <article-id> }`.
- **`RepositoryName`** (`src/repository/adapter.ts`) — add `'papers-past'` to the extensible union.
- **`IDENTIFIER_TYPE_REPOSITORY`** (`src/repository/registry.ts`) — add one row: `'papers-past' → 'papers-past'`. The registry then dispatches a `papers-past` copy to the new adapter; no other kind routes to it.
- **`AcquiredAsset` role** (`src/model/acquired-asset.ts`) — add `'ocr-text'` to the role union (alongside `page-master`, `primary`, …). Used for the article's OCR `.txt` companion.

## ResolvedArticle (adapter `resolve` output — a `ResolvedRepositoryItem`)

| Field | Type | Notes |
|-------|------|-------|
| `repository` | `'papers-past'` | |
| `identifiers` | `CopyIdentifier[]` | `[{ type: 'papers-past', value: <article-id> }]` — the `oid`, mechanically parsed; fail-loud if absent |
| `sourceUrl` | `string` | the article page URL |
| `title` | `string` | the `h3` heading text, mechanically derived (non-empty) — never an LLM field |
| `assetLocators` | `AssetLocator[]` | one per `/imageserver/...&area=<n>` segment: `{ url, role: 'page-master', sequence: <area> }` |
| `metadata` | grounded extraction | newspaper, date, page (from the breadcrumb/heading); the OCR text and rights statement carried alongside for `collectRightsEvidence`/companion write |

## RightsEvidence (NZ) — adapter `collectRightsEvidence` output

`{ rightsRaw: "No known copyright (New Zealand)" (verbatim, plus the NLNZ explanatory sentence), jurisdiction: 'NZ', date: <grounded article date> }` — **no `rightsStatus`** (evidence, not verdict; INV — the operator authors the judgment).

## RightsAssessment (operator-authored, gates acquire) — unchanged type

`{ rightsRaw?, rightsStatus: 'public-domain', rightsBasis: "Papers Past 'No known copyright (New Zealand)'; NZ newspaper, crown copyright expired", rightsJurisdiction: 'NZ', assessedBy: 'operator', assessedAt }` on the `papers-past` `RepositoryRecord`. `acquire` refuses unless `rightsStatus === 'public-domain'`.

## AcquiredAsset (acquire output)

Per page-image segment: `{ sourceUrl, mediaType: 'image/gif', objectStoreKey: 'archive/papers-past/<article-id>/<sha256>.gif', checksum: <sha256 hex>, byteLength, provenancePath, role: 'page-master', sequence: <area> }`.

OCR companion: `{ sourceUrl: <article page URL>, mediaType: 'text/plain', objectStoreKey: 'archive/papers-past/<article-id>/<sha256>.txt', checksum, byteLength, provenancePath, role: 'ocr-text' }`.

## Object-store key layout

`archive/papers-past/<article-id>/<sha256>.<ext>` — deterministic, content-addressed (idempotent by key + checksum). `<article-id>` is the lowercased/sanitized `oid`; `<ext>` is `gif` for page-masters, `txt` for the OCR companion. Provenance `.yml` mirrors each object key (canonical `writeProvenance`).

## PapersPastCopy (the corpus member's copy record)

A `RepositoryRecord` with `sourceArchive: 'Papers Past'`, `identifiers: [{ type: 'papers-past', value: <article-id> }]`, `sourceUrl: <article page URL>` (catalogue/detail, not identity), an operator `rightsAssessment`, and (post-acquire) `assets: AcquiredAsset[]` (the page-masters + the ocr-text companion) + `retrievedAt` + `metadataSnapshot`. Its `Source` is kind `periodical`, `case: port-breton`, a member (`partOf`) of the NZ-press source-group, `status: approved-for-acquisition`.

## State transitions (one acquire pass)

```
resolve (browser read → persist raw → parse) → ResolvedArticle
  → collectRightsEvidence → RightsEvidence (no verdict)
  → [operator authors RightsAssessment: public-domain]
  → acquire:
       fail-closed gate (rightsStatus === 'public-domain', else THROW, 0 side effects)
       dry-run → empty assets, no write
       for each page-image segment: getBytes (guarded: valid image or THROW) → sha256
         → objectStore.head(key) present+match? skip : put(key, bytes)   [idempotent]
       write OCR .txt companion (getText already in hand from resolve) → sha256 → put
       remote-change / identity mismatch → THROW
       → AcquisitionResult { assets, metadataSnapshot, complete }
  → persistence records assets + provenance on the record (+ companions in the archive clone)
```
