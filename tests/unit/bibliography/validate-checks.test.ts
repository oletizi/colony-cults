import { describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import { validateSourceGroups } from '@/bibliography/validate-checks';
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

/** A minimal, valid {@link RepositoryRecord} fixture. */
function makeRecord(overrides: Partial<RepositoryRecord> = {}): RepositoryRecord {
  return {
    sourceId: 'PB-P001',
    sourceArchive: 'Gallica / BnF',
    status: 'archived',
    ...overrides,
  };
}

describe('validateSourceGroups', () => {
  it('(a) reports no source-group findings for a group with members and no repository records', () => {
    const group = makeSourceGroup({ sourceId: 'PB-P004' });
    const member1 = makeSource({ sourceId: 'PB-P005', partOf: 'PB-P004' });
    const member2 = makeSource({ sourceId: 'PB-P006', partOf: 'PB-P004' });
    const model = makeModel({ sources: [group, member1, member2] });

    const findings = validateSourceGroups(model);

    // Filter to only source-group related findings (the other kinds should not be present for this case)
    const sourceGroupFindings = findings.filter(
      (f) =>
        f.kind === 'group-has-repository-records' ||
        f.kind === 'dangling-part-of' ||
        f.kind === 'part-of-not-a-group',
    );
    expect(sourceGroupFindings).toHaveLength(0);
  });

  it('(b) reports no findings for a zero-member group (valid per FR-005)', () => {
    const group = makeSourceGroup({ sourceId: 'PB-P004' });
    const model = makeModel({ sources: [group] });

    const findings = validateSourceGroups(model);

    const sourceGroupFindings = findings.filter(
      (f) =>
        f.kind === 'group-has-repository-records' ||
        f.kind === 'dangling-part-of' ||
        f.kind === 'part-of-not-a-group',
    );
    expect(sourceGroupFindings).toHaveLength(0);
  });

  it('(c) reports group-has-repository-records when a source-group carries >= 1 repository record', () => {
    const group = makeSourceGroup({ sourceId: 'PB-P004' });
    const record = makeRecord({ sourceId: 'PB-P004', sourceArchive: 'Gallica / BnF' });
    const model = makeModel({ sources: [group], repositoryRecords: [record] });

    const findings = validateSourceGroups(model);

    const groupRecordFindings = findings.filter((f) => f.kind === 'group-has-repository-records');
    expect(groupRecordFindings.length).toBeGreaterThan(0);
    const [finding] = groupRecordFindings;
    expect(finding.sourceId).toBe('PB-P004');
    expect(finding.detail).toContain('PB-P004');
    expect(finding.detail).toMatch(/must not hold repository records/);
  });

  it('(d) reports dangling-part-of when a member partOf names a sourceId that does not exist', () => {
    const member = makeSource({ sourceId: 'PB-P005', partOf: 'PB-P999' });
    // PB-P999 does not exist in the sources list
    const model = makeModel({ sources: [member] });

    const findings = validateSourceGroups(model);

    const danglingFindings = findings.filter((f) => f.kind === 'dangling-part-of');
    expect(danglingFindings.length).toBeGreaterThan(0);
    const [finding] = danglingFindings;
    expect(finding.sourceId).toBe('PB-P005');
    expect(finding.detail).toContain('PB-P005');
    expect(finding.detail).toContain('PB-P999');
    expect(finding.detail).toMatch(/no such source exists/);
  });

  it('(e) reports part-of-not-a-group when a member partOf points to an existing source that is not a source-group', () => {
    const nonGroup = makeSource({ sourceId: 'PB-P003', kind: 'monograph' });
    const member = makeSource({ sourceId: 'PB-P005', partOf: 'PB-P003' });
    // PB-P003 exists but is a monograph, not a source-group
    const model = makeModel({ sources: [nonGroup, member] });

    const findings = validateSourceGroups(model);

    const notGroupFindings = findings.filter((f) => f.kind === 'part-of-not-a-group');
    expect(notGroupFindings.length).toBeGreaterThan(0);
    const [finding] = notGroupFindings;
    expect(finding.sourceId).toBe('PB-P005');
    expect(finding.detail).toContain('PB-P005');
    expect(finding.detail).toContain('PB-P003');
    expect(finding.detail).toMatch(/not a source group/);
  });

  it('(f) reports group-is-member when a source-group itself carries partOf (nested as a member of another group)', () => {
    const outerGroup = makeSourceGroup({ sourceId: 'PB-P004' });
    const nestedGroup = makeSourceGroup({ sourceId: 'PB-P010', partOf: 'PB-P004' });
    const model = makeModel({ sources: [outerGroup, nestedGroup] });

    const findings = validateSourceGroups(model);

    const groupIsMemberFindings = findings.filter((f) => f.kind === 'group-is-member');
    expect(groupIsMemberFindings).toHaveLength(1);
    const [finding] = groupIsMemberFindings;
    expect(finding.sourceId).toBe('PB-P010');
    expect(finding.detail).toContain('PB-P010');
    expect(finding.detail).toMatch(/must not itself be a member/);
  });
});
