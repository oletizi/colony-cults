import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { resolveConfig, resolveBrowserSources } from '@/browser/config';
import { deriveBrowserProfile } from '@/corpus/policies';
import { selectCorpus } from '@/corpus/select';

/**
 * T014 (specs/018-corpus-config-seam, FR-005/FR-010): the browser/site-build
 * composition root -- `resolveBrowserSources` (and the `resolveConfig` it
 * backs) select a corpus and derive its `BrowserDefaultsPolicy`, in place of
 * the retired 44-id literal. See src/browser/config.ts's module doc comment.
 */

/** The repository's real committed manifests + browser profile. */
const REAL_CORPORA_ROOT = path.resolve(__dirname, '..', '..', '..', 'corpora');

/**
 * A DIFFERENT fixture corporaRoot, with two DIFFERENT corpora -- neither
 * named "port-breton" -- each with its own, much smaller `defaultSources`
 * (`alpha`: `[AL001]`, `beta`: `[]`). Reused unmodified from `@/corpus/
 * validate`'s own fixtures (tests/fixtures/corpora/validate-valid/), so this
 * test adds no fixture of its own.
 */
const ALT_CORPORA_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'corpora',
  'validate-valid',
);

/**
 * A fixture corporaRoot holding a corpus manifest (`no-browser`) with NO
 * companion `<id>.browser.yml` -- for proving profile absence does not
 * throw for a non-browser path (FR-005).
 */
const POLICIES_FIXTURE_ROOT = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'corpora',
  'policies',
);

/** The real, committed `defaultSources`, read straight from the YAML file. */
function readCommittedPortBretonDefaults(): string[] {
  const text = readFileSync(path.join(REAL_CORPORA_ROOT, 'port-breton.browser.yml'), 'utf-8');
  const parsed: unknown = parseYaml(text);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('defaultSources' in parsed) ||
    !Array.isArray((parsed as { defaultSources: unknown }).defaultSources)
  ) {
    throw new Error('test setup: corpora/port-breton.browser.yml has no defaultSources array');
  }
  return (parsed as { defaultSources: string[] }).defaultSources;
}

describe('resolveBrowserSources: regression against the committed Port Breton defaults (FR-010)', () => {
  it('derives exactly the 44 committed ids, in the committed order', () => {
    const committed = readCommittedPortBretonDefaults();
    expect(committed).toHaveLength(44);

    const derived = resolveBrowserSources({
      env: { COLONY_CORPUS: 'port-breton' },
      corporaRoot: REAL_CORPORA_ROOT,
    });

    expect(derived).toEqual(committed);
  });

  it('resolveConfig() end-to-end also derives the same 44 committed ids, in order', () => {
    const committed = readCommittedPortBretonDefaults();

    const config = resolveConfig({ COLONY_CORPUS: 'port-breton' });

    expect(config.sources).toEqual(committed);
  });
});

describe('resolveBrowserSources: CORPUS_SOURCES override (FR-005)', () => {
  it('CORPUS_SOURCES set wins over the profile defaults', () => {
    const derived = resolveBrowserSources({
      env: { COLONY_CORPUS: 'port-breton', CORPUS_SOURCES: 'PB-P001, PB-P002' },
      corporaRoot: REAL_CORPORA_ROOT,
    });

    expect(derived).toEqual(['PB-P001', 'PB-P002']);
  });

  it('CORPUS_SOURCES unset falls back to the profile defaults', () => {
    const committed = readCommittedPortBretonDefaults();

    const derived = resolveBrowserSources({
      env: { COLONY_CORPUS: 'port-breton' },
      corporaRoot: REAL_CORPORA_ROOT,
    });

    expect(derived).toEqual(committed);
  });
});

describe('resolveBrowserSources: a different browser profile yields its OWN defaults (proves the literal is gone)', () => {
  it("selecting 'alpha' from a different corporaRoot yields alpha's own defaults, not Port Breton's", () => {
    const derived = resolveBrowserSources({
      env: { COLONY_CORPUS: 'alpha' },
      corporaRoot: ALT_CORPORA_ROOT,
    });

    expect(derived).toEqual(['AL001']);
  });

  it("selecting 'beta' from the same root yields beta's own (empty) defaults", () => {
    const derived = resolveBrowserSources({
      env: { COLONY_CORPUS: 'beta' },
      corporaRoot: ALT_CORPORA_ROOT,
    });

    expect(derived).toEqual([]);
  });
});

describe('resolveBrowserSources: absence is fatal HERE -- the site build IS a browser-default-consuming path (FR-005)', () => {
  it('throws when the selected corpus has no browser profile and no CORPUS_SOURCES override', () => {
    expect(() =>
      resolveBrowserSources({
        env: { COLONY_CORPUS: 'no-browser' },
        corporaRoot: POLICIES_FIXTURE_ROOT,
      }),
    ).toThrow(/no browser-defaults policy/);
  });
});

describe('deriveBrowserProfile: profile absence does NOT throw for a non-browser path (FR-005)', () => {
  it('returns null (not a throw) for a corpus with no committed <id>.browser.yml', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_FIXTURE_ROOT, cliCorpus: 'no-browser' });

    expect(deriveBrowserProfile(selected)).toBeNull();
  });
});
