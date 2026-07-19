# Design: Papers Past acquisition adapter (MVP)

**Date:** 2026-07-18
**Status:** approved (brainstorming), pending Spec Kit authoring via `/stack-control:define`
**Motivating find:** SRCH-0018/0019 — the de Rays affair yields 695 discrete, public-domain, on-topic Papers Past (NLNZ) newspaper articles; one validated end-to-end (HNS18840103.2.19.3, "CONVICTION OF MARQUIS DE RAYS", explicitly "No known copyright (New Zealand)").

## Goal / scope (MVP)

Add a `RepositoryAdapter` for **Papers Past** so `bib acquire` can mirror **one** discrete public-domain Papers Past newspaper article — its **page-image facsimile(s) + OCR text** — into the corpus archive + B2, end-to-end, parallel to the Gallica / New Italy Museum / Internet Archive adapters.

Out of scope (follow-ons): batch acquisition of many articles; a deduplicated discrete-item census of the 695; whole-page / whole-issue acquisition; the US (Chronicling America) and Italian (Camera dei Deputati) axes.

## Acquired master

Page-image scan(s) of the article as the master asset(s) (`role: page-master`, sequenced) **plus** the article's OCR text captured alongside as a searchable companion. The page-image facsimile is the authoritative primary-source artifact; the OCR is a machine transcription (the source page itself warns it "may contain errors").

## Fetch mechanism — hybrid

- **Article-page read** (HTML → title, image URLs, OCR text, rights statement, metadata): via the **spec-014 real-browser `BrowserSession`**, which clears the Incapsula WAF that blocks the stateless `HttpClient`. Persist-before-analysis holds (the client saves the raw page first).
- **Image-byte fetch**: via the polite `HttpClient` (the acquire pipeline's client), consistent with the existing adapters and the `fetching-online-sources` skill's bulk-acquisition carve-out.
- **Research-phase check (blocking):** verify the Papers Past image-CDN URLs are reachable statelessly. If Incapsula gates them too, extend the `BrowserSession` with a byte-fetch and use the browser for images as well (all-browser fallback).

## Model additions

- `papers-past` → `CopyLevelIdentifierType` + `COPY_LEVEL_TYPES` (`src/model/identifiers.ts`). Identifier value = the Papers Past article code.
- `'papers-past'` → `RepositoryName` (`src/repository/adapter.ts`).
- One dispatch row in `IDENTIFIER_TYPE_REPOSITORY` (`src/repository/registry.ts`): `papers-past` → the new adapter.

## The adapter (`src/repository/papers-past/`, modeling the museum adapter)

- `resolve(locator)` — `BrowserSession` navigate the article page → persist raw HTML → mechanical parse: title (`h3`), page-image asset URLs, OCR text (`#text-tab`), newspaper/date/page, rights statement. Returns `ResolvedRepositoryItem` (identifiers, `assetLocators` = the image URLs, mechanical `title`, metadata). Fail-loud if the article code / images are absent.
- `collectRightsEvidence(item)` — map "No known copyright (New Zealand)" verbatim into `RightsEvidence.rightsRaw` + `jurisdiction: NZ` + grounded date. **No verdict** (evidence only, per INV — the operator authors the judgment).
- `acquire(record, ctx)` — fail-closed unless `record.rightsAssessment?.rightsStatus === 'public-domain'`; `dryRun` → empty assets, no B2 write; fetch each page-image via `HttpClient` → `sha256OfBytes` → idempotent `objectStore.put` under `archive/papers-past/<id>/<sha256>.<ext>` (`role: page-master`, sequenced); persist the OCR text as a companion (new `ocr-text` asset role OR in the metadata snapshot — settle in spec); remote-change fail-loud; return `AcquisitionResult`.

## Rights flow

Adapter proposes evidence only. The operator authors a `RightsAssessment` on the record — `rightsStatus: 'public-domain'`, `rightsBasis: "Papers Past 'No known copyright (New Zealand)'; NZ newspaper pre-1890s, crown copyright expired"`, `rightsJurisdiction: 'NZ'`, `assessedBy: 'operator'` — via `bib rights-assess`. That gates `acquire`, exactly as the museum/IA adapters.

## Corpus member

A new `Source` for the article (kind `periodical`, `case: port-breton`) + its `papers-past` `RepositoryRecord` on disk under `bibliography/sources/`. Made acquirable. **Open point (settle in spec):** `bib acquire` operates on a source-group member with `status: approved-for-acquisition` — the article either joins a source-group or uses the standalone-source approval path (backlog TASK-27).

## CLI wiring

`buildPapersPastAdapterForMember` (mirror `src/cli/bib-acquire-museum.ts`) + wire into `runAcquireCli` (`src/cli/bib-sourcegroup-acquire.ts`) and the `bib inventory` repository allowlist.

## Testing

Unit tests with a fake `BrowserSession` + fake `HttpClient` (`{getText,getBytes}`) + fake `ObjectStore`: resolve-from-fixture-HTML; NZ-rights-evidence mapping; `acquire` fail-closed gate; idempotency by object key + checksum; dry-run writes nothing. An env-gated end-to-end acquisition test (real browser + real B2, behind a flag).

## Points to settle in the spec's research phase

1. Is the Papers Past image CDN reachable via the stateless `HttpClient`, or WAF-gated (→ browser byte-fetch)?
2. OCR-text storage: a new `ocr-text` `AcquiredAsset` role vs the metadata snapshot.
3. Member acquirability: source-group membership vs the standalone-source approval path (TASK-27).

## Governance

Article-page reads use the governed `BrowserSession` (fetching-online-sources compliant, no fallback). Image-byte fetches use the acquire pipeline's `HttpClient` — the shipped, separately-Principle-XII-governed bulk-acquisition path. Any live reconnaissance during the build routes through `bib query-source`.
