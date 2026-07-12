import { describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import { validate } from '@/bibliography/validate';
import {
  validateGroupOnlyFields,
  validateKnownMemberCountShape,
  validateReferences,
  validateSearchLogCampaigns,
} from '@/bibliography/validate-coverage-checks';
import type { SearchLogEntry } from '@/bibliography/search-log';
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

describe('validateGroupOnlyFields (V4: knownMemberCount/suspected only on source-group)', () => {
  it('reports group-only-field for knownMemberCount on a non-source-group Source', () => {
    const source = makeSource({ knownMemberCount: 3 });
    const model = makeModel({ sources: [source] });

    const findings = validateGroupOnlyFields(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('group-only-field');
    expect(findings[0].sourceId).toBe('PB-P001');
    expect(findings[0].detail).toContain('knownMemberCount');
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

  it('reports both fields when a non-group Source carries knownMemberCount AND suspected', () => {
    const source = makeSource({
      knownMemberCount: 3,
      suspected: [{ description: 'a suspected work', basis: 'inferred somehow' }],
    });
    const model = makeModel({ sources: [source] });

    const findings = validateGroupOnlyFields(model);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.detail).join(' ')).toContain('knownMemberCount');
    expect(findings.map((f) => f.detail).join(' ')).toContain('suspected');
  });

  it('reports no finding when knownMemberCount/suspected are on a source-group', () => {
    const group = makeSourceGroup({
      knownMemberCount: 3,
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

describe('validateKnownMemberCountShape (V5: non-negative integer or "unknown")', () => {
  it('reports invalid-known-member-count for a negative value (-1)', () => {
    const group = makeSourceGroup({ knownMemberCount: -1 });
    const model = makeModel({ sources: [group] });

    const findings = validateKnownMemberCountShape(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('invalid-known-member-count');
    expect(findings[0].sourceId).toBe('PB-P004');
    expect(findings[0].detail).toContain('-1');
  });

  it('reports invalid-known-member-count for a non-integer value (2.5)', () => {
    const group = makeSourceGroup({ knownMemberCount: 2.5 });
    const model = makeModel({ sources: [group] });

    const findings = validateKnownMemberCountShape(model);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('invalid-known-member-count');
    expect(findings[0].detail).toContain('2.5');
  });

  it('reports no finding for a valid non-negative integer (3)', () => {
    const group = makeSourceGroup({ knownMemberCount: 3 });
    const model = makeModel({ sources: [group] });

    expect(validateKnownMemberCountShape(model)).toEqual([]);
  });

  it('reports no finding for the literal "unknown"', () => {
    const group = makeSourceGroup({ knownMemberCount: 'unknown' });
    const model = makeModel({ sources: [group] });

    expect(validateKnownMemberCountShape(model)).toEqual([]);
  });

  it('reports no finding when knownMemberCount is absent', () => {
    const group = makeSourceGroup();
    const model = makeModel({ sources: [group] });

    expect(validateKnownMemberCountShape(model)).toEqual([]);
  });

  it('reports 0 as valid (zero is a non-negative integer, distinct from "unknown")', () => {
    const group = makeSourceGroup({ knownMemberCount: 0 });
    const model = makeModel({ sources: [group] });

    expect(validateKnownMemberCountShape(model)).toEqual([]);
  });
});

describe('coverage checks composed into validate() aggregator', () => {
  it('surfaces dangling-resolved-to, group-only-field, and invalid-known-member-count via validate()', () => {
    const sourceWithBadRef = makeSource({
      sourceId: 'PB-P001',
      references: [{ citedAs: 'Unresolvable Work', resolvedTo: 'PB-P999' }],
    });
    const nonGroupWithGroupFields = makeSource({ sourceId: 'PB-P002', knownMemberCount: 3 });
    const groupWithBadCount = makeSourceGroup({ sourceId: 'PB-P004', knownMemberCount: -5 });
    const model = makeModel({
      sources: [sourceWithBadRef, nonGroupWithGroupFields, groupWithBadCount],
    });

    const findings = validate(model);

    expect(findings.some((f) => f.kind === 'dangling-resolved-to')).toBe(true);
    expect(findings.some((f) => f.kind === 'group-only-field')).toBe(true);
    expect(findings.some((f) => f.kind === 'invalid-known-member-count')).toBe(true);
  });

  it('reports no coverage-field findings for a fully valid model', () => {
    const group = makeSourceGroup({ knownMemberCount: 2 });
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

describe('validateSearchLogCampaigns (V8/V9: search-log campaign referential integrity)', () => {
  function makeEntry(overrides: Partial<SearchLogEntry> = {}): SearchLogEntry {
    return {
      id: 'SRCH-0001',
      date: '2026-07-03',
      repository: 'Gallica',
      campaign: 'PB-P004',
      scope: 'trial records',
      coverage: 'catalogue searched',
      ...overrides,
    };
  }

  it('reports no finding when campaign resolves to a source-group', () => {
    const model = makeModel({ sources: [makeSourceGroup()] });
    expect(validateSearchLogCampaigns(model, [makeEntry({ campaign: 'PB-P004' })])).toEqual([]);
  });

  it('reports search-log-campaign-not-found for a dangling campaign id', () => {
    const model = makeModel({ sources: [makeSourceGroup()] });
    const findings = validateSearchLogCampaigns(model, [
      makeEntry({ id: 'SRCH-0009', campaign: 'PB-P404' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('search-log-campaign-not-found');
    expect(findings[0]?.detail).toContain('SRCH-0009');
    expect(findings[0]?.detail).toContain('PB-P404');
  });

  it('reports search-log-campaign-not-a-group when the campaign is a monograph', () => {
    const model = makeModel({ sources: [makeSource({ sourceId: 'PB-P007', kind: 'monograph' })] });
    const findings = validateSearchLogCampaigns(model, [makeEntry({ campaign: 'PB-P007' })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('search-log-campaign-not-a-group');
    expect(findings[0]?.detail).toContain('monograph');
  });

  it('surfaces the campaign findings through validate() when searchLog is supplied', () => {
    const model = makeModel({ sources: [makeSourceGroup()] });
    const findings = validate(model, { searchLog: [makeEntry({ campaign: 'PB-P404' })] });
    expect(findings.some((f) => f.kind === 'search-log-campaign-not-found')).toBe(true);
  });

  it('runs no campaign check when searchLog is omitted (backward compatible)', () => {
    const model = makeModel({ sources: [makeSourceGroup()] });
    const findings = validate(model);
    expect(
      findings.some(
        (f) =>
          f.kind === 'search-log-campaign-not-found' ||
          f.kind === 'search-log-campaign-not-a-group',
      ),
    ).toBe(false);
  });
});
