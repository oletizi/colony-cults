import { describe, it, expect } from 'vitest';
import { makeProvider } from '@/browser/providers/provider';
import type { PageInput } from '@/browser/providers/provider';
import type { ImageProviderConfig } from '@/browser/model';

/**
 * `ImageSourceProvider` is the single interface every page image URL is
 * built through (see specs/005-corpus-browser/contracts/image-provider.md).
 * These tests exercise the factory + both implementations (`source-iiif`,
 * `b2-cdn`) against the contract's guarantees (G-1..G-4), plus the
 * provider-swap parity guarantee (G-3 / SC-005): the same page resolved by
 * either provider yields a valid, non-empty descriptor -- the reading view
 * is unchanged regardless of which provider built the url.
 */
describe('makeProvider', () => {
  describe('source-iiif', () => {
    it('resolves a page to a tiled iiif ImageDescriptor whose url is the Gallica IIIF image base', () => {
      const provider = makeProvider({ kind: 'source-iiif' });
      const page: PageInput = {
        ark: 'ark:/12148/bpt6k56068358',
        folioId: 'f1',
        objectStoreKey: null,
      };

      const descriptor = provider.resolve(page);

      // Tiled IIIF: the descriptor carries the image base; the viewer drives OSD
      // from `<base>/info.json` (Gallica serves valid IIIF + CORS).
      expect(descriptor.kind).toBe('iiif');
      expect(descriptor.url).toContain('bpt6k56068358');
      expect(descriptor.url.endsWith('/f1')).toBe(true);
    });

    it('maps a zero-padded archive folioId to the un-padded Gallica IIIF folio (TASK-10: f001 -> f1, f012 -> f12)', () => {
      const provider = makeProvider({ kind: 'source-iiif' });
      const ark = 'ark:/12148/bpt6k56068358';

      const p1 = provider.resolve({ ark, folioId: 'f001', objectStoreKey: null });
      // The IIIF folio segment must be the un-padded `f1`, not `f001`.
      expect(p1.url.endsWith('/f1')).toBe(true);
      expect(p1.url).not.toContain('f001');

      const p12 = provider.resolve({ ark, folioId: 'f012', objectStoreKey: null });
      expect(p12.url.endsWith('/f12')).toBe(true);
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

    it('resolves a page with an objectStoreKey to a full-image ImageDescriptor whose url is cdnBase/key', () => {
      const provider = makeProvider({ kind: 'b2-cdn', cdnBase: 'https://cdn.example' });
      const page: PageInput = {
        ark: 'ark:/12148/bpt6k56068358',
        folioId: 'f001',
        objectStoreKey:
          'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-08-15_bpt6k56068358/f001.jpg',
      };

      const descriptor = provider.resolve(page);

      expect(descriptor.kind).toBe('full-image');
      expect(descriptor.url).toBe(
        'https://cdn.example/archive/cases/port-breton/newspapers/la-nouvelle-france/1879-08-15_bpt6k56068358/f001.jpg'
      );
    });

    it('strips a trailing slash on cdnBase before joining the object-store key', () => {
      const provider = makeProvider({ kind: 'b2-cdn', cdnBase: 'https://cdn.example/pb/' });
      const descriptor = provider.resolve({
        ark: null,
        folioId: 'f001',
        objectStoreKey: 'archive/f001.jpg',
      });

      expect(descriptor.url).toBe('https://cdn.example/pb/archive/f001.jpg');
    });

    it('appends ?w=<imageWidth> when a positive reading width is configured', () => {
      const provider = makeProvider({
        kind: 'b2-cdn',
        cdnBase: 'https://cdn.example',
        imageWidth: 2400,
      });
      const descriptor = provider.resolve({
        ark: null,
        folioId: 'f001',
        objectStoreKey: 'archive/f001.jpg',
      });

      expect(descriptor.kind).toBe('full-image');
      expect(descriptor.url).toBe('https://cdn.example/archive/f001.jpg?w=2400');
    });

    it('omits the ?w= query when imageWidth is absent or non-positive', () => {
      const page: PageInput = { ark: null, folioId: 'f001', objectStoreKey: 'archive/f001.jpg' };

      const noWidth = makeProvider({ kind: 'b2-cdn', cdnBase: 'https://cdn.example' }).resolve(page);
      const zeroWidth = makeProvider({
        kind: 'b2-cdn',
        cdnBase: 'https://cdn.example',
        imageWidth: 0,
      }).resolve(page);

      expect(noWidth.url).toBe('https://cdn.example/archive/f001.jpg');
      expect(zeroWidth.url).toBe('https://cdn.example/archive/f001.jpg');
    });

    it('throws, naming the folio, when objectStoreKey is null', () => {
      const provider = makeProvider({ kind: 'b2-cdn', cdnBase: 'https://cdn.example' });
      const page: PageInput = { ark: null, folioId: 'f009', objectStoreKey: null };

      expect(() => provider.resolve(page)).toThrow(/f009/);
    });

    it('throws, naming the folio, when objectStoreKey is empty', () => {
      const provider = makeProvider({ kind: 'b2-cdn', cdnBase: 'https://cdn.example' });
      const page: PageInput = { ark: null, folioId: 'f009', objectStoreKey: '   ' };

      expect(() => provider.resolve(page)).toThrow(/f009/);
    });

    it('reports its kind as b2-cdn', () => {
      const provider = makeProvider({ kind: 'b2-cdn', cdnBase: 'https://cdn.example' });
      expect(provider.kind).toBe('b2-cdn');
    });
  });

  describe('provider-swap parity (SC-005)', () => {
    it('the same page resolved by source-iiif vs b2-cdn both yield a valid, non-empty descriptor url', () => {
      const page: PageInput = {
        ark: 'ark:/12148/bpt6k56068358',
        folioId: 'f001',
        objectStoreKey:
          'archive/cases/port-breton/newspapers/la-nouvelle-france/1879-08-15_bpt6k56068358/f001.jpg',
      };

      const iiifDescriptor = makeProvider({ kind: 'source-iiif' }).resolve(page);
      const b2Descriptor = makeProvider({ kind: 'b2-cdn', cdnBase: 'https://cdn.example' }).resolve(
        page
      );

      // Kinds legitimately differ (tiled iiif base vs full-image cdn url) --
      // the contract only guarantees both are valid, non-empty descriptors
      // the viewer can render (image-provider contract G-3).
      expect(iiifDescriptor.kind).toBe('iiif');
      expect(b2Descriptor.kind).toBe('full-image');
      expect(iiifDescriptor.url.length).toBeGreaterThan(0);
      expect(b2Descriptor.url.length).toBeGreaterThan(0);
      expect(iiifDescriptor.url).not.toBe(b2Descriptor.url);
    });
  });
});
