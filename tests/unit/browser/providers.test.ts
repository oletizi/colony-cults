import { describe, it, expect } from 'vitest';
import { makeProvider } from '@/browser/providers/provider';
import type { PageInput } from '@/browser/providers/provider';
import type { ImageProviderConfig } from '@/browser/model';

/**
 * `ImageSourceProvider` is the single interface every page image URL is
 * built through (see specs/005-corpus-browser/contracts/image-provider.md).
 * These tests exercise the factory + the `source-iiif` implementation
 * against the contract's guarantees (G-1..G-4); the `b2-cdn`
 * implementation itself is a later task (T027) -- here we only assert the
 * factory's missing-config throw (G-1).
 */
describe('makeProvider', () => {
  describe('source-iiif', () => {
    it('resolves a page to a full-image ImageDescriptor whose url is the Gallica full-image (no CORS/info.json path)', () => {
      const provider = makeProvider({ kind: 'source-iiif' });
      const page: PageInput = {
        ark: 'ark:/12148/bpt6k56068358',
        folioId: 'f1',
        objectStoreKey: null,
      };

      const descriptor = provider.resolve(page);

      // full-image (simple image), not tiled iiif — displays without CORS (TASK-11).
      expect(descriptor.kind).toBe('full-image');
      expect(descriptor.url).toContain('bpt6k56068358');
      expect(descriptor.url).toContain('/f1/full/full/0/native.jpg');
    });

    it('maps a zero-padded archive folioId to the un-padded Gallica IIIF folio (TASK-10: f001 -> f1, f012 -> f12)', () => {
      const provider = makeProvider({ kind: 'source-iiif' });
      const ark = 'ark:/12148/bpt6k56068358';

      const p1 = provider.resolve({ ark, folioId: 'f001', objectStoreKey: null });
      // The IIIF folio segment must be the un-padded `f1`, not `f001`.
      expect(p1.url).toContain('/f1/full/full/0/native.jpg');
      expect(p1.url).not.toContain('f001');

      const p12 = provider.resolve({ ark, folioId: 'f012', objectStoreKey: null });
      expect(p12.url).toContain('/f12/full/full/0/native.jpg');
      expect(p12.url).not.toContain('f012');
    });

    it('throws on a folioId that is not the f<digits> shape', () => {
      const provider = makeProvider({ kind: 'source-iiif' });
      expect(() =>
        provider.resolve({ ark: 'ark:/12148/x', folioId: 'plate-3', objectStoreKey: null })
      ).toThrow(/folioId/);
    });

    it('reports its kind as source-iiif', () => {
      const provider = makeProvider({ kind: 'source-iiif' });
      expect(provider.kind).toBe('source-iiif');
    });

    it('throws, naming the folio, when the page has no ark', () => {
      const provider = makeProvider({ kind: 'source-iiif' });
      const page: PageInput = {
        ark: null,
        folioId: 'f7',
        objectStoreKey: null,
      };

      expect(() => provider.resolve(page)).toThrow(/f7/);
    });
  });

  describe('b2-cdn', () => {
    it('throws when cdnBase is missing (empty string) -- no fallback to source-iiif (G-1)', () => {
      // ImageProviderConfig's b2-cdn variant requires `cdnBase: string` at
      // the type level, so a genuinely-omitted field is prevented at
      // config-resolution (see src/browser/config.ts). To exercise the
      // runtime guard type-safely (no `as`), we pass an empty-string
      // cdnBase, which the factory must treat as "missing".
      const config: ImageProviderConfig = { kind: 'b2-cdn', cdnBase: '' };

      expect(() => makeProvider(config)).toThrow();
    });
  });
});
