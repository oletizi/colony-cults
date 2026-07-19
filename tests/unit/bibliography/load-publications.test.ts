import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';

/**
 * Loader coverage for the specs/008 edition-publishing SSOT fields `rights` and
 * `publications[]` (T006): a valid source round-trips both onto `LoadedSource`,
 * an unrecognized `rights.status` fails loud, a duplicate
 * `(variant, snapshotShort)` fails loud, and a legacy source carrying neither
 * field still loads unchanged (additive-only).
 */

const BASE = `sourceId: PB-P001
kind: periodical
titles:
  - text: "La Nouvelle France"
    role: canonical
`;

const RIGHTS_BLOCK = `rights:
  status: public-domain
  basis: "1881 imprint; French public domain"
  determinedAt: "2026-07-12"
`;

function publicationsBlock(entries: string): string {
  return `publications:\n${entries}`;
}

const ENGLISH_ONLY_PUB = `  - variant: english-only
    publishedAt: "2026-07-12"
    snapshot: "3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10"
    snapshotShort: "3b8b1fd6"
    cdnBase: "https://colony-cults-cdn.oletizi.workers.dev"
    keyScheme: versioned
    rightsBasis: "1881 imprint; French public domain"
    machineAssist:
      engine: "claude"
      retrieved: "2026-07-12"
    manifest:
      manifestPath: "bibliography/publications/PB-P001-english-only-3b8b1fd6.yml"
      issueCount: 71
`;

// AUDIT-20260719-03/04: a publications[] entry carrying BOTH machineAssist
// and ocrTranscription -- two conflicting provenance stories.
const BOTH_DISCLOSURES_PUB = `  - variant: english-only
    publishedAt: "2026-07-12"
    snapshot: "3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10"
    snapshotShort: "3b8b1fd6"
    cdnBase: "https://colony-cults-cdn.oletizi.workers.dev"
    keyScheme: versioned
    rightsBasis: "1881 imprint; French public domain"
    machineAssist:
      engine: "claude"
      retrieved: "2026-07-12"
    ocrTranscription:
      engineStatus: "machine OCR · tesseract 5 (searchable)"
    manifest:
      manifestPath: "bibliography/publications/PB-P001-english-only-3b8b1fd6.yml"
      issueCount: 71
`;

// AUDIT-20260719-03: a publications[] entry carrying NEITHER disclosure --
// zero provenance disclosure (Constitution III/IV).
const NEITHER_DISCLOSURE_PUB = `  - variant: english-only
    publishedAt: "2026-07-12"
    snapshot: "3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10"
    snapshotShort: "3b8b1fd6"
    cdnBase: "https://colony-cults-cdn.oletizi.workers.dev"
    keyScheme: versioned
    rightsBasis: "1881 imprint; French public domain"
    manifest:
      manifestPath: "bibliography/publications/PB-P001-english-only-3b8b1fd6.yml"
      issueCount: 71
`;

// AUDIT-20260719-07: variant × disclosure cross-check fixtures. `parallel` is
// inherently FR-OCR / EN-translation and must carry machineAssist, never
// ocrTranscription. `english-only` is ambiguous and valid with EITHER (a
// French source rendered english-only carries machineAssist; an English OCR
// source carries ocrTranscription).
const PARALLEL_MACHINE_ASSIST_PUB = `  - variant: parallel
    publishedAt: "2026-07-12"
    snapshot: "3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10"
    snapshotShort: "3b8b1fd6"
    cdnBase: "https://colony-cults-cdn.oletizi.workers.dev"
    keyScheme: versioned
    rightsBasis: "1881 imprint; French public domain"
    machineAssist:
      engine: "claude"
      retrieved: "2026-07-12"
    manifest:
      manifestPath: "bibliography/publications/PB-P001-parallel-3b8b1fd6.yml"
      issueCount: 71
`;

const PARALLEL_OCR_TRANSCRIPTION_PUB = `  - variant: parallel
    publishedAt: "2026-07-12"
    snapshot: "3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10"
    snapshotShort: "3b8b1fd6"
    cdnBase: "https://colony-cults-cdn.oletizi.workers.dev"
    keyScheme: versioned
    rightsBasis: "1881 imprint; French public domain"
    ocrTranscription:
      engineStatus: "machine OCR · tesseract 5 (searchable)"
    manifest:
      manifestPath: "bibliography/publications/PB-P001-parallel-3b8b1fd6.yml"
      issueCount: 71
`;

