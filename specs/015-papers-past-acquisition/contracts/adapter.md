# Contract: PapersPastAdapter (RepositoryAdapter)

Implements the existing `RepositoryAdapter` interface (`src/repository/adapter.ts`). Constructor-injected, unit-testable with no network/host.

## Construction

```ts
interface PapersPastAdapterDeps {
  browserSession: BrowserSession;   // spec-014; clears the Incapsula WAF; performs BOTH the page read
                                    //   (navigate) AND the image byte fetch (fetchBytes, inside the same
                                    //   WAF-cleared context — research R1 CONFIRMED the /imageserver/ CDN
                                    //   is WAF-gated too); injected fake in tests
  objectStore?: ObjectStore;        // required only for acquire (resolve-only needs no B2 creds)
  now?: () => string;               // injected clock (ISO timestamp; mirrors the museum adapter's `() => string`)
}
class PapersPastAdapter implements RepositoryAdapter {
  readonly repository = 'papers-past';
  constructor(deps: PapersPastAdapterDeps) { ... }
}
```

## `resolve(locator, ctx): Promise<ResolvedRepositoryItem>`

- Navigate the article page (`https://paperspast.natlib.govt.nz/newspapers/<article-id>`) via `browserSession`; **persist the raw page before parsing** (persist-before-analysis).
- Mechanically parse: `oid`/article-id (fail-loud if absent — no fabrication), `h3` title (non-empty), the `/imageserver/...&area=<n>` image URLs as sequenced `assetLocators` (fail-loud if none), the newspaper/date/page metadata, the "No known copyright (New Zealand)" rights block, and the OPTIONAL `#text-tab` OCR text (`ParsedArticle.ocrText?`; absent → undefined, never fabricated — out of scope as an asset).
- Returns `{ repository, identifiers:[{type:'papers-past',value}], sourceUrl, title, assetLocators, metadata }`. `metadata` = `{ date }` (a mechanically-built `GroundedField`, IA `modelAssisted:true` convention — `engine`/`model` name the mechanical parse). The verbatim `rightsRaw` + jurisdiction are stashed in a `WeakMap<ResolvedRepositoryItem, RightsEvidence>` keyed by the returned item (IA pattern) for `collectRightsEvidence` to read back — no shared-contract change. The optional OCR text is NOT carried on the resolved item.

## `collectRightsEvidence(item): Promise<RightsEvidence>`

- Returns the `RightsEvidence` cached in the `WeakMap` during `resolve` (IA pattern): `{ rightsRaw: <verbatim NLNZ statement>, jurisdiction:'NZ', date:<grounded article date> }`. **No `rightsStatus`.** Fails loud if `item` is not one this adapter's own `resolve` returned (no re-parse, no fabrication).

## `acquire(record, ctx): Promise<AcquisitionResult>`

1. **Fail-closed gate:** throw unless `record.rightsAssessment?.rightsStatus === 'public-domain'` — BEFORE any fetch or object-store call (0 side effects on refuse).
2. `ctx.dryRun` → return empty assets, no `objectStore` write, no record mutation.
3. Re-resolve (or use the passed record's locators); **identity guard**: the resolved `oid` MUST match the record identifier, else throw (remote change).
4. Open the browser session ONCE and keep it open across the page read AND every image byte fetch (same WAF-cleared context). For each image segment (in `area` order): `browserSession.fetchBytes(url)` (the WAF-cleared in-page fetch — research R1 CONFIRMED the stateless client is WAF-blocked) → **image-validity guard** (GIF magic-byte sniff; a challenge page or non-image → throw) → `sha256OfBytes` → key `archive/papers-past/<id>/<sha256>.gif` → `objectStore.head(key)`: if present with matching checksum skip (idempotent) else `objectStore.put(key, bytes, {sha256, contentType:'image/gif'})`. Build `AcquiredAsset{role:'page-master', sequence:area}`.
5. Return `{ repositoryRecordId, assets:[…page-masters], metadataSnapshot, complete:true }`. (No OCR companion asset — OCR is out of scope; the existing OCR/translation pipeline produces it from the held facsimile. Clarified 2026-07-19.)

## Invariants

- No fabrication (resolve fails loud on a missing id/asset).
- Rights fail-closed (no mirror without an operator public-domain assessment).
- Idempotent by object key + checksum; remote change fails loud.
- Never mirrors a non-image/challenge response as a facsimile (image-validity guard).
- Exercised in tests only via injected fakes; never the network / real host / real object store.
