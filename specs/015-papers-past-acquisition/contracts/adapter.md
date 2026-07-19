# Contract: PapersPastAdapter (RepositoryAdapter)

Implements the existing `RepositoryAdapter` interface (`src/repository/adapter.ts`). Constructor-injected, unit-testable with no network/host.

## Construction

```ts
interface PapersPastAdapterDeps {
  browserSession: BrowserSession;   // spec-014; clears the Incapsula WAF; injected fake in tests
  byteFetch: { getBytes(url: string): Promise<Uint8Array | Buffer> };  // polite HttpClient; fake in tests
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
- Returns `{ repository, identifiers:[{type:'papers-past',value}], sourceUrl, title, assetLocators, metadata }`. `metadata` reuses the existing `GroundedExtraction<MuseumItemFields>` carrier built mechanically (`date` = article date, `statedCredit` = verbatim rights statement); the optional OCR text is NOT carried on the resolved item.

## `collectRightsEvidence(item): Promise<RightsEvidence>`

- Returns `{ rightsRaw: <verbatim NLNZ statement>, jurisdiction:'NZ', date:<grounded article date> }`. **No `rightsStatus`.**

## `acquire(record, ctx): Promise<AcquisitionResult>`

1. **Fail-closed gate:** throw unless `record.rightsAssessment?.rightsStatus === 'public-domain'` — BEFORE any fetch or object-store call (0 side effects on refuse).
2. `ctx.dryRun` → return empty assets, no `objectStore` write, no record mutation.
3. Re-resolve (or use the passed record's locators); **identity guard**: the resolved `oid` MUST match the record identifier, else throw (remote change).
4. For each image segment (in `area` order): `byteFetch.getBytes(url)` → **image-validity guard** (magic-byte/content sniff; a challenge page or non-image → throw) → `sha256OfBytes` → key `archive/papers-past/<id>/<sha256>.gif` → `objectStore.head(key)`: if present with matching checksum skip (idempotent) else `objectStore.put(key, bytes, {sha256, contentType:'image/gif'})`. Build `AcquiredAsset{role:'page-master', sequence:area}`.
5. Return `{ repositoryRecordId, assets:[…page-masters], metadataSnapshot, complete:true }`. (No OCR companion asset — OCR is out of scope; the existing OCR/translation pipeline produces it from the held facsimile. Clarified 2026-07-19.)

## Invariants

- No fabrication (resolve fails loud on a missing id/asset).
- Rights fail-closed (no mirror without an operator public-domain assessment).
- Idempotent by object key + checksum; remote change fails loud.
- Never mirrors a non-image/challenge response as a facsimile (image-validity guard).
- Exercised in tests only via injected fakes; never the network / real host / real object store.
