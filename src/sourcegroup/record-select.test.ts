import { describe, it, expect } from 'vitest';
import type { RepositoryRecord } from '@/model/repository-record';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';

/**
 * Tests for `selectRepositoryRecord` (FR-009a, D-05): select one
 * RepositoryRecord for a member by `--archive <sourceArchive>`, inferring
 * the sole record when only one exists and failing loud on ambiguity /
 * no-match / no records.
 */

function record(sourceArchive: string): RepositoryRecord {
  return {
    sourceId: 'PB-P009',
    sourceArchive,
    status: 'wanted',
  };
}

describe('selectRepositoryRecord', () => {
  it('infers the sole record when exactly one exists and no selector is given', () => {
    const records = [record('Gallica / BnF')];

    const selected = selectRepositoryRecord(records);

    expect(selected).toBe(records[0]);
  });

  it('fails loud when >1 record exists and no --archive selector is given', () => {
    const records = [record('Gallica / BnF'), record('State Library of Queensland')];

    expect(() => selectRepositoryRecord(records)).toThrowError(
      /ambiguous|multiple|--archive/i,
    );
    // The error should list the available archives so the operator can pick one.
    try {
      selectRepositoryRecord(records);
      expect.fail('expected selectRepositoryRecord to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('Gallica / BnF');
      expect(message).toContain('State Library of Queensland');
    }
  });

  it('selects the matching record when --archive matches exactly one record', () => {
    const records = [record('Gallica / BnF'), record('State Library of Queensland')];

    const selected = selectRepositoryRecord(records, 'State Library of Queensland');

    expect(selected).toBe(records[1]);
  });

  it('fails loud when --archive matches no record', () => {
    const records = [record('Gallica / BnF'), record('State Library of Queensland')];

    expect(() => selectRepositoryRecord(records, 'HathiTrust')).toThrowError(
      /HathiTrust/,
    );
    try {
      selectRepositoryRecord(records, 'HathiTrust');
      expect.fail('expected selectRepositoryRecord to throw');
    } catch (error) {
      const message = (error as Error).message;
      // Should surface both the requested archive and the available ones.
      expect(message).toContain('HathiTrust');
      expect(message).toContain('Gallica / BnF');
      expect(message).toContain('State Library of Queensland');
    }
  });

  it('fails loud when there are zero records', () => {
    expect(() => selectRepositoryRecord([])).toThrowError(/no repositoryrecord/i);
  });

  it('fails loud when there are zero records even with an --archive selector given', () => {
    expect(() => selectRepositoryRecord([], 'Gallica / BnF')).toThrowError(
      /no repositoryrecord/i,
    );
  });
});
