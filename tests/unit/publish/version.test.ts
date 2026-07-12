import { describe, it, expect } from 'vitest';

import { snapshotShort, resolveSnapshot } from '@/pdf/publish/version';
import type { ArchivePinReader } from '@/pdf/load/edition';

function pinReaderOf(ref: string): ArchivePinReader {
  return { read: () => ref };
}

describe('snapshotShort', () => {
  it('derives the git-conventional 8-char short form from a full 40-char ref', () => {
    const full = '3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10';

    expect(snapshotShort(full)).toBe('3b8b1fd6');
    expect(snapshotShort(full)).toHaveLength(8);
  });

  it('lowercases an uppercase-hex ref', () => {
    const full = '3B8B1FD6A0D7F76F3C5F9A2B3DA94252BBB5DD10';

    expect(snapshotShort(full)).toBe('3b8b1fd6');
  });

  it('trims surrounding whitespace before validating/truncating', () => {
    const full = '  3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10  ';

    expect(snapshotShort(full)).toBe('3b8b1fd6');
  });

  it('throws a descriptive error on an empty ref', () => {
    expect(() => snapshotShort('')).toThrow(/snapshotShort: fullRef is empty/);
  });

  it('throws a descriptive error on a whitespace-only ref', () => {
    expect(() => snapshotShort('   ')).toThrow(/snapshotShort: fullRef is empty/);
  });

  it('throws a descriptive error on a non-hex ref', () => {
    expect(() => snapshotShort('not-a-commit-ref')).toThrow(
      /snapshotShort:.*is not a valid hex commit ref/,
    );
  });

  it('throws a descriptive error on a ref shorter than 40 hex chars', () => {
    expect(() => snapshotShort('3b8b1fd6')).toThrow(
      /snapshotShort:.*is not a valid hex commit ref/,
    );
  });

  it('throws a descriptive error on a ref longer than 40 hex chars', () => {
    expect(() => snapshotShort('3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10ff')).toThrow(
      /snapshotShort:.*is not a valid hex commit ref/,
    );
  });
});

describe('resolveSnapshot', () => {
  it('resolves both the full ref and its short form from an injected reader', () => {
    const reader = pinReaderOf('3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10');

    const version = resolveSnapshot(reader);

    expect(version.full).toBe('3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10');
    expect(version.short).toBe('3b8b1fd6');
  });

  it('propagates a fail-loud error from an invalid resolved ref', () => {
    const reader = pinReaderOf('');

    expect(() => resolveSnapshot(reader)).toThrow(/snapshotShort: fullRef is empty/);
  });

  it('propagates the reader error when the pin cannot be read', () => {
    const reader: ArchivePinReader = {
      read: () => {
        throw new Error('resolveArchiveRef: pin file not found at /nonexistent/archive-source.json.');
      },
    };

    expect(() => resolveSnapshot(reader)).toThrow(/pin file not found/);
  });
});
