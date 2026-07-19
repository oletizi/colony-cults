/**
 * Unit test (AUDIT-20260719-02, spec 015-english-source-pdf): a confirmed
 * `publish()` run for an ENGLISH-SOURCE edition -- `pages[0].recto
 * .machineAssist: null`, `colophon.ocrTranscription` present (no
 * `translation/` was ever performed) -- must complete WITHOUT throwing and
 * record the OCR-transcription disclosure honestly on the `Publication`
 * (INSTEAD OF a `machineAssist` label).
 *
 * Before the fix, `readIssueBuildInfo` unconditionally parsed
 * `pages[0].recto.machineAssist` as a required object, so this exact fixture
 * threw "pages[0].recto.machineAssist must be an object" deterministically at
 * publish time, even though generation (spec 015) was correct.
 *
 * Mirrors the fixture approach of `tests/unit/publish/idempotent.test.ts` /
 * `tests/unit/publish/reconcile.test.ts`: a temp-dir fixture with fake
 * ArchivePinReader / CorpusSnapshotReader / clock, a `rights: public-domain`
 * Source written via `writeSourceFile`, and pre-built `<issueId>.pdf` +
 * `<issueId>.input.json` fixtures (what `pdf:build` writes for an
 * English-source edition).
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSourceFile } from '@/bibliography/load';
import { writeSourceFile } from '@/bibliography/source-writer';
import type { ArchivePinReader, CorpusSnapshotReader } from '@/pdf/load/edition';
import type { OcrTranscription } from '@/pdf/model';
import { publish } from '@/pdf/publish/publish';
import type { Source } from '@/model/source';

import { FakeObjectStore } from '../archive/fake-object-store';

const SOURCE_ID = 'PB-991';
const VARIANT = 'english-only' as const;
const ISSUE_IDS = ['1900-04-01_a', '1900-05-01_b'];
const PIN_REF = 'd'.repeat(40);
const SNAPSHOT_SHORT = 'dddddddd';
const CDN_BASE = 'https://cdn.example.test';
const PAGE_COUNT = 6;
const RIGHTS_BASIS = 'English-source test public-domain basis';

const OCR_TRANSCRIPTION: OcrTranscription = {
  engineStatus: 'machine OCR · tesseract 5 (searchable)',
  caveat: null,
};

const FIXED_NOW = new Date('2026-07-18T09:30:00.000Z');
const fixedClock = (): Date => FIXED_NOW;

const pinReader: ArchivePinReader = { read: () => PIN_REF };

const corpusSnapshotReader: CorpusSnapshotReader = {
  read(sourceId: string) {
    if (sourceId !== SOURCE_ID) {
      throw new Error(`fake corpusSnapshotReader: unexpected sourceId ${sourceId}`);
    }
    return {
      sources: [
        {
          sourceId: SOURCE_ID,
          title: 'English Source Test Source',
          kind: 'periodical' as const,
          ark: 'ark:/12148/english-source-test',
          rights: 'public-domain',
          issues: ISSUE_IDS.map((issueId, i) => ({
            issueId,
            date: '1900-04-01',
            sequence: i + 1,
            pages: [],
          })),
        },
      ],
      skipped: [],
    };
  },
};

let tmpRoot: string;
let sourcesDir: string;
let publicationsDir: string;
let outDir: string;
let store: FakeObjectStore;
let commit: ReturnType<typeof vi.fn>;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-publish-english-source-'));
  sourcesDir = path.join(tmpRoot, 'bibliography', 'sources');
  publicationsDir = path.join(tmpRoot, 'bibliography', 'publications');
  outDir = path.join(tmpRoot, 'build', 'pdf');

  const source: Source = {
    sourceId: SOURCE_ID,
    titles: [{ text: 'English Source Test Source', role: 'canonical' }],
    kind: 'periodical',
    identifiers: [],
    rights: { status: 'public-domain', basis: RIGHTS_BASIS },
  };
  mkdirSync(sourcesDir, { recursive: true });
  writeSourceFile(sourcesDir, { source, records: [] });

  // Pre-built PDFs + matching English-source <issueId>.input.json: EVERY
  // page's recto.machineAssist is null (no translation was performed) and the
  // colophon carries the ocrTranscription disclosure instead (spec 015).
  const sourceOutDir = path.join(outDir, SOURCE_ID);
  mkdirSync(sourceOutDir, { recursive: true });
  for (const issueId of ISSUE_IDS) {
    writeFileSync(
      path.join(sourceOutDir, `${issueId}.pdf`),
      Buffer.from(`%PDF-1.4 english-source stub for ${issueId}\n`, 'utf-8'),
    );

    const pages = Array.from({ length: PAGE_COUNT }, () => ({ recto: { machineAssist: null } }));
    writeFileSync(
      path.join(sourceOutDir, `${issueId}.input.json`),
      JSON.stringify({ pages, colophon: { ocrTranscription: OCR_TRANSCRIPTION } }),
      'utf-8',
    );
  }

  store = new FakeObjectStore();
  commit = vi.fn();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('publish() English-source edition (AUDIT-20260719-02): nullable machineAssist, ocrTranscription disclosure', () => {
  it('a confirmed publish completes WITHOUT throwing and records every issue', async () => {
    const result = await publish({
      sourceId: SOURCE_ID,
      variant: VARIANT,
      confirm: true,
      outDir,
      sourcesDir,
      publicationsDir,
      store,
      clock: fixedClock,
      pinReader,
      corpusSnapshotReader,
      cdnBase: CDN_BASE,
      warm: false,
      commit,
      log: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('confirm');
    expect(result.published).toBe(ISSUE_IDS.length);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it('the recorded Publication carries the ocrTranscription disclosure and NO machineAssist field', () => {
    const loaded = loadSourceFile(path.join(sourcesDir, `${SOURCE_ID}.yml`));
    expect(loaded.source.publications).toHaveLength(1);
    const publication = loaded.source.publications?.[0];
    if (publication === undefined) {
      throw new Error('test bug: publication entry missing after English-source publish');
    }
    expect(publication.variant).toBe(VARIANT);
    expect(publication.snapshotShort).toBe(SNAPSHOT_SHORT);
    expect(publication.rightsBasis).toBe(RIGHTS_BASIS);
    expect(publication.ocrTranscription).toEqual(OCR_TRANSCRIPTION);
    expect(publication.machineAssist).toBeUndefined();
  });

  it('the manifest file records every issue with the correct page count', () => {
    const manifestPath = path.join(
      publicationsDir,
      `${SOURCE_ID}-${VARIANT}-${SNAPSHOT_SHORT}.yml`,
    );
    const raw = readFileSync(manifestPath, 'utf-8');
    for (const issueId of ISSUE_IDS) {
      expect(raw).toContain(issueId);
    }
    expect(raw).toContain(`pages: ${PAGE_COUNT}`);
  });
});

/**
 * AUDIT-20260719-06: before the fix, `mergeDisclosure` was first-seen-wins,
 * so a multi-issue publish run whose issues carry DIFFERENT
 * `colophon.ocrTranscription` values (e.g. a later issue surfaces a worse OCR
 * caveat than an earlier one) silently recorded only the FIRST issue's
 * disclosure on the durable `Publication` -- understating OCR quality. The
 * fix makes this fail loud instead of silently collapsing to first-seen (see
 * `@/pdf/publish/disclosure`'s `mergeDisclosure` for the documented
 * fail-loud-vs-worst-aggregate choice).
 */
