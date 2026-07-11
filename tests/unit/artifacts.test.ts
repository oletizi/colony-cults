import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseProvenance, type ProvenanceFields } from '@/archive/provenance';
import {
  issueArtifactPath,
  pageArtifactPath,
  buildTranslationProvenance,
} from '@/translate/artifacts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(here, '../fixtures/page-provenance.yml');

function loadBase(): ProvenanceFields {
  return parseProvenance(readFileSync(FIXTURE_PATH, 'utf-8'));
}

describe('issueArtifactPath', () => {
  it('builds the whole-issue French artifact path', () => {
    expect(issueArtifactPath('/archive/issue-dir', 'fr')).toBe(
      path.join('/archive/issue-dir', 'issue.fr.txt'),
    );
  });

  it('builds the whole-issue English artifact path', () => {
    expect(issueArtifactPath('/archive/issue-dir', 'en')).toBe(
      path.join('/archive/issue-dir', 'issue.en.txt'),
    );
  });
});

describe('pageArtifactPath', () => {
  it('zero-pads page 1 to p001 under the translation/ subdir (fr)', () => {
    expect(pageArtifactPath('/archive/issue-dir', 1, 'fr')).toBe(
      path.join('/archive/issue-dir', 'translation', 'p001.fr.txt'),
    );
  });

  it('zero-pads page 12 to p012 (en)', () => {
    expect(pageArtifactPath('/archive/issue-dir', 12, 'en')).toBe(
      path.join('/archive/issue-dir', 'translation', 'p012.en.txt'),
    );
  });

  it('handles a 3+ digit page number without truncation', () => {
    expect(pageArtifactPath('/archive/issue-dir', 123, 'fr')).toBe(
      path.join('/archive/issue-dir', 'translation', 'p123.fr.txt'),
    );
  });
});

describe('buildTranslationProvenance', () => {
  it('sets engine/model/translation/format for the corrected-french kind', () => {
    const base = loadBase();
    const result = buildTranslationProvenance(
      base,
      'corrected-french',
      'codex-cli',
      'claude-opus-4',
      '2026-07-08T00:00:00.000Z',
    );

    expect(result.engine).toBe('codex-cli');
    expect(result.model).toBe('claude-opus-4');
    expect(result.translation).toBe('machine-assisted');
    expect(result.retrieved).toBe('2026-07-08T00:00:00.000Z');
    expect(result.type).toBe('corrected-french-text');
    expect(result.format).toBe('text/plain');
    expect(result.language).toBe(base.language);
  });

  it('sets engine/model/translation/format for the english kind, with language English', () => {
    const base = loadBase();
    const result = buildTranslationProvenance(
      base,
      'english',
      'codex-cli',
      'claude-opus-4',
      '2026-07-08T00:00:00.000Z',
    );

    expect(result.engine).toBe('codex-cli');
    expect(result.model).toBe('claude-opus-4');
    expect(result.translation).toBe('machine-assisted');
    expect(result.type).toBe('english-translation');
    expect(result.format).toBe('text/plain');
    expect(result.language).toBe('English');
  });

  it('carries rights_status and citation (title/catalog_url) from base', () => {
    const base = loadBase();
    const result = buildTranslationProvenance(
      base,
      'english',
      'codex-cli',
      'claude-opus-4',
      '2026-07-08T00:00:00.000Z',
    );

    expect(result.rights_status).toBe(base.rights_status);
    expect(result.title).toBe(base.title);
    expect(result.catalog_url).toBe(base.catalog_url);
  });

  it('does not mutate the base ProvenanceFields', () => {
    const base = loadBase();
    const baseCopy = { ...base };
    buildTranslationProvenance(base, 'corrected-french', 'codex-cli', 'claude-opus-4', '2026-07-08T00:00:00.000Z');
    expect(base).toEqual(baseCopy);
  });

  it('returns a distinct object, not the same reference as base', () => {
    const base = loadBase();
    const result = buildTranslationProvenance(
      base,
      'english',
      'codex-cli',
      'claude-opus-4',
      '2026-07-08T00:00:00.000Z',
    );
    expect(result).not.toBe(base);
  });
});
