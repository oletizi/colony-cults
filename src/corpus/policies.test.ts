import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { deriveSourceLayout } from '@/archive/location';
import type { Source } from '@/model/source';
import {
  deriveArchiveLayoutPolicy,
  deriveBrowserProfile,
  deriveScopeContext,
  deriveSourceIdPolicy,
} from '@/corpus/policies';
import { selectCorpus } from '@/corpus/select';

const POLICIES_ROOT = join(__dirname, '..', '..', 'tests', 'fixtures', 'corpora', 'policies');
const ARBITRARY_ROOT = join(
  __dirname,
  '..',
  '..',
  'tests',
  'fixtures',
  'corpora',
  'an-arbitrary-place',
);

function source(partial: Pick<Source, 'sourceId' | 'kind'> & Partial<Source>): Source {
  return {
    titles: [{ text: partial.sourceId, role: 'canonical' }],
    identifiers: [],
    ...partial,
  };
}

describe('deriveScopeContext', () => {
  it('contains exactly the manifest\'s declared case ids', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });

    const context = deriveScopeContext(selected);

    expect([...context.validCaseIds]).toEqual(['port-breton']);
  });

  it('is immutable: mutating validCaseIds is a type error (tsc catches the next line)', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });
    const context = deriveScopeContext(selected);

    // @ts-expect-error -- ReadonlySet has no `add`; this is a compile-time guarantee,
    // verified by `tsc --noEmit`, not a runtime assertion.
    context.validCaseIds.add('mutated');
  });
});

describe('deriveSourceIdPolicy', () => {
  it('picks the ALLOCATABLE policy for Port Breton -- PB-P, never PB-S (FR-002b)', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });

    const policy = deriveSourceIdPolicy(selected);

    expect(policy).toEqual({ prefix: 'PB-P', padWidth: 3 });
    expect(policy.prefix).not.toBe('PB-S');
  });
});

describe('deriveArchiveLayoutPolicy', () => {
  it('precomputes a derived layout per in-scope Source and carries the manifest overrides', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });
    const primary = source({
      sourceId: 'PB-P001',
      kind: 'periodical',
      case: 'port-breton',
      titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    });
    const monograph = source({
      sourceId: 'PB-P002',
      kind: 'monograph',
      case: 'port-breton',
      titles: [{ text: 'Nouvelle France, colonie libre de Port-Breton', role: 'canonical' }],
    });
    const otherCorpusSource = source({
      sourceId: 'OTHER-001',
      kind: 'monograph',
      case: 'some-other-case',
    });
    const uncasedMember = source({
      sourceId: 'PB-P900',
      kind: 'monograph',
      partOf: 'PB-P001',
      // no `case` -- inherits from its group; excluded from precomputation
      // (resolves instead via the runtime overlay, per FR-017).
    });

    const policy = deriveArchiveLayoutPolicy(selected, [
      primary,
      monograph,
      otherCorpusSource,
      uncasedMember,
    ]);

    expect(policy.derived.size).toBe(2);
    expect(policy.derived.get('PB-P001')).toEqual(deriveSourceLayout(primary));
    expect(policy.derived.get('PB-P002')).toEqual(deriveSourceLayout(monograph));
    expect(policy.derived.has('OTHER-001')).toBe(false);
    expect(policy.derived.has('PB-P900')).toBe(false);

    expect(policy.overrides.size).toBe(1);
    expect(policy.overrides.get('PB-P099')).toEqual({
      relativePath: 'cases/port-breton/books/legacy-override',
      reason: 'fixture override for deriveArchiveLayoutPolicy tests',
    });
  });

  it('reuses the shipped deriveSourceLayout (identical kind/type/slug/case derivation)', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });
    const periodical = source({
      sourceId: 'PB-P010',
      kind: 'periodical',
      case: 'port-breton',
      titles: [{ text: 'Le Journal de Port-Breton', role: 'canonical' }],
    });

    const policy = deriveArchiveLayoutPolicy(selected, [periodical]);

    expect(policy.derived.get('PB-P010')).toEqual({
      case: 'port-breton',
      type: 'newspapers',
      slug: 'le-journal-de-port-breton',
      kind: 'periodical',
    });
  });

  it('excludes source-group CONTAINERS from derived -- they have no archive location of their own (T024)', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });
    const group = source({
      sourceId: 'PB-P004',
      kind: 'source-group',
      case: 'port-breton',
      titles: [{ text: 'A Source Group', role: 'canonical' }],
    });
    const member = source({
      sourceId: 'PB-P901',
      kind: 'monograph',
      partOf: 'PB-P004',
      case: 'port-breton',
      titles: [{ text: 'A Group Member', role: 'canonical' }],
    });

    const policy = deriveArchiveLayoutPolicy(selected, [group, member]);

    expect(policy.derived.has('PB-P004')).toBe(false);
    expect(policy.derived.has('PB-P901')).toBe(true);
  });
});

