import { describe, expect, it } from 'vitest';

import type { CanonicalModel, IdentifierLeak } from '@/bibliography/model';
import { validate, validateIdentifierLeaks } from '@/bibliography/validate';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Source } from '@/model/source';

/** A minimal, otherwise-empty {@link CanonicalModel} fixture. */
function makeModel(overrides: Partial<CanonicalModel> = {}): CanonicalModel {
  return {
    sources: [],
    repositoryRecords: [],
    identifierLeaks: [],
    ...overrides,
  };
}

describe('validateIdentifierLeaks', () => {
  it('(a) reports ONE identifier-leak finding for a copy-level id (ark) mis-placed on a Source, naming the identifier and the level', () => {
    const leak: IdentifierLeak = {
      onLevel: 'source',
      sourceId: 'PB-P002',
      type: 'ark',
      value: 'ark:/12148/bpt6k1234',
      expectedLevel: 'copy',
    };
    const model = makeModel({ identifierLeaks: [leak] });

    const findings = validateIdentifierLeaks(model);

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.kind).toBe('identifier-leak');
    expect(finding.sourceId).toBe('PB-P002');
    expect(finding.identifier).toBe('ark:/12148/bpt6k1234');
    // Names the offending identifier, its current (wrong) level, the source,
    // and where it belongs (FR-018/FR-009/SC-002).
    expect(finding.detail).toContain('ark');
    expect(finding.detail).toContain('PB-P002');
    expect(finding.detail).toMatch(/copy-level/);
    expect(finding.detail).toMatch(/Repository Record/);
  });

  it('(b) reports a finding for a work-level id (issn) mis-placed on a Repository Record, naming the identifier and the level', () => {
    const leak: IdentifierLeak = {
      onLevel: 'record',
      sourceId: 'PB-P003',
      sourceArchive: 'Gallica / BnF',
      type: 'issn',
      value: '1234-5678',
      expectedLevel: 'work',
    };
    const model = makeModel({ identifierLeaks: [leak] });

    const findings = validateIdentifierLeaks(model);

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.kind).toBe('identifier-leak');
    expect(finding.sourceId).toBe('PB-P003');
    expect(finding.identifier).toBe('1234-5678');
    expect(finding.detail).toContain('issn');
    expect(finding.detail).toContain('PB-P003');
    expect(finding.detail).toContain('Gallica / BnF');
    expect(finding.detail).toMatch(/work-level/);
    expect(finding.detail).toMatch(/Source/);
  });

  it('(c) reports NO finding when identifiers are correctly placed (work-level on Source, copy-level on Repository Record)', () => {
    const source: Source = {
      sourceId: 'PB-P001',
      kind: 'monograph',
      titles: [{ text: 'La Nouvelle France', role: 'canonical' }],
      identifiers: [{ type: 'issn', value: '1234-5678' }],
    };
    const record: RepositoryRecord = {
      sourceId: 'PB-P001',
      sourceArchive: 'Gallica / BnF',
      status: 'archived',
      identifiers: [{ type: 'ark', value: 'ark:/12148/bpt6k1234' }],
    };
    // Correctly-placed identifiers never produce an IdentifierLeak in the
    // first place (see `@/bibliography/load-fields`) -- identifierLeaks
    // stays empty.
    const model = makeModel({ sources: [source], repositoryRecords: [record] });

    expect(validateIdentifierLeaks(model)).toEqual([]);
  });

  it('reports one finding per leak, in order, when multiple leaks are present', () => {
    const sourceLeak: IdentifierLeak = {
      onLevel: 'source',
      sourceId: 'PB-P002',
      type: 'ark',
      value: 'ark:/12148/bpt6k1234',
      expectedLevel: 'copy',
    };
    const recordLeak: IdentifierLeak = {
      onLevel: 'record',
      sourceId: 'PB-P003',
      sourceArchive: 'Gallica / BnF',
      type: 'issn',
      value: '1234-5678',
      expectedLevel: 'work',
    };
    const model = makeModel({ identifierLeaks: [sourceLeak, recordLeak] });

    const findings = validateIdentifierLeaks(model);

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.identifier)).toEqual([sourceLeak.value, recordLeak.value]);
  });
});

describe('validate', () => {
  it('composes the identifier-leak check (currently the only check) into the top-level result', () => {
    const leak: IdentifierLeak = {
      onLevel: 'source',
      sourceId: 'PB-P002',
      type: 'ark',
      value: 'ark:/12148/bpt6k1234',
      expectedLevel: 'copy',
    };
    const model = makeModel({ identifierLeaks: [leak] });

    expect(validate(model)).toEqual(validateIdentifierLeaks(model));
  });

  it('returns an empty array (no findings) for a fully consistent model', () => {
    const model = makeModel();
    expect(validate(model)).toEqual([]);
  });

  it('does not throw on findings -- findings are data, not errors', () => {
    const leak: IdentifierLeak = {
      onLevel: 'record',
      sourceId: 'PB-P003',
      sourceArchive: 'Gallica / BnF',
      type: 'issn',
      value: '1234-5678',
      expectedLevel: 'work',
    };
    const model = makeModel({ identifierLeaks: [leak] });
    expect(() => validate(model)).not.toThrow();
  });
});
