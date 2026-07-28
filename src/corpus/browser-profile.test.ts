import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadBrowserProfile, tryLoadBrowserProfile } from '@/corpus/browser-profile';

const FIXTURES_ROOT = join(__dirname, '..', '..', 'tests', 'fixtures', 'corpora');
const PROFILE_CASES_ROOT = join(FIXTURES_ROOT, 'browser-profile-cases');
const ARBITRARY_ROOT = join(FIXTURES_ROOT, 'an-arbitrary-place');

describe('loadBrowserProfile', () => {
  it('accepts a valid profile', () => {
    const profile = loadBrowserProfile(PROFILE_CASES_ROOT, 'valid');

    expect(profile).toEqual({
      schemaVersion: 1,
      id: 'valid',
      corpus: 'alpha',
      defaultSources: ['AL-001', 'AL-002'],
    });
  });

  it('accepts a profile with an empty defaultSources array', () => {
    const profile = loadBrowserProfile(PROFILE_CASES_ROOT, 'valid-empty-defaults');
    expect(profile.defaultSources).toEqual([]);
  });

  it('loads correctly from an arbitrary injected corporaRoot (FR-016 proof)', () => {
    const profile = loadBrowserProfile(ARBITRARY_ROOT, 'zzz-custom');

    expect(profile.id).toBe('zzz-custom-browser');
    expect(profile.corpus).toBe('zzz-custom');
    expect(profile.defaultSources).toEqual(['ZZ-00001']);
  });

  it('rejects an unsupported schemaVersion', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'unsupported-version')).toThrow(
      /unsupported schemaVersion/,
    );
  });

  it('rejects malformed YAML', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'malformed')).toThrow(/malformed YAML/);
  });

  it('rejects a missing "id" field', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'missing-id')).toThrow(
      /"id" must be a non-empty string/,
    );
  });

  it('rejects an empty "corpus" field', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'empty-corpus')).toThrow(
      /"corpus" must be a non-empty string/,
    );
  });

  it('rejects a missing "defaultSources" field', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'missing-default-sources')).toThrow(
      /"defaultSources" must be an array/,
    );
  });

  it('rejects a "defaultSources" that is not an array', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'bad-default-sources-not-array')).toThrow(
      /"defaultSources" must be an array/,
    );
  });

  it('rejects a "defaultSources" entry that is not a non-empty string', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'bad-default-sources-entry')).toThrow(
      /"defaultSources\[1\]" must be a non-empty string/,
    );
  });

  it('rejects an unknown top-level key', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'unknown-top-level-key')).toThrow(
      /unknown key "extraField"/,
    );
  });

  it('rejects a missing file with a descriptive, locating error', () => {
    expect(() => loadBrowserProfile(PROFILE_CASES_ROOT, 'does-not-exist')).toThrow(
      /cannot read file/,
    );
  });
});

describe('tryLoadBrowserProfile', () => {
  it('returns the profile when the file exists and is valid', () => {
    const profile = tryLoadBrowserProfile(PROFILE_CASES_ROOT, 'valid');
    expect(profile).not.toBeNull();
    expect(profile?.id).toBe('valid');
  });

  it('returns null when the profile file does not exist (FR-005: absence must not throw)', () => {
    expect(tryLoadBrowserProfile(PROFILE_CASES_ROOT, 'does-not-exist')).toBeNull();
  });

  it('still throws loud on a profile that exists but is malformed (only ABSENCE is tolerated)', () => {
    expect(() => tryLoadBrowserProfile(PROFILE_CASES_ROOT, 'malformed')).toThrow(
      /malformed YAML/,
    );
  });

  it('still throws loud on a profile that exists but fails structural validation', () => {
    expect(() => tryLoadBrowserProfile(PROFILE_CASES_ROOT, 'unsupported-version')).toThrow(
      /unsupported schemaVersion/,
    );
  });
});
