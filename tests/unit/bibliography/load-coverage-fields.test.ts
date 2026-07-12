import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';

/**
 * T005: the loader carries the coverage-feature authored fields
 * (`evidenceClass`, `references[]`, `knownMemberCount`, `suspected[]`) through
 * onto the loaded {@link Source}. All are optional/additive -- existing sources
 * with none of them load exactly as before (see the regression cases at the
 * bottom). Cross-field/vocab/referential validation (citedKind-in-vocab,
 * resolvedTo-referential, group-only enforcement, non-negative-integer) is the
 * job of the later validation tasks, NOT this loader.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'load-coverage-fields-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSource(name: string, contents: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

describe('loader: evidenceClass + references[] (any Source)', () => {
  it('carries evidenceClass and a full references[] onto the loaded Source', () => {
    const filePath = writeSource(
      'PB-P007.yml',
      `
sourceId: PB-P007
kind: monograph
partOf: PB-P004
titles:
  - text: "Standalone Work with References"
    role: canonical
evidenceClass: pamphlet
references:
  - citedAs: "la Nouvelle France"
    citedKind: journal
    basis: explicit-citation
    notes: "titled as an extract from this journal"
  - citedAs: "Prospectus de la Nouvelle-France"
    citedKind: pamphlet
    basis: "advertised in the colony's promotional matter"
    resolvedTo: PB-P012
`,
    );
    const { source } = loadSourceFile(filePath);

    expect(source.evidenceClass).toBe('pamphlet');
    expect(source.references).toEqual([
      {
        citedAs: 'la Nouvelle France',
        citedKind: 'journal',
        basis: 'explicit-citation',
        notes: 'titled as an extract from this journal',
      },
      {
        citedAs: 'Prospectus de la Nouvelle-France',
        citedKind: 'pamphlet',
        basis: "advertised in the colony's promotional matter",
        resolvedTo: 'PB-P012',
      },
    ]);
  });

  it('carries a minimal reference (only the required citedAs), omitting absent optionals', () => {
    const filePath = writeSource(
      'PB-P007.yml',
      `
sourceId: PB-P007
kind: monograph
titles:
  - text: "Standalone Work with References"
    role: canonical
references:
  - citedAs: "Private Letter to the Governor"
`,
    );
    const { source } = loadSourceFile(filePath);

    expect(source.references).toHaveLength(1);
    const ref = source.references?.[0];
    expect(ref?.citedAs).toBe('Private Letter to the Governor');
    expect(ref?.citedKind).toBeUndefined();
    expect(ref?.basis).toBeUndefined();
    expect(ref?.resolvedTo).toBeUndefined();
    expect(ref?.notes).toBeUndefined();
  });

  it('throws when a reference is missing the required citedAs', () => {
    const filePath = writeSource(
      'PB-P007.yml',
      `
sourceId: PB-P007
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
references:
  - citedKind: journal
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/references\[0\]\.citedAs/);
  });

  it('throws on an unknown key within a reference (no silent drop)', () => {
    const filePath = writeSource(
      'PB-P007.yml',
      `
sourceId: PB-P007
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
references:
  - citedAs: "Some Work"
    bogusRefField: nope
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/unknown key "bogusRefField"/);
  });

  // V1: `evidenceClass` MUST be in EVIDENCE_CLASS_VALUES -- enforced HERE, at
  // load, via `optionalEvidenceClass`'s `isEvidenceClass` narrowing (a
  // strongly-typed field cannot hold a non-member without a forbidden cast).
  // No redundant `bib validate` finding is added for V1 -- see
  // `@/bibliography/validate-coverage-checks`'s doc comment: it would be dead
  // code, since a `CanonicalModel` carrying an out-of-vocab value can never
  // exist (the load already threw).
  it('throws at load, naming the value, for an out-of-vocabulary evidenceClass (V1)', () => {
    const filePath = writeSource(
      'PB-P007.yml',
      `
sourceId: PB-P007
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
evidenceClass: scroll
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/evidenceClass "scroll" is not in the EvidenceClass vocabulary/);
  });

  // V2: `references[].citedKind` MUST be in CITED_KIND_VALUES -- enforced
  // HERE, at load, via `validateReference`'s `isCitedKind` narrowing. Same
  // "no redundant validate-checks finding" reasoning as V1 above.
  it('throws at load, naming the value, for an out-of-vocabulary references[].citedKind (V2)', () => {
    const filePath = writeSource(
      'PB-P007.yml',
      `
sourceId: PB-P007
kind: monograph
titles:
  - text: "Whatever"
    role: canonical
references:
  - citedAs: "Some Work"
    citedKind: scroll
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(
      /references\[0\]\.citedKind "scroll" is not in the CitedKind vocabulary/,
    );
  });
});

describe('loader: knownMemberCount + suspected[] (source-group)', () => {
  it('carries a numeric knownMemberCount and a full suspected[] onto the loaded group', () => {
    const filePath = writeSource(
      'PB-P004.yml',
      `
sourceId: PB-P004
kind: source-group
case: port-breton
titles:
  - text: "Fixture Source Group - Test Campaign"
    role: canonical
knownMemberCount: 3
suspected:
  - description: "appeal-court records for the de Rays trial"
    basis: "trial testimony references an appeal not yet located"
    evidenceClass: trial-record
    notes: "not available online as of last search"
`,
    );
    const { source } = loadSourceFile(filePath);

    expect(source.kind).toBe('source-group');
    expect(source.knownMemberCount).toBe(3);
    expect(source.suspected).toEqual([
      {
        description: 'appeal-court records for the de Rays trial',
        basis: 'trial testimony references an appeal not yet located',
        evidenceClass: 'trial-record',
        notes: 'not available online as of last search',
      },
    ]);
  });

  it("round-trips knownMemberCount: 'unknown' as the literal string (distinct from 0 / absent)", () => {
    const filePath = writeSource(
      'PB-P004.yml',
      `
sourceId: PB-P004
kind: source-group
titles:
  - text: "Fixture Source Group - Test Campaign"
    role: canonical
knownMemberCount: unknown
`,
    );
    const { source } = loadSourceFile(filePath);

    expect(source.knownMemberCount).toBe('unknown');
  });

  it('carries a minimal suspected entry (only required description + basis)', () => {
    const filePath = writeSource(
      'PB-P004.yml',
      `
sourceId: PB-P004
kind: source-group
titles:
  - text: "Fixture Source Group - Test Campaign"
    role: canonical
suspected:
  - description: "some inferred gap"
    basis: "publication pattern implies a missing issue"
`,
    );
    const { source } = loadSourceFile(filePath);

    expect(source.suspected).toHaveLength(1);
    const gap = source.suspected?.[0];
    expect(gap?.description).toBe('some inferred gap');
    expect(gap?.basis).toBe('publication pattern implies a missing issue');
    expect(gap?.evidenceClass).toBeUndefined();
    expect(gap?.notes).toBeUndefined();
  });

  it('throws when a suspected entry is missing required description', () => {
    const filePath = writeSource(
      'PB-P004.yml',
      `
sourceId: PB-P004
kind: source-group
titles:
  - text: "Whatever"
    role: canonical
suspected:
  - basis: "inferred somehow"
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/suspected\[0\]\.description/);
  });

  it('throws when a suspected entry is missing required basis', () => {
    const filePath = writeSource(
      'PB-P004.yml',
      `
sourceId: PB-P004
kind: source-group
titles:
  - text: "Whatever"
    role: canonical
suspected:
  - description: "a suspected work"
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/suspected\[0\]\.basis/);
  });

  it('throws when knownMemberCount is neither a number nor the literal "unknown"', () => {
    const filePath = writeSource(
      'PB-P004.yml',
      `
sourceId: PB-P004
kind: source-group
titles:
  - text: "Whatever"
    role: canonical
knownMemberCount: lots
`,
    );
    expect(() => loadSourceFile(filePath)).toThrow(/knownMemberCount/);
  });
});

describe('loader: coverage fields are optional/additive (regression)', () => {
  it('loads a source carrying none of the new fields exactly as before', () => {
    const filePath = writeSource(
      'PB-P001.yml',
      `
sourceId: PB-P001
kind: periodical
case: port-breton
language: French
titles:
  - text: "La Nouvelle France"
    role: canonical
`,
    );
    const { source } = loadSourceFile(filePath);

    expect(source.evidenceClass).toBeUndefined();
    expect(source.references).toBeUndefined();
    expect(source.knownMemberCount).toBeUndefined();
    expect(source.suspected).toBeUndefined();
    // Existing fields untouched.
    expect(source.sourceId).toBe('PB-P001');
    expect(source.kind).toBe('periodical');
    expect(source.case).toBe('port-breton');
    expect(source.language).toBe('French');
  });
});