describe('publish() English-source edition (AUDIT-20260719-06): two issues with DIFFERING colophon.ocrTranscription', () => {
  const CONFLICT_SOURCE_ID = 'PB-992';
  const CONFLICT_ISSUE_IDS = ['1900-06-01_a', '1900-07-01_b'];

  const OCR_TRANSCRIPTION_CLEAN: OcrTranscription = {
    engineStatus: 'machine OCR · tesseract 5 (searchable)',
    caveat: null,
  };
  const OCR_TRANSCRIPTION_LOW: OcrTranscription = {
    engineStatus: 'machine OCR · raw',
    caveat: 'quality: low (sub-high tier folios present)',
  };

  const conflictPinReader: ArchivePinReader = { read: () => PIN_REF };
  const conflictCorpusSnapshotReader: CorpusSnapshotReader = {
    read(sourceId: string) {
      if (sourceId !== CONFLICT_SOURCE_ID) {
        throw new Error(`fake corpusSnapshotReader: unexpected sourceId ${sourceId}`);
      }
      return {
        sources: [
          {
            sourceId: CONFLICT_SOURCE_ID,
            title: 'English Source Conflict Test Source',
            kind: 'periodical' as const,
            ark: 'ark:/12148/english-source-conflict-test',
            rights: 'public-domain',
            issues: CONFLICT_ISSUE_IDS.map((issueId, i) => ({
              issueId,
              date: '1900-06-01',
              sequence: i + 1,
              pages: [],
            })),
          },
        ],
        skipped: [],
      };
    },
  };

  let conflictTmpRoot: string;
  let conflictSourcesDir: string;
  let conflictPublicationsDir: string;
  let conflictOutDir: string;
  let conflictStore: FakeObjectStore;
  let conflictCommit: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    conflictTmpRoot = mkdtempSync(
      path.join(tmpdir(), 'corpus-print-pdf-publish-english-source-conflict-'),
    );
    conflictSourcesDir = path.join(conflictTmpRoot, 'bibliography', 'sources');
    conflictPublicationsDir = path.join(conflictTmpRoot, 'bibliography', 'publications');
    conflictOutDir = path.join(conflictTmpRoot, 'build', 'pdf');

    const source: Source = {
      sourceId: CONFLICT_SOURCE_ID,
      titles: [{ text: 'English Source Conflict Test Source', role: 'canonical' }],
      kind: 'periodical',
      identifiers: [],
      rights: { status: 'public-domain', basis: RIGHTS_BASIS },
    };
    mkdirSync(conflictSourcesDir, { recursive: true });
    writeSourceFile(conflictSourcesDir, { source, records: [] });

    const sourceOutDir = path.join(conflictOutDir, CONFLICT_SOURCE_ID);
    mkdirSync(sourceOutDir, { recursive: true });

    // Two issues, DIFFERING ocrTranscription -- the state channel AUDIT-06
    // flagged as untested (the old fixture wrote the SAME object for every
    // issue).
    const transcriptions = [OCR_TRANSCRIPTION_CLEAN, OCR_TRANSCRIPTION_LOW];
    CONFLICT_ISSUE_IDS.forEach((issueId, i) => {
      writeFileSync(
        path.join(sourceOutDir, `${issueId}.pdf`),
        Buffer.from(`%PDF-1.4 english-source conflict stub for ${issueId}\n`, 'utf-8'),
      );
      const pages = Array.from({ length: PAGE_COUNT }, () => ({ recto: { machineAssist: null } }));
      writeFileSync(
        path.join(sourceOutDir, `${issueId}.input.json`),
        JSON.stringify({ pages, colophon: { ocrTranscription: transcriptions[i] } }),
        'utf-8',
      );
    });

    conflictStore = new FakeObjectStore();
    conflictCommit = vi.fn();
  });

  afterAll(() => {
    rmSync(conflictTmpRoot, { recursive: true, force: true });
  });

  it('rejects the whole publish run rather than silently recording only the first-seen ocrTranscription', async () => {
    await expect(
      publish({
        sourceId: CONFLICT_SOURCE_ID,
        variant: VARIANT,
        confirm: true,
        outDir: conflictOutDir,
        sourcesDir: conflictSourcesDir,
        publicationsDir: conflictPublicationsDir,
        store: conflictStore,
        clock: fixedClock,
        pinReader: conflictPinReader,
        corpusSnapshotReader: conflictCorpusSnapshotReader,
        cdnBase: CDN_BASE,
        warm: false,
        commit: conflictCommit,
        log: () => {},
      }),
    ).rejects.toThrow(/ocrTranscription/);

    // Nothing was recorded: recordAndCommit never ran (the throw happens
    // mid-loop, before the record/commit tail), so no publications entry and
    // no commit.
    const loaded = loadSourceFile(path.join(conflictSourcesDir, `${CONFLICT_SOURCE_ID}.yml`));
    expect(loaded.source.publications ?? []).toHaveLength(0);
    expect(conflictCommit).not.toHaveBeenCalled();
  });
});
