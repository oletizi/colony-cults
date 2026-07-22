import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildManifest,
  buildPublication,
  upsertPublication,
  writeManifestFile,
} from '@/pdf/publish/record';
import type { IssueUploadResult } from '@/pdf/publish/record';
import { loadSourceFile } from '@/bibliography/load';
import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';
import type { Source } from '@/model/source';

const CDN_BASE = 'https://colony-cults-cdn.oletizi.workers.dev';
const SNAPSHOT = '3b8b1fd6a0d7f76f3c5f9a2b3da94252bbb5dd10';
const SNAPSHOT_SHORT = '3b8b1fd6';
// Two distinct, valid 64-lowercase-hex sha256 strings.
const SHA_A = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA_B = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';

const MACHINE_ASSIST: MachineAssistLabel = {
  engine: 'claude-code-cli',
  model: null,
  retrieved: '2026-07-12',
};

const OCR_TRANSCRIPTION: OcrTranscription = {
  engineStatus: 'machine OCR · tesseract 5 (searchable)',
  caveat: null,
};

/** A frozen clock so `publishedAt` is deterministic. */
const FIXED_NOW = new Date('2026-07-12T09:30:00.000Z');
const fixedClock = (): Date => FIXED_NOW;

function issue(issueId: string, sha256: string): IssueUploadResult {
  const key = `editions/english-only/PB-P001/${issueId}__${SNAPSHOT_SHORT}.pdf`;
  return { issueId, key, url: `${CDN_BASE}/${key}`, sha256, pages: 40 };
}

function minimalSource(): Source {
  return {
    sourceId: 'PB-P001',
    titles: [{ text: 'La Presse', role: 'canonical' }],
    kind: 'periodical',
    identifiers: [],
    rights: {
      status: 'public-domain',
      basis: '1881 imprint; French public domain',
    },
  };
}

let tmpDir: string;
let publicationsDir: string;
let sourcesDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'record-test-'));
  publicationsDir = path.join(tmpDir, 'bibliography', 'publications');
  sourcesDir = path.join(tmpDir, 'bibliography', 'sources');
});

afterEach(() => {
  // best-effort cleanup; ignore if already gone.
});

describe('buildManifest', () => {
  it('sorts issues by issueId and carries the fields through', () => {
    const manifest = buildManifest({
      sourceId: 'PB-P001',
      variant: 'english-only',
      snapshot: SNAPSHOT,
      cdnBase: CDN_BASE,
      issues: [issue('1879-08-01_zzz', SHA_B), issue('1879-07-15_aaa', SHA_A)],
    });

    expect(manifest.issues.map((i) => i.issueId)).toEqual([
      '1879-07-15_aaa',
      '1879-08-01_zzz',
    ]);
    expect(manifest.sourceId).toBe('PB-P001');
    expect(manifest.variant).toBe('english-only');
    expect(manifest.snapshot).toBe(SNAPSHOT);
    expect(manifest.issues[0].sha256).toBe(SHA_A);
  });

  it('rejects a sha256 that is not 64 lowercase hex', () => {
    expect(() =>
      buildManifest({
        sourceId: 'PB-P001',
        variant: 'english-only',
        cdnBase: CDN_BASE,
        issues: [issue('1879-07-15_aaa', 'NOTHEX')],
      }),
    ).toThrow(/sha256/i);
  });

  it('rejects a url that does not equal cdnBase + "/" + key', () => {
    const bad = issue('1879-07-15_aaa', SHA_A);
    bad.url = 'https://evil.example.com/wrong.pdf';
    expect(() =>
      buildManifest({
        sourceId: 'PB-P001',
        variant: 'english-only',
        cdnBase: CDN_BASE,
        issues: [bad],
      }),
    ).toThrow(/url/i);
  });
});

describe('writeManifestFile', () => {
  it('writes to the versioned path and returns the repo-relative path', () => {
    const manifest = buildManifest({
      sourceId: 'PB-P001',
      variant: 'english-only',
      snapshot: SNAPSHOT,
      cdnBase: CDN_BASE,
      issues: [issue('1879-07-15_aaa', SHA_A)],
    });

    const rel = writeManifestFile(publicationsDir, manifest, SNAPSHOT_SHORT);

    expect(rel).toBe(
      'bibliography/publications/PB-P001-english-only-3b8b1fd6.yml',
    );
    const written = path.join(
      publicationsDir,
      'PB-P001-english-only-3b8b1fd6.yml',
    );
    expect(existsSync(written)).toBe(true);
  });

  it('uses the -legacy filename for the legacy scheme', () => {
    const manifest = buildManifest({
      sourceId: 'PB-P001',
      variant: 'english-only',
      cdnBase: CDN_BASE,
      issues: [issue('1879-07-15_aaa', SHA_A)],
    });
    const rel = writeManifestFile(publicationsDir, manifest, 'legacy');
    expect(rel).toBe(
      'bibliography/publications/PB-P001-english-only-legacy.yml',
    );
  });

  it('re-writing identical input is byte-identical (idempotent)', () => {
    const manifest = buildManifest({
      sourceId: 'PB-P001',
      variant: 'english-only',
      snapshot: SNAPSHOT,
      cdnBase: CDN_BASE,
      issues: [issue('1879-08-01_zzz', SHA_B), issue('1879-07-15_aaa', SHA_A)],
    });
    writeManifestFile(publicationsDir, manifest, SNAPSHOT_SHORT);
    const first = readFileSync(
      path.join(publicationsDir, 'PB-P001-english-only-3b8b1fd6.yml'),
      'utf-8',
    );
    writeManifestFile(publicationsDir, manifest, SNAPSHOT_SHORT);
    const second = readFileSync(
      path.join(publicationsDir, 'PB-P001-english-only-3b8b1fd6.yml'),
      'utf-8',
    );
    expect(second).toBe(first);
  });
});

