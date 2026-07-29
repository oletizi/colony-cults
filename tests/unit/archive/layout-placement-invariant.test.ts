import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { composeArchiveLayoutPolicy } from '@/archive/layout-bootstrap';
import {
  assertRecordedPlacementsHonored,
  recordedPlacement,
} from '@/archive/layout-placement-invariant';
import type { Source } from '@/model/source';
import {
  installArchiveLayoutPolicy,
  resetArchiveLayoutResolution,
  sourceLayout,
} from '@/archive/location';
import {
  resolveCorporaRoot,
  resolveRepoRootUpward,
  resolveSourcesDir,
} from '@/cli/composition-root';

/**
 * AUDIT-32: A MISSING OVERRIDE MUST NOT SILENTLY DERIVE A DIFFERENT SLUG.
 *
 * `sourceLayout` falls from "no override for this Source" straight to the
 * generic derivation with no throw, and `issueDir` -- the WRITE path -- has no
 * existence guard. So removing one `archiveLayoutOverrides` entry did not
 * fail anything: it just relocated the Source. The first fetch would then
 * `mkdir` a parallel directory beside the committed masters -- an orphan
 * asset (Principle XV).
 *
 * The first case here is the empirical reproduction: the REAL `port-breton`
 * manifest, copied to a temp corpora root with `archiveLayoutOverrides`
 * stripped, composed against the REAL bibliography SSOT. Before the invariant
 * it composed cleanly and resolved `PB-P002` to the wrong slug; now it throws
 * naming both directories.
 *
 * The remaining cases pin the two properties that make the invariant safe to
 * turn on: it is SILENT for the committed corpus as it actually stands, and it
 * is SILENT for a Source that has simply not been fetched/summarized yet
 * (the false positive that would have made a filesystem-existence check
 * unusable).
 */

const repoRoot = resolveRepoRootUpward();
const realCorporaRoot = resolveCorporaRoot(repoRoot);
const realSourcesDir = resolveSourcesDir(repoRoot);

/** The two ids the committed manifest declares overrides for. */
const OVERRIDDEN_ID = 'PB-P002';
const RECORDED_DIR = 'archive/cases/port-breton/books/nouvelle-france-colonie-libre-port-breton';
const DERIVED_DIR =
  'archive/cases/port-breton/books/colonie-libre-de-port-breton-nouvelle-france-en-oceanie';

const tempDirs: string[] = [];

/** A corpora root holding the real port-breton manifest, mutated by `edit`. */
function corporaRootWith(edit: (manifest: Record<string, unknown>) => void): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cc-placement-corpora-'));
  tempDirs.push(dir);
  const raw = readFileSync(path.join(realCorporaRoot, 'port-breton.yml'), 'utf-8');
  const parsed: unknown = parseYaml(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('port-breton.yml did not parse to a mapping');
  }
  const manifest: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  edit(manifest);
  writeFileSync(path.join(dir, 'port-breton.yml'), stringifyYaml(manifest), 'utf-8');
  return dir;
}

afterAll(() => {
  resetArchiveLayoutResolution();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('archive-layout placement invariant (AUDIT-32)', () => {
  it('the committed corpus composes cleanly -- the invariant does not fire spuriously', () => {
    expect(() =>
      composeArchiveLayoutPolicy({
        corporaRoot: realCorporaRoot,
        sourcesDir: realSourcesDir,
      }),
    ).not.toThrow();
  });

  it('composing with archiveLayoutOverrides stripped THROWS, naming both directories', () => {
    const corporaRoot = corporaRootWith((manifest) => {
      delete manifest.archiveLayoutOverrides;
    });

    let thrown: unknown;
    try {
      composeArchiveLayoutPolicy({ corporaRoot, sourcesDir: realSourcesDir });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : '';
    expect(message).toContain(OVERRIDDEN_ID);
    // BOTH paths must be named: the one it would have written to, and the one
    // the record says the bytes are at.
    expect(message).toContain(DERIVED_DIR);
    expect(message).toContain(RECORDED_DIR);
    expect(message).toMatch(/summaryRef/);
  });

  it('the pre-invariant behavior was a SILENTLY WRONG WRITE PATH, not an error', () => {
    // What the defect actually produced, pinned so the regression is legible:
    // the derived slug is a real, resolvable layout that simply is not where
    // the committed masters live. `installArchiveLayoutPolicy` is used to
    // reach `sourceLayout` without going through the (now guarded)
    // composition, exactly as the audit reproduced it.
    installArchiveLayoutPolicy({
      overrides: new Map(),
      derived: new Map([
        [
          OVERRIDDEN_ID,
          {
            case: 'port-breton',
            type: 'books',
            slug: 'colonie-libre-de-port-breton-nouvelle-france-en-oceanie',
            kind: 'monograph',
          },
        ],
      ]),
    });
    expect(sourceLayout(OVERRIDDEN_ID).slug).toBe(
      'colonie-libre-de-port-breton-nouvelle-france-en-oceanie',
    );
    resetArchiveLayoutResolution();
  });

  it('a Source with no recorded archive path is NOT checked -- an unfetched Source is not a defect', () => {
    // This is the property that makes the invariant safe to turn on. A
    // filesystem-existence check would fire on every Source whose directory
    // has not been created yet, which is the ordinary state of an unfetched
    // Source. Anchoring in `summaryRef` -- written only once a summary has
    // been stored under the Source's REAL directory -- means such a Source
    // simply has nothing to disagree with.
    const unfetched: Source = {
      sourceId: 'ZZ-P900',
      kind: 'monograph',
      case: 'somewhere',
      titles: [{ text: 'Never Fetched', role: 'canonical' }],
      identifiers: [],
    };
    expect(recordedPlacement(unfetched)).toBeUndefined();

    // ... and a policy that places it anywhere at all still composes.
    expect(() =>
      assertRecordedPlacementsHonored({
        sources: [unfetched],
        overrides: new Map(),
        derived: new Map([
          [
            'ZZ-P900',
            { case: 'somewhere', type: 'books', slug: 'anything-at-all', kind: 'monograph' },
          ],
        ]),
      }),
    ).not.toThrow();
  });

  it('a recorded placement IS read back from a summaryRef, so the silence above is not vacuous', () => {
    const summarized: Source = {
      sourceId: 'ZZ-P901',
      kind: 'monograph',
      case: 'somewhere',
      titles: [{ text: 'Already Summarized', role: 'canonical' }],
      identifiers: [],
      summaryRef: 'archive/cases/somewhere/books/the-real-slug/source.summary.long.en.md',
    };
    expect(recordedPlacement(summarized)).toEqual({
      caseId: 'somewhere',
      type: 'books',
      slug: 'the-real-slug',
      ref: summarized.summaryRef,
    });
  });

  it('an override that DISAGREES with the record throws too -- the check is two-directional', () => {
    const corporaRoot = corporaRootWith((manifest) => {
      manifest.archiveLayoutOverrides = {
        [OVERRIDDEN_ID]: {
          relativePath: 'archive/cases/port-breton/books/somewhere-else-entirely',
          reason: 'deliberately wrong, to prove a bogus override is not rubber-stamped',
        },
      };
    });

    expect(() =>
      composeArchiveLayoutPolicy({ corporaRoot, sourcesDir: realSourcesDir }),
    ).toThrow(/somewhere-else-entirely[\s\S]*nouvelle-france-colonie-libre-port-breton/);
  });
});
