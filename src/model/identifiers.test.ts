import { describe, it, expect } from 'vitest';
import type { CopyLevelIdentifierType, WorkLevelIdentifierType } from '@/model/identifiers';
import { classifyIdentifier } from '@/model/identifiers';

describe('CopyLevelIdentifierType', () => {
  it('should accept the new ia-item identifier type', () => {
    const type: CopyLevelIdentifierType = 'ia-item';
    expect(type).toBe('ia-item');
  });

  it('should accept all existing copy-level identifier types', () => {
    const accession: CopyLevelIdentifierType = 'accession';
    const ark: CopyLevelIdentifierType = 'ark';
    const iiifManifest: CopyLevelIdentifierType = 'iiif-manifest';
    const scanDoi: CopyLevelIdentifierType = 'scan-doi';

    expect(accession).toBe('accession');
    expect(ark).toBe('ark');
    expect(iiifManifest).toBe('iiif-manifest');
    expect(scanDoi).toBe('scan-doi');
  });

  it('should classify ia-item as a copy-level identifier', () => {
    const result = classifyIdentifier('ia-item');
    expect(result).toBe('copy');
  });
});

describe('WorkLevelIdentifierType', () => {
  it('should accept all work-level identifier types', () => {
    const isbn: WorkLevelIdentifierType = 'isbn';
    const issn: WorkLevelIdentifierType = 'issn';
    const oclc: WorkLevelIdentifierType = 'oclc';

    expect(isbn).toBe('isbn');
    expect(issn).toBe('issn');
    expect(oclc).toBe('oclc');
  });
});
