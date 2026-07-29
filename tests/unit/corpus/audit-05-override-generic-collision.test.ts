import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveSourceLayout } from '@/archive/derive-layout';
import { validateCorpora, type InstalledCapabilities } from '@/corpus/validate';

/**
 * AUDIT-05 REGRESSION — override collision detection only ever compared
 * overrides to OTHER OVERRIDES.
 *
 * `@/corpus/validate-overrides`' own header states the four things every
 * override must prove, clause (d) being that it "does not collide with
 * another Source's location". The implementation seeded its `claimants` map
 * exclusively from override `relativePath`s, so an override aimed at a
 * Source's RULE-DERIVED location -- the overwhelmingly more common shape,
 * since most Sources carry no override at all -- was invisible.
 *
 * The fixture aims `AL002`'s override at exactly the string
 * `deriveSourceLayout` produces for `AL001`.
 *
 * SECOND GAP, same file: a malformed override path (not
 * `archive/cases/<case>/<type>/<slug>`) also passed validation and then threw
 * at RESOLVE time inside `@/archive/layout-resolve`'s `layoutFromOverride` --
 * i.e. the config gate green-lit a manifest that cannot resolve.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CORPORA = path.join(REPO_ROOT, 'tests', 'fixtures', 'corpora', 'validate-generic-collision');
const SOURCES = path.join(REPO_ROOT, 'tests', 'fixtures', 'sources', 'validate-generic-collision');

const NO_CAPABILITIES: InstalledCapabilities = { repositories: [], sourceQueries: [] };

/** AL001's generic location, computed by the SAME function production uses. */
const AL001_DERIVED = 'archive/cases/alpha-case/books/alpha-one';

describe('AUDIT-05 — an override colliding with a rule-derived location', () => {
  it('the fixture really does aim at AL001\'s derived location (not a coincidence)', () => {
    const layout = deriveSourceLayout({
      sourceId: 'AL001',
      case: 'alpha-case',
      kind: 'monograph',
      titles: [{ text: 'Alpha One', role: 'canonical' }],
    });

    expect(`archive/cases/${layout.case}/${layout.type}/${layout.slug}`).toBe(AL001_DERIVED);
  });

  it('reports override-duplicate-location, naming both claimants', () => {
    const result = validateCorpora(CORPORA, SOURCES, NO_CAPABILITIES);

    const collisions = result.findings.filter((f) => f.rule === 'override-duplicate-location');
    expect(collisions).toHaveLength(1);
    expect(collisions[0].subject).toBe(AL001_DERIVED);
    // The override claimant and the generic-layout claimant, both named.
    expect(collisions[0].message).toContain('alpha/AL002');
    expect(collisions[0].message).toContain('AL001');
    expect(result.ok).toBe(false);
  });

  it('reports override-path-malformed at VALIDATION time, not at resolve time', () => {
    const result = validateCorpora(CORPORA, SOURCES, NO_CAPABILITIES);

    const malformed = result.findings.filter((f) => f.rule === 'override-path-malformed');
    expect(malformed).toHaveLength(1);
    expect(malformed[0].subject).toBe('alpha/AL003');
    expect(malformed[0].message).toContain('totally/wrong/shape');
    expect(malformed[0].message).toContain('archive/cases/<case>/<type>/<slug>');
  });

  it('the REAL committed config stays clean under the widened rule', () => {
    const result = validateCorpora(
      path.join(REPO_ROOT, 'corpora'),
      path.join(REPO_ROOT, 'bibliography', 'sources'),
      {
        repositories: ['gallica', 'new-italy-museum', 'internet-archive', 'papers-past'],
        sourceQueries: ['papers-past', 'papers-past-article'],
      },
    );

    expect(result.findings).toEqual([]);
  });
});
