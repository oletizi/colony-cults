import { describe, it, expect } from 'vitest';
import { parseFolioRange } from '@/fetch/folio-range';

/**
 * Tests for `parseFolioRange` (spec 012, T002/T003): a PURE `--pages` spec
 * parser. No I/O, no document knowledge (no `pageCount` bound) -- the caller
 * checks the result against the real page count separately. Every malformed
 * input must throw a descriptive, fail-loud error naming the offending token.
 */

describe('parseFolioRange', () => {
  it('parses a single folio', () => {
    expect(parseFolioRange('48')).toEqual([48]);
  });

  it('parses a contiguous range, inclusive', () => {
    expect(parseFolioRange('48-50')).toEqual([48, 49, 50]);
  });

  it('parses a comma-separated list of singles', () => {
    expect(parseFolioRange('48,50,52')).toEqual([48, 50, 52]);
  });

  it('parses a mix of a range and a single, sorted ascending', () => {
    expect(parseFolioRange('48-50,55')).toEqual([48, 49, 50, 55]);
  });

  it('de-duplicates a folio repeated between a range and a single', () => {
    expect(parseFolioRange('48-50,49')).toEqual([48, 49, 50]);
  });

  it('tolerates surrounding and interior whitespace', () => {
    expect(parseFolioRange(' 48 - 50 , 55 ')).toEqual([48, 49, 50, 55]);
  });

  it('throws on a reversed range', () => {
    expect(() => parseFolioRange('50-48')).toThrow(/50-48/);
  });

  it('throws when a range endpoint is below 1', () => {
    expect(() => parseFolioRange('0-3')).toThrow(/0-3/);
  });

  it('throws when a bare token is below 1', () => {
    expect(() => parseFolioRange('-1')).toThrow(/-1/);
  });

  it('throws on a malformed dangling-hyphen token', () => {
    expect(() => parseFolioRange('48-')).toThrow(/48-/);
  });

  it('throws on a non-integer token', () => {
    expect(() => parseFolioRange('a-b')).toThrow(/a-b/);
  });

  it('throws on an empty token between commas', () => {
    expect(() => parseFolioRange('48,,50')).toThrow(/empty token/i);
  });

  it('throws on an empty string', () => {
    expect(() => parseFolioRange('')).toThrow(/empty/i);
  });

  it('throws on a whitespace-only string', () => {
    expect(() => parseFolioRange('   ')).toThrow(/empty/i);
  });
});
