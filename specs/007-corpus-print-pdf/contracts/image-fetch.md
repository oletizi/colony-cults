# Contract: Image byte fetch

Fetches print-resolution page-image bytes and verifies integrity. Behind an injected interface so
unit tests use an in-memory fake and never touch the network.

```ts
// src/pdf/images/fetch.ts
export interface ImageByteSource {
  readonly kind: 'b2-cdn' | 'source-iiif';
  fetch(page: ImageRequest): Promise<FetchedImage>;
}
export interface ImageRequest { folioId: string; ark: string | null; objectStoreKey: string; sha256: string; }
export interface FetchedImage { bytesPath: string; sha256: string; width: number | null; height: number | null; }

export function makeB2ImageSource(store: ObjectStore): ImageByteSource;      // @/archive S3ObjectStore.get(key)
export function makeIiifImageSource(fetchFn: FetchFn): ImageByteSource;      // <ark>/<folio>/full/max/0/default.jpg
```

## Guarantees

- **G-1 (integrity)**: the returned `FetchedImage.sha256` equals the recorded `ImageRequest.sha256`;
  a mismatch throws naming the folio and both hashes (Principle III). No unverified bytes are embedded.
- **G-2 (primary = B2 masters)**: `makeB2ImageSource` retrieves the master via `ObjectStore.get(objectStoreKey)`;
  a null/empty key or a store miss throws naming the key (FR-008, FR-009).
- **G-3 (alternate = IIIF full-size)**: `makeIiifImageSource` requests the IIIF Image API **full-size**
  raster (`full/max`), not tiles; a missing ark or a non-200 response throws naming the folio.
- **G-4 (no credential leak)**: credentials come only from `resolveObjectStoreConfig`; no secret is
  written to `bytesPath`, returned, or logged (browser G-5 parity).
- **G-5 (fake-able)**: both constructors take their I/O dependency by injection, so an in-memory
  `ObjectStore` / `FetchFn` fake drives the full contract offline in unit tests.

**Fixture**: `tests/unit/pdf/image-fetch.test.ts` — in-memory `ObjectStore` with a known blob asserts
G-1 (match + mismatch throw) and G-2; a stub `FetchFn` asserts G-3.
