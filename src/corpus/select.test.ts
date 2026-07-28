import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { selectCorpus } from '@/corpus/select';

const FIXTURES_ROOT = join(__dirname, '..', '..', 'tests', 'fixtures', 'corpora', 'list-cases');
const ARBITRARY_ROOT = join(
  __dirname,
  '..',
  '..',
  'tests',
  'fixtures',
  'corpora',
  'an-arbitrary-place',
);

describe('selectCorpus', () => {
  it('selects the corpus named by --corpus (cliCorpus)', () => {
    const selected = selectCorpus({ corporaRoot: FIXTURES_ROOT, cliCorpus: 'alpha' });

    expect(selected.manifest.id).toBe('alpha');
    expect(selected.corporaRoot).toBe(FIXTURES_ROOT);
  });

  it('selects the corpus named by COLONY_CORPUS (envCorpus) when --corpus is absent', () => {
    const selected = selectCorpus({ corporaRoot: FIXTURES_ROOT, envCorpus: 'beta' });

    expect(selected.manifest.id).toBe('beta');
  });

  it('prefers --corpus over COLONY_CORPUS when both are supplied (INV-3)', () => {
    const selected = selectCorpus({
      corporaRoot: FIXTURES_ROOT,
      cliCorpus: 'alpha',
      envCorpus: 'beta',
    });

    expect(selected.manifest.id).toBe('alpha');
  });

  it('throws a descriptive, operator-facing error when neither is supplied (INV-1, no implicit default)', () => {
    expect(() => selectCorpus({ corporaRoot: FIXTURES_ROOT })).toThrow(
      /no corpus selected.*--corpus.*COLONY_CORPUS/s,
    );
  });

  it('does not fall back to any implicit default (e.g. port-breton) when neither is supplied', () => {
    expect(() => selectCorpus({ corporaRoot: FIXTURES_ROOT })).not.toThrow(/port-breton/);
  });

  it('throws naming the missing manifest for an unknown corpus id', () => {
    expect(() => selectCorpus({ corporaRoot: FIXTURES_ROOT, cliCorpus: 'nope' })).toThrow(
      /unknown corpus "nope".*nope\.yml/s,
    );
  });

  it('throws naming the missing manifest for an unknown corpus id supplied via COLONY_CORPUS', () => {
    expect(() => selectCorpus({ corporaRoot: FIXTURES_ROOT, envCorpus: 'nope' })).toThrow(
      /unknown corpus "nope"/,
    );
  });

  it('resolves against an arbitrary injected corporaRoot, never a hardcoded convention (FR-016 proof)', () => {
    const selected = selectCorpus({ corporaRoot: ARBITRARY_ROOT, cliCorpus: 'zzz-custom' });

    expect(selected.manifest.id).toBe('zzz-custom');
    expect(selected.corporaRoot).toBe(ARBITRARY_ROOT);
  });
});