const ENGLISH_ONLY_OCR_TRANSCRIPTION_PUB = `  - variant: english-only
    publishedAt: "2026-07-12"
    snapshot: "3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10"
    snapshotShort: "3b8b1fd6"
    cdnBase: "https://colony-cults-cdn.oletizi.workers.dev"
    keyScheme: versioned
    rightsBasis: "1881 imprint; French public domain"
    ocrTranscription:
      engineStatus: "machine OCR · tesseract 5 (searchable)"
    manifest:
      manifestPath: "bibliography/publications/PB-P001-english-only-3b8b1fd6.yml"
      issueCount: 71
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bibliography-load-pub-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSource(contents: string): string {
  const filePath = path.join(dir, 'PB-P001.yml');
  writeFileSync(filePath, contents, 'utf-8');
  return filePath;
}

describe('loadSourceFile rights + publications (specs/008)', () => {
  it('round-trips a valid rights block + publications[] onto the LoadedSource', () => {
    const filePath = writeSource(BASE + RIGHTS_BLOCK + publicationsBlock(ENGLISH_ONLY_PUB));
    const { source } = loadSourceFile(filePath);

    expect(source.rights).toEqual({
      status: 'public-domain',
      basis: '1881 imprint; French public domain',
      determinedAt: '2026-07-12',
    });

    expect(source.publications).toHaveLength(1);
    const [pub] = source.publications ?? [];
    expect(pub).toEqual({
      variant: 'english-only',
      publishedAt: '2026-07-12',
      snapshot: '3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10',
      snapshotShort: '3b8b1fd6',
      cdnBase: 'https://colony-cults-cdn.oletizi.workers.dev',
      keyScheme: 'versioned',
      rightsBasis: '1881 imprint; French public domain',
      machineAssist: { engine: 'claude', model: null, retrieved: '2026-07-12' },
      manifest: {
        manifestPath: 'bibliography/publications/PB-P001-english-only-3b8b1fd6.yml',
        issueCount: 71,
      },
    });
  });

  it('throws on an unrecognized rights.status', () => {
    const badRights = `rights:
  status: all-rights-reserved
  basis: "not a recognized status"
`;
    const filePath = writeSource(BASE + badRights);
    expect(() => loadSourceFile(filePath)).toThrow(/all-rights-reserved/);
  });

  it('throws on a duplicate (variant, snapshotShort) within publications[]', () => {
    const filePath = writeSource(
      BASE + publicationsBlock(ENGLISH_ONLY_PUB + ENGLISH_ONLY_PUB),
    );
    expect(() => loadSourceFile(filePath)).toThrow(/duplicate publication/);
  });

  it('loads a legacy source with neither rights nor publications', () => {
    const filePath = writeSource(BASE);
    const { source } = loadSourceFile(filePath);
    expect(source.rights).toBeUndefined();
    expect(source.publications).toBeUndefined();
  });
});

describe('loadSourceFile publications[] exactly-one-disclosure invariant (AUDIT-20260719-03/04)', () => {
  it('throws (locating) when a publications[] entry carries BOTH machineAssist and ocrTranscription', () => {
    const filePath = writeSource(BASE + publicationsBlock(BOTH_DISCLOSURES_PUB));
    expect(() => loadSourceFile(filePath)).toThrow(/publications\[0\]/);
    expect(() => loadSourceFile(filePath)).toThrow(/machineAssist/);
    expect(() => loadSourceFile(filePath)).toThrow(/ocrTranscription/);
  });

  it('throws (locating) when a publications[] entry carries NEITHER machineAssist nor ocrTranscription', () => {
    const filePath = writeSource(BASE + publicationsBlock(NEITHER_DISCLOSURE_PUB));
    expect(() => loadSourceFile(filePath)).toThrow(/publications\[0\]/);
    expect(() => loadSourceFile(filePath)).toThrow(/machineAssist/);
    expect(() => loadSourceFile(filePath)).toThrow(/ocrTranscription/);
  });
});

describe('loadSourceFile publications[] variant x disclosure consistency (AUDIT-20260719-07)', () => {
  it('accepts variant "parallel" + machineAssist (the FR-OCR / EN-translation story)', () => {
    const filePath = writeSource(BASE + publicationsBlock(PARALLEL_MACHINE_ASSIST_PUB));
    const { source } = loadSourceFile(filePath);
    const [pub] = source.publications ?? [];
    expect(pub?.variant).toBe('parallel');
    expect(pub?.machineAssist).toBeDefined();
    expect(pub?.ocrTranscription).toBeUndefined();
  });

  it('accepts variant "english-only" + machineAssist (a French source rendered english-only)', () => {
    const filePath = writeSource(BASE + publicationsBlock(ENGLISH_ONLY_PUB));
    const { source } = loadSourceFile(filePath);
    const [pub] = source.publications ?? [];
    expect(pub?.variant).toBe('english-only');
    expect(pub?.machineAssist).toBeDefined();
    expect(pub?.ocrTranscription).toBeUndefined();
  });

  it('accepts variant "english-only" + ocrTranscription (an English OCR source)', () => {
    const filePath = writeSource(BASE + publicationsBlock(ENGLISH_ONLY_OCR_TRANSCRIPTION_PUB));
    const { source } = loadSourceFile(filePath);
    const [pub] = source.publications ?? [];
    expect(pub?.variant).toBe('english-only');
    expect(pub?.ocrTranscription).toBeDefined();
    expect(pub?.machineAssist).toBeUndefined();
  });

  it('throws (locating) when variant "parallel" carries ocrTranscription instead of machineAssist', () => {
    const filePath = writeSource(BASE + publicationsBlock(PARALLEL_OCR_TRANSCRIPTION_PUB));
    expect(() => loadSourceFile(filePath)).toThrow(/publications\[0\]/);
    expect(() => loadSourceFile(filePath)).toThrow(/parallel/);
    expect(() => loadSourceFile(filePath)).toThrow(/ocrTranscription/);
  });
});
