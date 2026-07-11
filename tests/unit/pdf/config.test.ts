import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolvePdfConfig, resolveArchiveRef } from '@/pdf/config';
import { resolveRepoRoot } from '@/browser/load/repo-root';

describe('resolvePdfConfig', () => {
  it('returns documented defaults when env is empty', () => {
    const config = resolvePdfConfig({});

    expect(config.outDir).toBe('build/pdf');
    expect(config.imageProvider).toBe('b2');
    expect(config.snapshotDir).toBe('site/data');
  });

  it('computes an absolute pinFile path from snapshotDir', () => {
    const config = resolvePdfConfig({});
    const repoRoot = resolveRepoRoot();
    const expectedSnapshotDirAbs = path.join(repoRoot, 'site/data');
    const expectedPinFile = path.join(expectedSnapshotDirAbs, 'archive-source.json');

    expect(config.pinFile).toBe(expectedPinFile);
    expect(path.isAbsolute(config.pinFile)).toBe(true);
  });

  it('resolves PDF_IMAGE_PROVIDER "iiif" correctly', () => {
    const config = resolvePdfConfig({ PDF_IMAGE_PROVIDER: 'iiif' });

    expect(config.imageProvider).toBe('iiif');
  });

  it('resolves PDF_IMAGE_PROVIDER "b2" correctly', () => {
    const config = resolvePdfConfig({ PDF_IMAGE_PROVIDER: 'b2' });

    expect(config.imageProvider).toBe('b2');
  });

  it('accepts PDF_IMAGE_PROVIDER value with surrounding whitespace', () => {
    const config = resolvePdfConfig({ PDF_IMAGE_PROVIDER: '  iiif  ' });

    expect(config.imageProvider).toBe('iiif');
  });

  it('defaults to "b2" when PDF_IMAGE_PROVIDER is unset', () => {
    const config = resolvePdfConfig({});

    expect(config.imageProvider).toBe('b2');
  });

  it('throws a descriptive error for an invalid PDF_IMAGE_PROVIDER', () => {
    expect(() => resolvePdfConfig({ PDF_IMAGE_PROVIDER: 'bogus' })).toThrow(
      /Unknown PDF_IMAGE_PROVIDER value: "bogus"[\s\S]*Expected one of: "b2"[\s\S]*"iiif"/
    );
  });

  it('throws a descriptive error for an empty PDF_IMAGE_PROVIDER', () => {
    expect(() => resolvePdfConfig({ PDF_IMAGE_PROVIDER: '   ' })).toThrow(
      /Unknown PDF_IMAGE_PROVIDER value/
    );
  });

  it('respects PDF_OUT_DIR when provided', () => {
    const config = resolvePdfConfig({ PDF_OUT_DIR: '/custom/out' });

    expect(config.outDir).toBe('/custom/out');
  });

  it('respects PDF_SNAPSHOT_DIR when provided', () => {
    const config = resolvePdfConfig({ PDF_SNAPSHOT_DIR: '/custom/snapshot' });

    expect(config.snapshotDir).toBe('/custom/snapshot');
  });

  it('strips whitespace from PDF_OUT_DIR', () => {
    const config = resolvePdfConfig({ PDF_OUT_DIR: '  build/custom  ' });

    expect(config.outDir).toBe('build/custom');
  });

  it('strips whitespace from PDF_SNAPSHOT_DIR', () => {
    const config = resolvePdfConfig({ PDF_SNAPSHOT_DIR: '  site/custom  ' });

    expect(config.snapshotDir).toBe('site/custom');
  });
});

