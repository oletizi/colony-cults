import { describe, expect, it } from 'vitest';

import { deriveSourceFilenamePolicy } from '@/corpus/policies';
import { unionSourceFilenamePolicy } from '@/corpus/source-filename-bootstrap';
import { buildSourceFilenamePolicy } from '@/corpus/source-filename-policy';
import type { CorpusManifest } from '@/corpus/manifest';

/**
 * The fifth seam's POLICY SHAPE (T023, specs/018-corpus-config-seam FR-018,
 * INV-16). Loader-level enumeration behavior -- including the empirical
 * "exactly 94 real records" check -- lives in
 * `tests/unit/bibliography/load-source-filename-policy.test.ts`; this file
 * pins the predicate itself.
 */

/** Port Breton's real manifest shape (corpora/port-breton.yml), inline. */
function portBretonManifest(): CorpusManifest {
  return {
    schemaVersion: 1,
    id: 'port-breton',
    cases: ['port-breton'],
    sourceIds: [
      { prefix: 'PB-P', padWidth: 3, allocatable: true },
      { prefix: 'PB-S', padWidth: 3, allocatable: false },
    ],
    requiredCapabilities: { repositories: ['gallica'], sourceQueries: [] },
    archiveLayoutOverrides: null,
  };
}

/** A synthetic second corpus -- the SC-003/FR-011 fixture-only shape. */
function syntheticManifest(): CorpusManifest {
  return {
    schemaVersion: 1,
    id: 'synthetic',
    cases: ['synthetic'],
    sourceIds: [{ prefix: 'SYN-', padWidth: 3, allocatable: true }],
    requiredCapabilities: { repositories: ['gallica'], sourceQueries: [] },
    archiveLayoutOverrides: null,
  };
}

describe('buildSourceFilenamePolicy', () => {
  it('matches a filename against ANY declared shape (Port Breton has two)', () => {
    const policy = buildSourceFilenamePolicy([
      { prefix: 'PB-P', padWidth: 3 },
      { prefix: 'PB-S', padWidth: 3 },
    ]);

    expect(policy.isSourceFile('PB-P001.yml')).toBe(true);
    expect(policy.isSourceFile('PB-S001.yml')).toBe(true);
  });

  it('excludes a filename matching NO shape', () => {
    const policy = buildSourceFilenamePolicy([{ prefix: 'PB-P', padWidth: 3 }]);

    expect(policy.isSourceFile('SYN-001.yml')).toBe(false);
    expect(policy.isSourceFile('not-a-source.yml')).toBe(false);
    expect(policy.isSourceFile('README.md')).toBe(false);
    // Non-`.yml` extension, right stem.
    expect(policy.isSourceFile('PB-P001.yaml')).toBe(false);
  });

  it('holds the digit count to EXACTLY padWidth (FR-010: the retired pattern was anchored)', () => {
    const policy = buildSourceFilenamePolicy([{ prefix: 'PB-P', padWidth: 3 }]);

    expect(policy.isSourceFile('PB-P001.yml')).toBe(true);
    expect(policy.isSourceFile('PB-P0001.yml')).toBe(false);
    expect(policy.isSourceFile('PB-P01.yml')).toBe(false);
  });

  it('anchors both ends -- a prefixed/suffixed name is not a Source file', () => {
    const policy = buildSourceFilenamePolicy([{ prefix: 'PB-P', padWidth: 3 }]);

    expect(policy.isSourceFile('old-PB-P001.yml')).toBe(false);
    expect(policy.isSourceFile('PB-P001.yml.bak')).toBe(false);
  });

  it('escapes regex metacharacters in a prefix rather than interpolating raw', () => {
    // `.` would match ANY character if interpolated raw, so `PBxP001.yml`
    // would wrongly be a Source file.
    const policy = buildSourceFilenamePolicy([{ prefix: 'PB.P', padWidth: 3 }]);

    expect(policy.isSourceFile('PB.P001.yml')).toBe(true);
    expect(policy.isSourceFile('PBxP001.yml')).toBe(false);
  });

  it('fails loud on an empty shape list rather than matching nothing silently', () => {
    expect(() => buildSourceFilenamePolicy([])).toThrow(/no source-ID shapes/);
  });

  it('fails loud on a non-positive padWidth and an empty prefix', () => {
    expect(() => buildSourceFilenamePolicy([{ prefix: 'PB-P', padWidth: 0 }])).toThrow(
      /padWidth/,
    );
    expect(() => buildSourceFilenamePolicy([{ prefix: '', padWidth: 3 }])).toThrow(
      /empty prefix/,
    );
  });
});

describe('deriveSourceFilenamePolicy', () => {
  it('derives BOTH Port Breton shapes -- allocatable AND non-allocatable (FR-002b/FR-010)', () => {
    const policy = deriveSourceFilenamePolicy({
      corporaRoot: '/unused',
      manifest: portBretonManifest(),
    });

    expect(policy.isSourceFile('PB-P001.yml')).toBe(true);
    // The 2 hand-authored secondary works: dropping these would break FR-010.
    expect(policy.isSourceFile('PB-S001.yml')).toBe(true);
    expect(policy.isSourceFile('SYN-001.yml')).toBe(false);
    expect(policy.shapes.map((shape) => shape.prefix)).toEqual(['PB-P', 'PB-S']);
  });

  it('derives a SECOND corpus\'s shape with no core edit (INV-16, SC-003)', () => {
    const policy = deriveSourceFilenamePolicy({
      corporaRoot: '/unused',
      manifest: syntheticManifest(),
    });

    expect(policy.isSourceFile('SYN-001.yml')).toBe(true);
    expect(policy.isSourceFile('PB-P001.yml')).toBe(false);
  });
});

describe('unionSourceFilenamePolicy', () => {
  it('recognizes every shape of every committed manifest', () => {
    const policy = unionSourceFilenamePolicy([portBretonManifest(), syntheticManifest()]);

    expect(policy.isSourceFile('PB-P001.yml')).toBe(true);
    expect(policy.isSourceFile('PB-S001.yml')).toBe(true);
    expect(policy.isSourceFile('SYN-001.yml')).toBe(true);
    expect(policy.isSourceFile('OTHER-001.yml')).toBe(false);
  });

  it('fails loud when there are no manifests at all', () => {
    expect(() => unionSourceFilenamePolicy([])).toThrow(/no source-ID shapes/);
  });
});