describe('buildPublication', () => {
  const base = {
    variant: 'english-only' as const,
    snapshot: SNAPSHOT,
    snapshotShort: SNAPSHOT_SHORT,
    cdnBase: CDN_BASE,
    keyScheme: 'versioned' as const,
    rightsBasis: '1881 imprint; French public domain',
    manifestPath:
      'bibliography/publications/PB-P001-english-only-3b8b1fd6.yml',
    issueCount: 2,
  };

  it('throws if a translation-carrying (French) edition lacks BOTH machineAssist and ocrTranscription (Constitution IV safety net intact)', () => {
    expect(() =>
      buildPublication({ ...base, machineAssist: undefined }, fixedClock),
    ).toThrow(/machineAssist/i);
  });

  it('assembles a Publication with publishedAt from the clock and issueCount', () => {
    const pub = buildPublication(
      { ...base, machineAssist: MACHINE_ASSIST },
      fixedClock,
    );
    expect(pub.publishedAt).toBe('2026-07-12');
    expect(pub.manifest.issueCount).toBe(2);
    expect(pub.manifest.manifestPath).toBe(base.manifestPath);
    expect(pub.machineAssist).toEqual(MACHINE_ASSIST);
    expect(pub.keyScheme).toBe('versioned');
  });

  // AUDIT-20260719-02 (spec 015-english-source-pdf): an English-source
  // edition carries an ocrTranscription disclosure INSTEAD OF a machineAssist
  // label. buildPublication must NOT throw and must record the disclosure
  // honestly, with no machineAssist field at all.
  it('records an English-source ocrTranscription disclosure WITHOUT throwing when machineAssist is absent', () => {
    const pub = buildPublication(
      { ...base, machineAssist: undefined, ocrTranscription: OCR_TRANSCRIPTION },
      fixedClock,
    );
    expect(pub.ocrTranscription).toEqual(OCR_TRANSCRIPTION);
    expect(pub.machineAssist).toBeUndefined();
    expect(pub.publishedAt).toBe('2026-07-12');
  });

  it('still throws when neither machineAssist nor ocrTranscription is present', () => {
    expect(() =>
      buildPublication(
        { ...base, machineAssist: undefined, ocrTranscription: undefined },
        fixedClock,
      ),
    ).toThrow(/machineAssist.*ocrTranscription|ocrTranscription.*machineAssist/i);
  });

  // AUDIT-20260719-04/05: BOTH disclosures present is an equally malformed
  // state (two conflicting provenance stories) -- buildPublication must
  // reject it, not silently record both.
  it('throws when BOTH machineAssist and ocrTranscription are present', () => {
    expect(() =>
      buildPublication(
        { ...base, machineAssist: MACHINE_ASSIST, ocrTranscription: OCR_TRANSCRIPTION },
        fixedClock,
      ),
    ).toThrow(/machineAssist.*ocrTranscription|ocrTranscription.*machineAssist/is);
  });
});

describe('upsertPublication', () => {
  function makePublication(snapshotShort: string) {
    return buildPublication(
      {
        variant: 'english-only',
        snapshot: SNAPSHOT + snapshotShort,
        snapshotShort,
        cdnBase: CDN_BASE,
        keyScheme: 'versioned',
        rightsBasis: '1881 imprint; French public domain',
        machineAssist: MACHINE_ASSIST,
        manifestPath: `bibliography/publications/PB-P001-english-only-${snapshotShort}.yml`,
        issueCount: 1,
      },
      fixedClock,
    );
  }

  it('appends a new (variant, snapshotShort), and a second identical upsert does not duplicate', () => {
    const source = minimalSource();
    const pub = makePublication(SNAPSHOT_SHORT);

    const first = upsertPublication(sourcesDir, source, [], pub);
    expect(first).toBe(true);
    expect(source.publications).toHaveLength(1);

    const second = upsertPublication(sourcesDir, source, [], makePublication(SNAPSHOT_SHORT));
    expect(second).toBe(false);
    expect(source.publications).toHaveLength(1);
  });

  it('a different snapshotShort appends a second entry', () => {
    const source = minimalSource();
    upsertPublication(sourcesDir, source, [], makePublication(SNAPSHOT_SHORT));
    const changed = upsertPublication(sourcesDir, source, [], makePublication('deadbeef'));
    expect(changed).toBe(true);
    expect(source.publications).toHaveLength(2);
  });

  it('the written source round-trips through loadSourceFile', () => {
    const source = minimalSource();
    upsertPublication(sourcesDir, source, [], makePublication(SNAPSHOT_SHORT));

    const written = path.join(sourcesDir, 'PB-P001.yml');
    const loaded = loadSourceFile(written);
    expect(loaded.source.sourceId).toBe('PB-P001');
    expect(loaded.source.publications).toHaveLength(1);
    expect(loaded.source.publications?.[0].snapshotShort).toBe(SNAPSHOT_SHORT);
    expect(loaded.source.publications?.[0].machineAssist).toEqual(MACHINE_ASSIST);
  });
});
