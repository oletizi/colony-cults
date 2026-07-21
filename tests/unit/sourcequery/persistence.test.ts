import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { persistCapture, persistBlockEvidence, slugify } from '@/sourcequery/persistence';

describe('sourcequery/persistence', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'sourcequery-persistence-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('slugify', () => {
    it('lowercases, collapses non-alphanumeric runs to a single hyphen, and trims', () => {
      expect(slugify('Trove', 'John Q. Public!!')).toBe('trove-john-q-public');
    });

    it('collapses punctuation-heavy inputs without leaving stray hyphens', () => {
      expect(slugify('IA', '  --Foo__Bar--  ')).toBe('ia-foo-bar');
    });

    it('throws when both inputs are purely punctuation/whitespace', () => {
      expect(() => slugify('   ', '!!!')).toThrow(/empty filesystem slug/);
    });
  });

  describe('persistCapture', () => {
    it('writes both the .html and .md artifacts and returns a PersistedCapture whose paths exist on disk', async () => {
      const capturedAtUtc = '2026-07-17T12:00:00.000Z';
      const result = await persistCapture({
        source: 'trove',
        query: 'John Q. Public',
        url: 'https://trove.nla.gov.au/search?q=john',
        html: '<html><body>hello</body></html>',
        snapshotMarkdown: '# hello',
        capturedAtUtc,
        baseDir,
      });

      expect(result.url).toBe('https://trove.nla.gov.au/search?q=john');
      expect(result.capturedAtUtc).toBe(capturedAtUtc);

      expect(existsSync(result.htmlPath)).toBe(true);
      expect(existsSync(result.snapshotPath)).toBe(true);

      const htmlContents = await readFile(result.htmlPath, 'utf-8');
      const mdContents = await readFile(result.snapshotPath, 'utf-8');
      expect(htmlContents).toBe('<html><body>hello</body></html>');
      expect(mdContents).toBe('# hello');

      expect(result.htmlPath).toBe(
        path.join(
          baseDir,
          'bibliography',
          'repository-responses',
          'trove',
          'trove-john-q-public-2026-07-17T12-00-00-000Z.html',
        ),
      );
      expect(result.snapshotPath).toBe(
        path.join(
          baseDir,
          'bibliography',
          'repository-responses',
          'trove',
          'trove-john-q-public-2026-07-17T12-00-00-000Z.md',
        ),
      );
    });

    it('throws (never returns a partial capture) when the target directory cannot be created', async () => {
      // Point baseDir at a path where a FILE occupies a segment that must be
      // a directory -- mkdir(recursive) will fail with ENOTDIR.
      const blockerFile = path.join(baseDir, 'blocker-file');
      writeFileSync(blockerFile, 'not a directory');

      await expect(
        persistCapture({
          source: 'trove',
          query: 'irrelevant',
          url: 'https://example.test/',
          html: '<html></html>',
          snapshotMarkdown: '# irrelevant',
          capturedAtUtc: '2026-07-17T12:00:00.000Z',
          // baseDir itself is a file, not a directory -- every write under it fails.
          baseDir: blockerFile,
        }),
      ).rejects.toThrow(/persistence: failed to write capture file/);
    });

    it('throws when the target directory exists but is unwritable', async () => {
      const readonlyDir = path.join(baseDir, 'readonly-root');
      const restrictedTarget = path.join(readonlyDir, 'bibliography', 'repository-responses', 'trove');
      // Pre-create the leaf dir, then strip write permission so writeFile fails
      // even though mkdir(recursive) is a no-op (dir already exists).
      mkdirSync(restrictedTarget, { recursive: true });
      chmodSync(restrictedTarget, 0o500);

      try {
        await expect(
          persistCapture({
            source: 'trove',
            query: 'irrelevant',
            url: 'https://example.test/',
            html: '<html></html>',
            snapshotMarkdown: '# irrelevant',
            capturedAtUtc: '2026-07-17T12:00:00.000Z',
            baseDir: readonlyDir,
          }),
        ).rejects.toThrow(/persistence: failed to write capture file/);
      } finally {
        // Restore permissions so the temp-dir cleanup in afterEach can remove it.
        chmodSync(restrictedTarget, 0o700);
      }
    });
  });

  describe('persistBlockEvidence', () => {
    it('writes block-<UTC>.{html,md} and returns a BlockEvidence with a real evidencePath', async () => {
      const capturedAtUtc = '2026-07-17T13:30:00.000Z';
      const result = await persistBlockEvidence({
        source: 'trove',
        kind: 'challenge',
        detail: 'Cloudflare interstitial detected',
        html: '<html><body>are you human?</body></html>',
        snapshotMarkdown: '# are you human?',
        capturedAtUtc,
        baseDir,
      });

      expect(result.kind).toBe('challenge');
      expect(result.detail).toBe('Cloudflare interstitial detected');
      expect(result.capturedAtUtc).toBe(capturedAtUtc);

      expect(existsSync(result.evidencePath)).toBe(true);
      expect(result.evidencePath).toBe(
        path.join(
          baseDir,
          'bibliography',
          'repository-responses',
          'trove',
          'block-2026-07-17T13-30-00-000Z.html',
        ),
      );

      const expectedMdPath = path.join(
        baseDir,
        'bibliography',
        'repository-responses',
        'trove',
        'block-2026-07-17T13-30-00-000Z.md',
      );
      expect(existsSync(expectedMdPath)).toBe(true);

      const htmlContents = await readFile(result.evidencePath, 'utf-8');
      const mdContents = await readFile(expectedMdPath, 'utf-8');
      expect(htmlContents).toBe('<html><body>are you human?</body></html>');
      expect(mdContents).toBe('# are you human?');
    });

    it('throws (never returns partial block evidence) when the target is unwritable', async () => {
      const blockerFile = path.join(baseDir, 'blocker-file');
      writeFileSync(blockerFile, 'not a directory');

      await expect(
        persistBlockEvidence({
          source: 'trove',
          kind: 'status',
          detail: 'HTTP 403',
          html: '<html></html>',
          snapshotMarkdown: '# blocked',
          capturedAtUtc: '2026-07-17T13:30:00.000Z',
          baseDir: blockerFile,
        }),
      ).rejects.toThrow(/persistence: failed to write capture file/);
    });
  });
});
