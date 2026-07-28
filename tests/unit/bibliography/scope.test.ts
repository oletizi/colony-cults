import { describe, expect, it } from 'vitest';

import {
  isFetchableWork,
  resolveScopeRef,
  type ScopeRef,
  type ScopeResolutionContext,
} from '@/bibliography/scope';
import type { Source } from '@/model/source';

/** The stable case slug this fixture's context injects as its one valid case id. */
const PORT_BRETON_CASE_ID = 'port-breton';

/** Minimal well-formed Source fixture; `kind` is the field under test here. */
function makeSource(sourceId: string, kind: Source['kind']): Source {
  return {
    sourceId,
    titles: [{ text: `title for ${sourceId}`, role: 'canonical' }],
    kind,
    identifiers: [],
  };
}

const MONOGRAPH: Source = makeSource('PB-P007', 'monograph');
const PERIODICAL: Source = makeSource('PB-P010', 'periodical');
const GROUP: Source = makeSource('PB-P004', 'source-group');

function makeContext(overrides?: Partial<ScopeResolutionContext>): ScopeResolutionContext {
  return {
    sources: overrides?.sources ?? [MONOGRAPH, PERIODICAL, GROUP],
    threadIds: overrides?.threadIds ?? new Set(['de-rays-trial', 'colony-prospectuses']),
    validCaseIds: overrides?.validCaseIds ?? new Set([PORT_BRETON_CASE_ID]),
  };
}

describe('isFetchableWork (INV-3)', () => {
  it('is true for a monograph Source', () => {
    expect(isFetchableWork(MONOGRAPH)).toBe(true);
  });

  it('is true for a periodical Source', () => {
    expect(isFetchableWork(PERIODICAL)).toBe(true);
  });

  it('is false for a source-group (work-bundle) Source', () => {
    expect(isFetchableWork(GROUP)).toBe(false);
  });
});

describe('resolveScopeRef success cases (INV-1)', () => {
  it('resolves a case ref whose id is the stable port-breton slug', () => {
    const ref: ScopeRef = { kind: 'case', id: PORT_BRETON_CASE_ID };
    const resolved = resolveScopeRef(ref, makeContext());
    expect(resolved.ref).toEqual(ref);
    expect(resolved.source).toBeUndefined();
  });

  it('resolves a thread ref whose id is registered in the context', () => {
    const ref: ScopeRef = { kind: 'thread', id: 'de-rays-trial' };
    const resolved = resolveScopeRef(ref, makeContext());
    expect(resolved.ref).toEqual(ref);
    expect(resolved.source).toBeUndefined();
  });

  it('resolves a work-bundle ref whose id is a source-group Source', () => {
    const ref: ScopeRef = { kind: 'work-bundle', id: 'PB-P004' };
    const resolved = resolveScopeRef(ref, makeContext());
    expect(resolved.ref).toEqual(ref);
    expect(resolved.source).toBe(GROUP);
  });

  it('resolves a work ref whose id is a fetchable (non-group) Source', () => {
    const ref: ScopeRef = { kind: 'work', id: 'PB-P007' };
    const resolved = resolveScopeRef(ref, makeContext());
    expect(resolved.ref).toEqual(ref);
    expect(resolved.source).toBe(MONOGRAPH);
  });
});

describe('resolveScopeRef fail-loud cases (INV-1: kind/referent agreement is checked)', () => {
  it('throws when a case id is not the port-breton slug', () => {
    const ref: ScopeRef = { kind: 'case', id: 'some-other-case' };
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/case/i);
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/port-breton/);
  });

  it('throws when a thread id is absent from the registered thread ids', () => {
    const ref: ScopeRef = { kind: 'thread', id: 'not-registered' };
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/thread/i);
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/not-registered/);
  });

  it('throws when a work-bundle id resolves to a Source that is NOT a source-group', () => {
    const ref: ScopeRef = { kind: 'work-bundle', id: 'PB-P007' };
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/work-bundle/);
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/source-group/);
  });

  it('throws when a work id resolves to a Source that IS a source-group', () => {
    const ref: ScopeRef = { kind: 'work', id: 'PB-P004' };
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/work/);
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/source-group/);
  });

  it('throws when a work-bundle id resolves to no Source at all', () => {
    const ref: ScopeRef = { kind: 'work-bundle', id: 'PB-P999' };
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/PB-P999/);
  });

  it('throws when a work id resolves to no Source at all', () => {
    const ref: ScopeRef = { kind: 'work', id: 'PB-P999' };
    expect(() => resolveScopeRef(ref, makeContext())).toThrow(/PB-P999/);
  });
});

/**
 * T011 (spec 018-corpus-config-seam, FR-004/FR-010): `validCaseIds` is an
 * INJECTED policy, not a module constant -- these tests exercise a SECOND,
 * DIFFERENT injected set to prove the case id is genuinely gone from
 * `scope.ts`, not merely relocated behind a same-shaped default.
 */
describe('resolveScopeRef case resolution: validCaseIds is injected, not hardcoded (FR-004)', () => {
  it('accepts an id that IS in the injected validCaseIds set', () => {
    const ctx = makeContext({ validCaseIds: new Set(['synthetic-case']) });
    const ref: ScopeRef = { kind: 'case', id: 'synthetic-case' };
    const resolved = resolveScopeRef(ref, ctx);
    expect(resolved.ref).toEqual(ref);
  });

  it('rejects an id that is NOT in the injected validCaseIds set', () => {
    const ctx = makeContext({ validCaseIds: new Set(['synthetic-case']) });
    const ref: ScopeRef = { kind: 'case', id: 'some-other-case' };
    expect(() => resolveScopeRef(ref, ctx)).toThrow(/some-other-case/);
  });

  it('a DIFFERENT injected set accepts its own case and rejects port-breton', () => {
    const ctx = makeContext({ validCaseIds: new Set(['synthetic-case']) });
    expect(() => resolveScopeRef({ kind: 'case', id: 'synthetic-case' }, ctx)).not.toThrow();
    expect(() => resolveScopeRef({ kind: 'case', id: PORT_BRETON_CASE_ID }, ctx)).toThrow(
      /port-breton/,
    );
  });

  it('the rejection message names every valid id from the injected set', () => {
    const ctx = makeContext({ validCaseIds: new Set(['case-b', 'case-a']) });
    expect(() => resolveScopeRef({ kind: 'case', id: 'unknown-case' }, ctx)).toThrow(
      /valid ids: case-a, case-b/,
    );
  });

  it('names "(none configured)" when the injected set is empty', () => {
    const ctx = makeContext({ validCaseIds: new Set() });
    expect(() => resolveScopeRef({ kind: 'case', id: 'anything' }, ctx)).toThrow(
      /\(none configured\)/,
    );
  });
});
