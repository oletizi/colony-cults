# Contract: ImageSourceProvider

The single interface through which every page image URL is built. Two implementations, selected by config (DI). The viewer never knows which one is active (FR-012).

## Interface (`src/browser/providers/provider.ts`)

```ts
export interface ImageSourceProvider {
  readonly kind: 'source-iiif' | 'b2-cdn';
  // Resolve the viewer-ready descriptor for one page. Throws (never returns a
  // placeholder) when the page's handle or the provider config is missing.
  resolve(page: PageInput): ImageDescriptor;
}

export type ImageProviderConfig =
  | { kind: 'source-iiif' }
  | { kind: 'b2-cdn'; cdnBase: string };

// Factory selects the implementation; throws on missing required config.
export function makeProvider(config: ImageProviderConfig): ImageSourceProvider;
```

`PageInput` carries what both providers may need: the source `ark`, the page `folioId` (`fNNN`), and the archive `object_store` key for the page image.

## Behavior

| Provider | Builds URL from | `ImageDescriptor.kind` |
|----------|-----------------|------------------------|
| `source-iiif` | source `ark` + `folioId` → IIIF image/info URL (e.g. Gallica `…/iiif/ark:/…/fN/…`) | `iiif` |
| `b2-cdn` | `object_store` key + `cdnBase` → full-image URL | `full-image` |

## Guarantees (testable)

- **G-1**: `makeProvider({ kind: 'b2-cdn' })` with no `cdnBase` **throws** (missing required config) — it does NOT fall back to `source-iiif` (FR-013).
- **G-2**: `resolve()` for a page whose source has no `ark` under `source-iiif` **throws**, naming the source/page.
- **G-3**: For the same page, the two providers produce descriptors that the viewer renders identically (only the URL/kind differ) — the reading view is unchanged (FR-012, SC-005).
- **G-4**: No method returns a placeholder, empty, or default URL for missing data.