describe('resolveArchiveRef', () => {
  it('returns the pinned ref from site/data/archive-source.json', () => {
    const repoRoot = resolveRepoRoot();
    const config = resolvePdfConfig({});

    const ref = resolveArchiveRef(config);

    expect(typeof ref).toBe('string');
    expect(ref.length).toBeGreaterThan(0);
    // The real file has a git commit hash
    expect(ref).toMatch(/^[a-f0-9]{40}$/);
  });

  it('throws a descriptive error when pinFile does not exist', () => {
    const nonexistentPath = path.join('/tmp/nonexistent-dir-12345', 'archive-source.json');

    expect(() =>
      resolveArchiveRef({ pinFile: nonexistentPath })
    ).toThrow(
      /resolveArchiveRef: pin file not found at[\s\S]*Expected the committed[\s\S]*archive-source.json/
    );
  });

  it('throws when pinFile content is not valid JSON', () => {
    const repoRoot = resolveRepoRoot();
    const scratchDir = '/private/tmp/claude-501/-Users-orion-work-colony-cults-work-corpus-print-pdf/58826d7e-e089-4d90-a1d7-2029b53acb2b/scratchpad';

    // Create a test file with invalid JSON
    const fs = require('node:fs');
    const testFile = path.join(scratchDir, 'invalid.json');
    fs.writeFileSync(testFile, 'not valid json {]');

    try {
      expect(() =>
        resolveArchiveRef({ pinFile: testFile })
      ).toThrow(/resolveArchiveRef.*not valid JSON/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('throws when pinFile content is not an object', () => {
    const scratchDir = '/private/tmp/claude-501/-Users-orion-work-colony-cults-work-corpus-print-pdf/58826d7e-e089-4d90-a1d7-2029b53acb2b/scratchpad';
    const fs = require('node:fs');
    const testFile = path.join(scratchDir, 'notobject.json');
    fs.writeFileSync(testFile, '"a string"');

    try {
      expect(() =>
        resolveArchiveRef({ pinFile: testFile })
      ).toThrow(/resolveArchiveRef: expected an object[\s\S]*got string/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('throws when pinFile is a JSON array', () => {
    const scratchDir = '/private/tmp/claude-501/-Users-orion-work-colony-cults-work-corpus-print-pdf/58826d7e-e089-4d90-a1d7-2029b53acb2b/scratchpad';
    const fs = require('node:fs');
    const testFile = path.join(scratchDir, 'array.json');
    fs.writeFileSync(testFile, '[]');

    try {
      expect(() =>
        resolveArchiveRef({ pinFile: testFile })
      ).toThrow(/resolveArchiveRef: expected an object/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('throws when pinFile is JSON null', () => {
    const scratchDir = '/private/tmp/claude-501/-Users-orion-work-colony-cults-work-corpus-print-pdf/58826d7e-e089-4d90-a1d7-2029b53acb2b/scratchpad';
    const fs = require('node:fs');
    const testFile = path.join(scratchDir, 'null.json');
    fs.writeFileSync(testFile, 'null');

    try {
      expect(() =>
        resolveArchiveRef({ pinFile: testFile })
      ).toThrow(/resolveArchiveRef: expected an object[\s\S]*got null/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('throws when pinFile lacks a "ref" field', () => {
    const scratchDir = '/private/tmp/claude-501/-Users-orion-work-colony-cults-work-corpus-print-pdf/58826d7e-e089-4d90-a1d7-2029b53acb2b/scratchpad';
    const fs = require('node:fs');
    const testFile = path.join(scratchDir, 'noref.json');
    fs.writeFileSync(testFile, JSON.stringify({ note: 'something', repo: 'git@github.com:...' }));

    try {
      expect(() =>
        resolveArchiveRef({ pinFile: testFile })
      ).toThrow(/resolveArchiveRef.*missing a non-empty "ref" field/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('throws when ref is an empty string', () => {
    const scratchDir = '/private/tmp/claude-501/-Users-orion-work-colony-cults-work-corpus-print-pdf/58826d7e-e089-4d90-a1d7-2029b53acb2b/scratchpad';
    const fs = require('node:fs');
    const testFile = path.join(scratchDir, 'emptyref.json');
    fs.writeFileSync(testFile, JSON.stringify({ ref: '' }));

    try {
      expect(() =>
        resolveArchiveRef({ pinFile: testFile })
      ).toThrow(/resolveArchiveRef.*missing a non-empty "ref" field/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('throws when ref is whitespace only', () => {
    const scratchDir = '/private/tmp/claude-501/-Users-orion-work-colony-cults-work-corpus-print-pdf/58826d7e-e089-4d90-a1d7-2029b53acb2b/scratchpad';
    const fs = require('node:fs');
    const testFile = path.join(scratchDir, 'whitespaceref.json');
    fs.writeFileSync(testFile, JSON.stringify({ ref: '   ' }));

    try {
      expect(() =>
        resolveArchiveRef({ pinFile: testFile })
      ).toThrow(/resolveArchiveRef.*missing a non-empty "ref" field/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });

  it('throws when ref is not a string', () => {
    const scratchDir = '/private/tmp/claude-501/-Users-orion-work-colony-cults-work-corpus-print-pdf/58826d7e-e089-4d90-a1d7-2029b53acb2b/scratchpad';
    const fs = require('node:fs');
    const testFile = path.join(scratchDir, 'numberref.json');
    fs.writeFileSync(testFile, JSON.stringify({ ref: 123 }));

    try {
      expect(() =>
        resolveArchiveRef({ pinFile: testFile })
      ).toThrow(/resolveArchiveRef.*missing a non-empty "ref" field/);
    } finally {
      fs.unlinkSync(testFile);
    }
  });
});
