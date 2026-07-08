import { describe, it, expect } from 'vitest';
import { assertValidArk } from '@/gallica/ark';

/**
 * The bare-ark validator is the up-front defense-in-depth guard against path
 * traversal: a bare ark is spliced directly into archive filesystem paths, so
 * anything carrying a path separator, `..`, or whitespace must be rejected
 * before a path is ever built.
 */
describe('assertValidArk', () => {
  it('accepts well-formed Gallica bare identifiers', () => {
    expect(assertValidArk('bpt6k5603637g')).toBe('bpt6k5603637g');
    expect(assertValidArk('cb328261098')).toBe('cb328261098');
    expect(assertValidArk('BPT6K5603637G')).toBe('BPT6K5603637G');
  });

  it('rejects a "../" traversal attempt', () => {
    expect(() => assertValidArk('../etc')).toThrow(/malformed ark/i);
  });

  it('rejects an embedded path separator', () => {
    expect(() => assertValidArk('a/b')).toThrow(/malformed ark/i);
  });

  it('rejects a bare ".." segment', () => {
    expect(() => assertValidArk('..')).toThrow(/malformed ark/i);
  });

  it('rejects the empty string', () => {
    expect(() => assertValidArk('')).toThrow(/malformed ark/i);
  });

  it('rejects whitespace', () => {
    expect(() => assertValidArk('bpt6k 5603637g')).toThrow(/malformed ark/i);
    expect(() => assertValidArk('bpt6k5603637g\n')).toThrow(/malformed ark/i);
  });

  it('rejects a backslash path separator', () => {
    expect(() => assertValidArk('a\\b')).toThrow(/malformed ark/i);
  });
});
