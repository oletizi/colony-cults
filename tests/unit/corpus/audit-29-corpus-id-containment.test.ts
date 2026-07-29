import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listCorpusManifestIds, loadCorpusManifest } from '@/corpus/manifest';
import { loadBrowserProfile, tryLoadBrowserProfile } from '@/corpus/browser-profile';
import { selectCorpus } from '@/corpus/select';

/**
 * AUDIT-29 REGRESSION — a corpus id is pasted straight into a path.
 *
 * `loadCorpusManifest` built `join(corporaRoot, `${id}.yml`)` BEFORE any id
 * validation, so an id carrying `..` or a path separator read a file the
 * INJECTED ROOT does not contain. Because `--corpus` / `COLONY_CORPUS` flow
 * into `selectCorpus` -> `loadCorpusManifest` unfiltered, that made
 * `bib --corpus ../outside <verb>` yield real narrow policies (cases,
 * id namespace, capabilities, archive-layout overrides) from an out-of-root
 * file -- one `listCorpusManifestIds` never enumerates, so
 * `bib validate-config` never sees it and FR-015's strict policy never
 * applies to it.
 *
 * The same shape existed on the browser-profile loader, where it is even
 * cheaper to reach: a profile's `id` field is deliberately NOT tied to its
 * filename, so no crafted `id:` is needed at all.
 */

let scratch: string;
/** The INJECTED corpora root. Everything legitimate lives directly here. */
let root: string;

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'audit-29-'));
  root = path.join(scratch, 'corpora');
  mkdirSync(root, { recursive: true });
  mkdirSync(path.join(root, 'sub'), { recursive: true });

  const manifest = (id: string): string =>
    [
      'schemaVersion: 1',
      `id: ${JSON.stringify(id)}`,
      'cases:',
      '  - out-of-root-case',
      'sourceIds:',
      '  - prefix: OO',
      '    padWidth: 3',
      '    allocatable: true',
      'requiredCapabilities:',
      '  repositories: []',
      '  sourceQueries: []',
      'archiveLayoutOverrides: null',
      '',
    ].join('\n');

  // OUTSIDE the injected root: `<root>/../outside.yml`.
  writeFileSync(path.join(scratch, 'outside.yml'), manifest('../outside'));
  // Outside the root's ENUMERATED surface: a nested subdirectory.
  writeFileSync(path.join(root, 'sub', 'deep.yml'), manifest('sub/deep'));

  writeFileSync(
    path.join(scratch, 'outside.browser.yml'),
    ['schemaVersion: 1', 'id: out-of-root', 'corpus: outside', 'defaultSources: []', ''].join('\n'),
  );
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('AUDIT-29 — a manifest id must not escape the injected corpora root', () => {
  it('the out-of-root file really is out of root (the escape is not vacuous)', () => {
    // If `listCorpusManifestIds` enumerated it, `bib validate-config` would
    // have covered it and there would be no invisible-policy problem.
    expect(listCorpusManifestIds(root)).toEqual([]);
  });

  it('rejects a `..` traversal id rather than reading outside the root', () => {
    expect(() => loadCorpusManifest(root, '../outside')).toThrow(/corpus id/i);
    expect(() => loadCorpusManifest(root, '../outside')).toThrow(/\.\.\/outside/);
  });

  it('rejects a nested `sub/deep` id -- ids name a file IN the root, not a path', () => {
    expect(() => loadCorpusManifest(root, 'sub/deep')).toThrow(/corpus id/i);
  });

  it('rejects a backslash-separated id (a Windows-authored escape)', () => {
    expect(() => loadCorpusManifest(root, '..\\outside')).toThrow(/corpus id/i);
  });

  it('rejects an absolute id', () => {
    expect(() => loadCorpusManifest(root, path.join(scratch, 'outside'))).toThrow(/corpus id/i);
  });

  it('still loads a legitimate in-root id', () => {
    writeFileSync(
      path.join(root, 'inside.yml'),
      [
        'schemaVersion: 1',
        'id: inside',
        'cases:',
        '  - inside-case',
        'sourceIds:',
        '  - prefix: IN',
        '    padWidth: 3',
        '    allocatable: true',
        'requiredCapabilities:',
        '  repositories: []',
        '  sourceQueries: []',
        'archiveLayoutOverrides: null',
        '',
      ].join('\n'),
    );

    expect(loadCorpusManifest(root, 'inside').id).toBe('inside');
  });
});

describe('AUDIT-29 — selection is the reachable surface (--corpus / COLONY_CORPUS)', () => {
  it('rejects `--corpus ../outside`', () => {
    expect(() => selectCorpus({ corporaRoot: root, cliCorpus: '../outside' })).toThrow(
      /corpus id/i,
    );
  });

  it('rejects `COLONY_CORPUS=../outside`', () => {
    expect(() => selectCorpus({ corporaRoot: root, envCorpus: '../outside' })).toThrow(
      /corpus id/i,
    );
  });
});

describe('AUDIT-29 — the browser-profile loader has the same shape', () => {
  it('rejects a `..` traversal id in loadBrowserProfile', () => {
    expect(() => loadBrowserProfile(root, '../outside')).toThrow(/corpus id/i);
  });

  it('rejects it in tryLoadBrowserProfile too -- absence tolerance is not an escape hatch', () => {
    // The absence-tolerant path must NOT quietly return `null` for a
    // malformed id: that would turn a rejected escape into "no profile".
    expect(() => tryLoadBrowserProfile(root, '../outside')).toThrow(/corpus id/i);
  });
});
