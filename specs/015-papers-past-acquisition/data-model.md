# Phase 1 Data Model: Papers Past Acquisition Adapter

Typed entities and the model/vocabulary additions. No `any`/`as`/`@ts-ignore` (Principle VII). All additions extend existing types; none are migrated in place (INV-never-migrate).

## Vocabulary additions

- **`CopyLevelIdentifierType`** (`src/model/identifiers.ts`) — add `'papers-past'` to the union and to `COPY_LEVEL_TYPES`. The identifier `value` is the Papers Past article code (e.g. `HNS18840103.2.19.3`, the `oid`). A `CopyIdentifier` is `{ type: 'papers-past', value: <article-id> }`.
- **`RepositoryName`** (`src/repository/adapter.ts`) — add `'papers-past'` to the extensible union.
- **`IDENTIFIER_TYPE_REPOSITORY`** (`src/repository/registry.ts`) — add one row: `'papers-past' → 'papers-past'`. The registry then dispatches a `papers-past` copy to the new adapter; no other kind routes to it.

> **No `AcquiredAsset` role addition.** OCR text is out of scope as an acquired asset (clarified 2026-07-19 — the existing OCR/translation pipeline produces it from the held facsimile), so no `'ocr-text'` role is added. The only acquired assets are the `page-master` page-image segments, reusing the existing `page-master` role.

> **No `ResolvedRepositoryItem` contract change.** Rights evidence is carried via a `WeakMap<ResolvedRepositoryItem, RightsEvidence>` keyed by the resolved item — the shipped **Internet Archive** adapter's pattern (`src/repository/internet-archive/adapter.ts` + `rights.ts`) for a mechanical (non-LLM) adapter whose `RightsEvidence.rightsRaw` has no home on the typed contract. The required `metadata: GroundedExtraction<MuseumItemFields>` is `{ date }` only, where `date` is a mechanically-built `GroundedField`: per the documented IA convention, `GroundedField` hard-codes `provenance.modelAssisted: true` (it was authored for LLM prose), so `engine`/`model` are named to the mechanical parse, NOT a model call. No new shared field is introduced.

## ResolvedArticle (adapter `resolve` output — a `ResolvedRepositoryItem`)

| Field | Type | Notes |
|-------|------|-------|
| `repository` | `'papers-past'` | |
| `identifiers` | `CopyIdentifier[]` | `[{ type: 'papers-past', value: <article-id> }]` — the `oid`, mechanically parsed; fail-loud if absent |
| `sourceUrl` | `string` | the article page URL |
| `title` | `string` | the `h3` heading text, mechanically derived (non-empty) — never an LLM field |
| `assetLocators` | `AssetLocator[]` | one per `/imageserver/...&area=<n>` segment: `{ url, role: 'page-master', sequence: <area> }` |
| `metadata` | `GroundedExtraction<MuseumItemFields>` | `{ date }` only — a mechanically-built `GroundedField` for the article date (IA `modelAssisted:true` convention; `engine`/`model` name the mechanical parse). The verbatim rights statement + jurisdiction are carried separately via a `WeakMap<ResolvedRepositoryItem, RightsEvidence>` (IA pattern), NOT via `statedCredit`. Reuses the existing carrier — no contract change. |

The mechanical parse (`parse.ts`) MAY additionally expose the on-page OCR text as an optional convenience field of its own pure return type (`ocrText?: string`), but it is NOT propagated to `acquire` and NOT stored as an asset (OCR out of scope; clarified 2026-07-19).

## RightsEvidence (NZ) — adapter `collectRightsEvidence` output

`{ rightsRaw: "No known copyright (New Zealand)" (verbatim, plus the NLNZ explanatory sentence), jurisdiction: 'NZ', date: <grounded article date> }` — **no `rightsStatus`** (evidence, not verdict; INV — the operator authors the judgment).

## RightsAssessment (operator-authored, gates acquire) — unchanged type

`{ rightsRaw?, rightsStatus: 'public-domain', rightsBasis: "Papers Past 'No known copyright (New Zealand)'; NZ newspaper, crown copyright expired", rightsJurisdiction: 'NZ', assessedBy: 'operator', assessedAt }` on the `papers-past` `RepositoryRecord`. `acquire` refuses unless `rightsStatus === 'public-domain'`.

## AcquiredAsset (acquire output)

Per page-image segment: `{ sourceUrl, mediaType: 'image/gif', objectStoreKey: 'archive/papers-past/<article-id>/<sha256>.gif', checksum: <sha256 hex>, byteLength, provenancePath, role: 'page-master', sequence: <area> }`.

(No OCR companion asset — OCR is out of scope for this adapter; clarified 2026-07-19.)

## Object-store key layout

`archive/papers-past/<article-id>/<sha256>.gif` — deterministic, content-addressed (idempotent by key + checksum). `<article-id>` is the lowercased/sanitized `oid`. Provenance `.yml` mirrors each object key (canonical `writeProvenance`).

## PapersPastCopy (the corpus member's copy record)

A `RepositoryRecord` with `sourceArchive: 'Papers Past'`, `identifiers: [{ type: 'papers-past', value: <article-id> }]`, `sourceUrl: <article page URL>` (catalogue/detail, not identity), an operator `rightsAssessment`, and (post-acquire) `assets: AcquiredAsset[]` (the page-masters) + `retrievedAt` + `metadataSnapshot`. Its `Source` is kind `periodical`, `case: port-breton`, a member (`partOf`) of the NZ-press source-group, `status: approved-for-acquisition`.

## State transitions (one acquire pass)

```
resolve (browser read → persist raw → parse) → ResolvedArticle
  → collectRightsEvidence → RightsEvidence (no verdict)
  → [operator authors RightsAssessment: public-domain]
  → acquire:
       fail-closed gate (rightsStatus === 'public-domain', else THROW, 0 side effects)
       dry-run → empty assets, no write
       (browser session opened once, kept open across page read + all byte fetches)
       for each page-image segment: browserSession.fetchBytes (WAF-cleared; guarded: valid GIF or THROW) → sha256
         → objectStore.head(key) present+match? skip : put(key, bytes)   [idempotent]
       remote-change / identity mismatch → THROW
       → AcquisitionResult { assets, metadataSnapshot, complete }
  → persistence records assets + provenance on the record
```
