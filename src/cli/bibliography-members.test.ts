import { describe, it, expect } from 'vitest';
import type { Source } from '@/model/source';
import { deriveGroupMembers, formatMembers, sourceTitle } from '@/cli/bibliography';

function src(partial: Partial<Source> & Pick<Source, 'sourceId' | 'kind'>): Source {
  return {
    titles: [{ text: `title-${partial.sourceId}`, role: 'canonical' }],
    identifiers: [],
    ...partial,
  } as Source;
}

describe('deriveGroupMembers (bib show source-group members)', () => {
  const group = src({ sourceId: 'PB-P004', kind: 'source-group' });
  const members = [
    src({ sourceId: 'PB-P009', kind: 'monograph', partOf: 'PB-P004', status: 'discovered' }),
    src({ sourceId: 'PB-P007', kind: 'monograph', partOf: 'PB-P004', status: 'approved-for-acquisition' }),
    src({ sourceId: 'PB-P002', kind: 'monograph' }), // standalone — not a member
    src({ sourceId: 'PB-N001', kind: 'periodical', partOf: 'PB-P099' }), // other group
  ];
  const all = [group, ...members];

  it('returns only sources whose partOf matches the group, sorted by id', () => {
    const result = deriveGroupMembers(all, 'PB-P004');
    expect(result.map((m) => m.sourceId)).toEqual(['PB-P007', 'PB-P009']);
  });

  it('returns [] for a group with no members', () => {
    expect(deriveGroupMembers(all, 'PB-P099-empty')).toEqual([]);
  });

  it('excludes standalone sources (no partOf) and other groups\' members', () => {
    const ids = deriveGroupMembers(all, 'PB-P004').map((m) => m.sourceId);
    expect(ids).not.toContain('PB-P002');
    expect(ids).not.toContain('PB-N001');
  });
});

describe('formatMembers / sourceTitle', () => {
  it('renders id, status, and canonical title per member', () => {
    const lines = formatMembers([
      src({ sourceId: 'PB-P007', kind: 'monograph', partOf: 'PB-P004', status: 'approved-for-acquisition' }),
    ]);
    expect(lines[0]).toBe('Members (1):');
    expect(lines[1]).toBe('- PB-P007  [approved-for-acquisition]  title-PB-P007');
  });

  it('shows a no-status placeholder when a member has no lifecycle status', () => {
    const [, line] = formatMembers([src({ sourceId: 'PB-P010', kind: 'monograph', partOf: 'PB-P004' })]);
    expect(line).toContain('[no-status]');
  });

  it('sourceTitle prefers the canonical title, falls back to the first, then a placeholder', () => {
    expect(sourceTitle(src({ sourceId: 'X', kind: 'monograph' }))).toBe('title-X');
    const noTitles = { sourceId: 'Y', kind: 'monograph', titles: [], identifiers: [] } as unknown as Source;
    expect(sourceTitle(noTitles)).toBe('(untitled)');
  });
});
