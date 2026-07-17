import { describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import { validate } from '@/bibliography/validate';
import {
  validateGroupOnlyFields,
  validateKnownExtentShape,
  validateReferences,
} from '@/bibliography/validate-coverage-checks';
import type { Source } from '@/model/source';

/**
 * Validation checks for the corpus-coverage-audit authored fields (V3-V5,
 * specs/007-corpus-coverage-audit/data-model.md § Validation rules). V1/V2
 * (evidenceClass / citedKind vocab) are enforced at load instead -- see
 * `tests/unit/bibliography/load-coverage-fields.test.ts`.
 */

/** A minimal, otherwise-empty {@link CanonicalModel} fixture. */
function makeModel(overrides: Partial<CanonicalModel> = {}): CanonicalModel {
  return {
    sources: [],
    repositoryRecords: [],
    identifierLeaks: [],
    ...overrides,
  };
}

/** A minimal, valid {@link Source} fixture. */
function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P001',
    kind: 'monograph',
    titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

/** A minimal, valid source-group {@link Source} fixture. */
function makeSourceGroup(overrides: Partial<Source> = {}): Source {
  return {
    sourceId: 'PB-P004',
    kind: 'source-group',
    titles: [{ text: 'Port-Breton Group', role: 'canonical' }],
    identifiers: [],
    ...overrides,
  };
}

describe('validateReferences (V3: dangling resolvedTo)', () => {
  it('reports dangling-resolved-to when a reference resolvedTo names no existing sourceId', () => {
    const source = makeSource({
      references: [{ citedAs: 'Prospectus de la Nouvelle-France', resolvedTo: 'PB-P999' }],
    });
    const model = makeModel({ sources: [source] });

    const findings = validateReferences(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('dangling-resolved-to');
    expect(findings[0].sourceId).toBe('PB-P001');
    expect(findings[0].detail).toContain('PB-P001');
    expect(findings[0].detail).toContain('PB-P999');
  });

  it('reports no finding when resolvedTo resolves to an existing sourceId', () => {
    const target = makeSource({ sourceId: 'PB-P012' });
    const source = makeSource({
      references: [{ citedAs: 'Prospectus de la Nouvelle-France', resolvedTo: 'PB-P012' }],
    });
    const model = makeModel({ sources: [target, source] });

    expect(validateReferences(model)).toEqual([]);
  });

  it('reports no finding for a reference with no resolvedTo (referenced-but-unidentified)', () => {
    const source = makeSource({
      references: [{ citedAs: 'Private Letter to the Governor' }],
    });
    const model = makeModel({ sources: [source] });

    expect(validateReferences(model)).toEqual([]);
  });

  it('reports no finding for a Source with no references at all', () => {
    const source = makeSource();
    const model = makeModel({ sources: [source] });

    expect(validateReferences(model)).toEqual([]);
  });
});

describe('validateGroupOnlyFields (V4: knownExtent/suspected only on source-group)', () => {
  it('reports group-only-field for knownExtent on a non-source-group Source', () => {
    const source = makeSource({ knownExtent: { state: 'measured', count: 3, basis: 'basis' } });
    const model = makeModel({ sources: [source] });

    const findings = validateGroupOnlyFields(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('group-only-field');
    expect(findings[0].sourceId).toBe('PB-P001');
    expect(findings[0].detail).toContain('knownExtent');
    expect(findings[0].detail).toContain('PB-P001');
  });

  it('reports group-only-field for suspected[] on a non-source-group Source', () => {
    const source = makeSource({
      suspected: [{ description: 'a suspected work', basis: 'inferred somehow' }],
    });
    const model = makeModel({ sources: [source] });

    const findings = validateGroupOnlyFields(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('group-only-field');
    expect(findings[0].detail).toContain('suspected');
    expect(findings[0].detail).toContain('PB-P001');
  });

  it('reports both fields when a non-group Source carries knownExtent AND suspected', () => {
    const source = makeSource({
      knownExtent: { state: 'measured', count: 3, basis: 'basis' },
      suspected: [{ description: 'a suspected work', basis: 'inferred somehow' }],
    });
    const model = makeModel({ sources: [source] });

    const findings = validateGroupOnlyFields(model);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.detail).join(' ')).toContain('knownExtent');
    expect(findings.map((f) => f.detail).join(' ')).toContain('suspected');
  });

  it('reports no finding when knownExtent/suspected are on a source-group', () => {
    const group = makeSourceGroup({
      knownExtent: { state: 'measured', count: 3, basis: 'basis' },
      suspected: [{ description: 'a suspected work', basis: 'inferred somehow' }],
    });
    const model = makeModel({ sources: [group] });

    expect(validateGroupOnlyFields(model)).toEqual([]);
  });

  it('reports no finding for a Source (any kind) with neither field set', () => {
    const source = makeSource();
    const group = makeSourceGroup();
    const model = makeModel({ sources: [source, group] });

    expect(validateGroupOnlyFields(model)).toEqual([]);
  });
});

describe('validateKnownExtentShape (V5: measured.count must be a non-negative integer)', () => {
  it('reports invalid-known-member-count for a negative measured count (-1)', () => {
    const group = makeSourceGroup({ knownExtent: { state: 'measured', count: -1, basis: 'basis' } });
    const model = makeModel({ sources: [group] });

    const findings = validateKnownExtentShape(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('invalid-known-member-count');
    expect(findings[0].sourceId).toBe('PB-P004');
    expect(findings[0].detail).toContain('-1');
  });

  it('reports invalid-known-member-count for a non-integer measured count (2.5)', () => {
    const group = makeSourceGroup({ knownExtent: { state: 'measured', count: 2.5, basis: 'basis' } });
    const model = makeModel({ sources: [group] });

    const findings = validateKnownExtentShape(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('invalid-known-member-count');
    expect(findings[0].detail).toContain('2.5');
  });

  it('reports no finding for a valid non-negative measured count (3)', () => {
    const group = makeSourceGroup({ knownExtent: { state: 'measured', count: 3, basis: 'basis' } });
    const model = makeModel({ sources: [group] });

    expect(validateKnownExtentShape(model)).toEqual([]);
  });

  it('reports no finding for an unexamined extent', () => {
    const group = makeSourceGroup({ knownExtent: { state: 'unexamined' } });
    const model = makeModel({ sources: [group] });

    expect(validateKnownExtentShape(model)).toEqual([]);
  });

  it('reports no finding for an irreducible extent', () => {
    const group = makeSourceGroup({ knownExtent: { state: 'irreducible', basis: 'basis' } });
    const model = makeModel({ sources: [group] });

    expect(validateKnownExtentShape(model)).toEqual([]);
  });

  it('reports no finding when knownExtent is absent', () => {
    const group = makeSourceGroup();
    const model = makeModel({ sources: [group] });

    expect(validateKnownExtentShape(model)).toEqual([]);
  });

  it('reports 0 as a valid measured count (zero is a non-negative integer)', () => {
    const group = makeSourceGroup({ knownExtent: { state: 'measured', count: 0, basis: 'basis' } });
    const model = makeModel({ sources: [group] });

    expect(validateKnownExtentShape(model)).toEqual([]);
  });
});

describe('coverage checks composed into validate() aggregator', () => {
  it('surfaces dangling-resolved-to, group-only-field, and invalid-known-member-count via validate()', () => {
    const sourceWithBadRef = makeSource({
      sourceId: 'PB-P001',
      references: [{ citedAs: 'Unresolvable Work', resolvedTo: 'PB-P999' }],
    });
    const nonGroupWithGroupFields = makeSource({
      sourceId: 'PB-P002',
      knownExtent: { state: 'measured', count: 3, basis: 'basis' },
    });
    const groupWithBadCount = makeSourceGroup({
      sourceId: 'PB-P004',
      knownExtent: { state: 'measured', count: -5, basis: 'basis' },
    });
    const model = makeModel({
      sources: [sourceWithBadRef, nonGroupWithGroupFields, groupWithBadCount],
    });

    const findings = validate(model);

    expect(findings.some((f) => f.kind === 'dangling-resolved-to')).toBe(true);
    expect(findings.some((f) => f.kind === 'group-only-field')).toBe(true);
    expect(findings.some((f) => f.kind === 'invalid-known-member-count')).toBe(true);
  });

  it('reports no coverage-field findings for a fully valid model', () => {
    const group = makeSourceGroup({ knownExtent: { state: 'measured', count: 2, basis: 'basis' } });
    const member1 = makeSource({ sourceId: 'PB-P005', partOf: 'PB-P004' });
    const member2 = makeSource({
      sourceId: 'PB-P006',
      partOf: 'PB-P004',
      references: [{ citedAs: 'A Resolved Work', resolvedTo: 'PB-P005' }],
    });
    const model = makeModel({ sources: [group, member1, member2] });

    const findings = validate(model);

    expect(
      findings.filter(
        (f) =>
          f.kind === 'dangling-resolved-to' ||
          f.kind === 'group-only-field' ||
          f.kind === 'invalid-known-member-count',
      ),
    ).toEqual([]);
  });
});

// The retired `validateSearchLogCampaigns` (V8/V9: campaign referential
// integrity) is gone -- spec 010's clean break replaces `campaign:` with
// `scope: ScopeRef`, and the resolution check is now `validateSearchLogScopes`
// (`@/bibliography/validate-search-log`), covered by
// `tests/unit/bibliography/search-log-scope.test.ts` (INV-2/T010).

describe('validate(): omitting searchLog/repoRoot skips the scope-resolution check', () => {
  it('runs no search-log-scope-unresolved finding when searchLog/repoRoot are omitted', () => {
    const model = makeModel({ sources: [makeSourceGroup()] });
    const findings = validate(model);
    expect(findings.some((f) => f.kind === 'search-log-scope-unresolved')).toBe(false);
  });
});