describe('deriveBrowserProfile', () => {
  it('uses the file-based BrowserProfile defaults when no env override is supplied', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });

    const policy = deriveBrowserProfile(selected);

    expect(policy).toEqual({ corpus: 'port-breton', defaultSources: ['PB-P001', 'PB-P002'] });
  });

  it('applies the CORPUS_SOURCES env override when supplied, taking precedence over the file', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });

    const policy = deriveBrowserProfile(selected, ['PB-P055', 'PB-P057']);

    expect(policy).toEqual({ corpus: 'port-breton', defaultSources: ['PB-P055', 'PB-P057'] });
  });

  it('does not throw when the BrowserProfile is absent -- returns null', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'no-browser' });

    expect(() => deriveBrowserProfile(selected)).not.toThrow();
    expect(deriveBrowserProfile(selected)).toBeNull();
  });

  it('applies the env override even when no BrowserProfile file exists at all', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'no-browser' });

    // `NB001`, not `NB-001`: no-browser.yml declares `prefix: NB, padWidth: 3`,
    // so its namespace carries no delimiter. The id was arbitrary test data
    // that happened to conform to no policy, which the AUDIT-24 check now
    // rejects — see `deriveBrowserProfile`'s doc comment.
    const policy = deriveBrowserProfile(selected, ['NB001']);

    expect(policy).toEqual({ corpus: 'no-browser', defaultSources: ['NB001'] });
  });

  it('REJECTS an env override naming ids the selected corpus could never own (AUDIT-24)', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });

    expect(() => deriveBrowserProfile(selected, ['ZZ-99999', 'QQ-1'])).toThrow(
      /CORPUS_SOURCES override names 2 browser default Source ID\(s\)/,
    );
    expect(() => deriveBrowserProfile(selected, ['ZZ-99999', 'QQ-1'])).toThrow(/"ZZ-99999", "QQ-1"/);
    // The hatch stays open for anything the corpus CAN own, including ids the
    // committed profile does not list.
    expect(deriveBrowserProfile(selected, ['PB-S001'])?.defaultSources).toEqual(['PB-S001']);
  });

  it('returns a fresh array each call -- mutating one result does not affect the next', () => {
    const selected = selectCorpus({ corporaRoot: POLICIES_ROOT, cliCorpus: 'port-breton' });

    const first = deriveBrowserProfile(selected);
    (first?.defaultSources as string[]).push('mutated');
    const second = deriveBrowserProfile(selected);

    expect(second?.defaultSources).not.toContain('mutated');
  });
});

describe('narrow policy derivation against an ARBITRARY injected corporaRoot (FR-016)', () => {
  it('derives every policy correctly with no hardcoded convention', () => {
    const selected = selectCorpus({ corporaRoot: ARBITRARY_ROOT, cliCorpus: 'zzz-custom' });

    expect([...deriveScopeContext(selected).validCaseIds]).toEqual(['custom-case']);
    expect(deriveSourceIdPolicy(selected)).toEqual({ prefix: 'ZZ', padWidth: 5 });
    expect(deriveBrowserProfile(selected)).toEqual({
      corpus: 'zzz-custom',
      // `ZZ00001`, not `ZZ-00001`: the fixture's `prefix: ZZ, padWidth: 5`
      // namespace is five digits with NO delimiter, and `deriveBrowserProfile`
      // now cross-checks the defaults against it (AUDIT-10/24).
      defaultSources: ['ZZ00001'],
    });

    const custom = source({
      sourceId: 'ZZ00001',
      kind: 'monograph',
      case: 'custom-case',
      titles: [{ text: 'A Custom Title', role: 'canonical' }],
    });
    const layoutPolicy = deriveArchiveLayoutPolicy(selected, [custom]);
    expect(layoutPolicy.derived.get('ZZ00001')).toEqual(deriveSourceLayout(custom));
    expect(layoutPolicy.overrides.size).toBe(0);
  });
});
