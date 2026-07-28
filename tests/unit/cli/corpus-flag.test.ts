import { describe, expect, it } from 'vitest';

import { extractCorpusFlag } from '@/cli/corpus-flag';

/**
 * The global `--corpus <id>` flag (T009, FR-003). It is stripped from argv at
 * the composition root rather than declared on any one parser, because the
 * ~23 registered commands are parsed by several independent, `strict: true`
 * `node:util.parseArgs` call sites that would each reject an undeclared
 * option.
 */
describe('extractCorpusFlag', () => {
  it('extracts `--corpus <id>` and leaves the rest of argv untouched', () => {
    const { corpus, rest } = extractCorpusFlag([
      '--corpus',
      'port-breton',
      'census',
      'ark:/12148/cb123',
      '--source-id',
      'PB-P001',
    ]);
    expect(corpus).toBe('port-breton');
    expect(rest).toEqual(['census', 'ark:/12148/cb123', '--source-id', 'PB-P001']);
  });

  it('extracts the `--corpus=<id>` form and accepts the flag after the verb', () => {
    const { corpus, rest } = extractCorpusFlag(['coverage', '--corpus=synthetic', '--json']);
    expect(corpus).toBe('synthetic');
    expect(rest).toEqual(['coverage', '--json']);
  });

  it('reports absence as undefined (never a default corpus)', () => {
    const { corpus, rest } = extractCorpusFlag(['coverage', '--json']);
    expect(corpus).toBeUndefined();
    expect(rest).toEqual(['coverage', '--json']);
  });

  it('fails loud when the flag has no value', () => {
    expect(() => extractCorpusFlag(['census', '--corpus'])).toThrow(/requires a corpus id/);
  });

  it('fails loud when the flag is followed by another option', () => {
    expect(() => extractCorpusFlag(['coverage', '--corpus', '--json'])).toThrow(
      /requires a corpus id/,
    );
  });

  it('fails loud on an empty value in either form', () => {
    expect(() => extractCorpusFlag(['coverage', '--corpus='])).toThrow(/empty corpus id/);
    expect(() => extractCorpusFlag(['coverage', '--corpus', ''])).toThrow(/empty corpus id/);
  });

  it('fails loud when the flag is given twice', () => {
    expect(() => extractCorpusFlag(['--corpus', 'a', '--corpus', 'b', 'coverage'])).toThrow(
      /more than once/,
    );
  });

  it('stops at `--` so an operand after the sentinel is never eaten', () => {
    const { corpus, rest } = extractCorpusFlag([
      '--corpus',
      'port-breton',
      'summarize',
      '--',
      '--corpus',
      'literal',
    ]);
    expect(corpus).toBe('port-breton');
    expect(rest).toEqual(['summarize', '--', '--corpus', 'literal']);
  });
});
