import { describe, expect, it } from 'vitest';

import {
  isCitedKind,
  isEvidenceClass,
  SOURCE_LIFECYCLE_STATUS_VALUES,
} from '@/bibliography/vocab';

describe('EvidenceClass vocabulary (vocab.ts, 007-corpus-coverage-audit)', () => {
  it('accepts a valid value ("pamphlet")', () => {
    expect(isEvidenceClass('pamphlet')).toBe(true);
  });

  it('rejects an unknown value ("bogus-evidence-class")', () => {
    expect(isEvidenceClass('bogus-evidence-class')).toBe(false);
  });
});

describe('CitedKind vocabulary (vocab.ts, 007-corpus-coverage-audit)', () => {
  it('accepts a valid value ("journal")', () => {
    expect(isCitedKind('journal')).toBe(true);
  });

  it('rejects an unknown value ("bogus-cited-kind")', () => {
    expect(isCitedKind('bogus-cited-kind')).toBe(false);
  });
});

describe('Source lifecycle vocabulary guard (FR-004)', () => {
  it('is unchanged by this feature: exactly discovered/approved-for-acquisition/excluded', () => {
    expect(SOURCE_LIFECYCLE_STATUS_VALUES).toEqual([
      'discovered',
      'approved-for-acquisition',
      'excluded',
    ]);
  });
});
