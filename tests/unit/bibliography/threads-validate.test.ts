import { describe, expect, it } from 'vitest';

import type { CanonicalModel } from '@/bibliography/model';
import { validateSourceThreads } from '@/bibliography/validate-checks';
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

describe('validateSourceThreads (spec 010, US5, FR-010/FR-011, INV-5)', () => {
  it('(a) an empty registry + a Source with no threads validates clean', () => {
    const model = makeModel({ sources: [makeSource()] });

    const findings = validateSourceThreads(model, new Set());

    expect(findings).toHaveLength(0);
  });

  it("(b) a Source with threads: ['x'] where 'x' is NOT in the registry fails loud", () => {
    const source = makeSource({ threads: ['x'] });
    const model = makeModel({ sources: [source] });

    const findings = validateSourceThreads(model, new Set());

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('source-thread-unresolved');
    expect(findings[0]?.sourceId).toBe('PB-P001');
    expect(findings[0]?.detail).toMatch(/"x"/);
  });

  it("(c) a Source with threads: ['t'] where 't' IS a registered thread validates clean", () => {
    const source = makeSource({ threads: ['t'] });
    const model = makeModel({ sources: [source] });

    const findings = validateSourceThreads(model, new Set(['t']));

    expect(findings).toHaveLength(0);
  });
});
