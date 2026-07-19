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
import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';
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

    // AUDIT-20260719-10: NOTHING was uploaded to the object store either --
    // both issues' disclosures are read + merged BEFORE any confirm-mode PUT,
    // so the cross-issue conflict aborts with zero artifacts durably placed
    // (never an orphaned upload with no publication record). Before that fix,
    // issue 1 (and issue 2, whose own upload runs before its outcome's
    // disclosure is merged) would already be PUT by the time the conflict
    // throw fires.
    expect(conflictStore.size).toBe(0);
  });
});

/**
 * AUDIT-20260719-08 (HIGH, govern finding): `runConfirm`/`runReconcile`
 * unconditionally seeded the running disclosure from `opts.machineAssist`
 * (`let disclosure: Disclosure = { machineAssist: opts.machineAssist }`). For
 * an English-source publish, every issue's `readIssueBuildInfo` outcome
 * correctly carries `ocrTranscription` (never `machineAssist`) -- but the
 * unconditional seed injected a `machineAssist` value from the RUN OPTION
 * regardless, so `mergeDisclosure` produced a running disclosure with BOTH
 * fields populated, and `buildPublication`'s exactly-one check rejected the
 * whole (otherwise-valid) English run. This reproduces that seeded path
 * directly (rather than relying on `publish.ts` never setting the option) and
 * asserts the run SUCCEEDS, recording `ocrTranscription` only.
 */
describe('publish() English-source edition (AUDIT-20260719-08): opts.machineAssist seed must not contaminate an English (ocrTranscription) run', () => {
  const SEEDED_SOURCE_ID = 'PB-993';
  const SEEDED_ISSUE_IDS = ['1900-08-01_a', '1900-09-01_b'];

  // A run-option machineAssist value that, pre-fix, unconditionally seeded the
  // running disclosure -- simulating whatever upstream option resolution the
  // AUDIT-08 finding flagged as an "invisible option coupling".
  const SEEDED_MACHINE_ASSIST: MachineAssistLabel = {
    engine: 'claude-code-cli',
    model: 'claude-opus-4',
    retrieved: '2026-07-19T00:00:00.000Z',
  };

  const seededPinReader: ArchivePinReader = { read: () => PIN_REF };
  const seededCorpusSnapshotReader: CorpusSnapshotReader = {
    read(sourceId: string) {
      if (sourceId !== SEEDED_SOURCE_ID) {
        throw new Error(`fake corpusSnapshotReader: unexpected sourceId ${sourceId}`);
      }
      return {
        sources: [
          {
            sourceId: SEEDED_SOURCE_ID,
            title: 'English Source Seeded-Option Test Source',
            kind: 'periodical' as const,
            ark: 'ark:/12148/english-source-seeded-test',
            rights: 'public-domain',
            issues: SEEDED_ISSUE_IDS.map((issueId, i) => ({
              issueId,
              date: '1900-08-01',
              sequence: i + 1,
              pages: [],
            })),
          },
        ],
        skipped: [],
      };
    },
  };

  let seededTmpRoot: string;
  let seededSourcesDir: string;
  let seededPublicationsDir: string;
  let seededOutDir: string;
  let seededStore: FakeObjectStore;
  let seededCommit: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    seededTmpRoot = mkdtempSync(
      path.join(tmpdir(), 'corpus-print-pdf-publish-english-source-seeded-'),
    );
    seededSourcesDir = path.join(seededTmpRoot, 'bibliography', 'sources');
    seededPublicationsDir = path.join(seededTmpRoot, 'bibliography', 'publications');
    seededOutDir = path.join(seededTmpRoot, 'build', 'pdf');

    const source: Source = {
      sourceId: SEEDED_SOURCE_ID,
      titles: [{ text: 'English Source Seeded-Option Test Source', role: 'canonical' }],
      kind: 'periodical',
      identifiers: [],
      rights: { status: 'public-domain', basis: RIGHTS_BASIS },
    };
    mkdirSync(seededSourcesDir, { recursive: true });
    writeSourceFile(seededSourcesDir, { source, records: [] });

    const sourceOutDir = path.join(seededOutDir, SEEDED_SOURCE_ID);
    mkdirSync(sourceOutDir, { recursive: true });
    for (const issueId of SEEDED_ISSUE_IDS) {
      writeFileSync(
        path.join(sourceOutDir, `${issueId}.pdf`),
        Buffer.from(`%PDF-1.4 english-source seeded-option stub for ${issueId}\n`, 'utf-8'),
      );
      const pages = Array.from({ length: PAGE_COUNT }, () => ({ recto: { machineAssist: null } }));
      writeFileSync(
        path.join(sourceOutDir, `${issueId}.input.json`),
        JSON.stringify({ pages, colophon: { ocrTranscription: OCR_TRANSCRIPTION } }),
        'utf-8',
      );
    }

    seededStore = new FakeObjectStore();
    seededCommit = vi.fn();
  });

  afterAll(() => {
    rmSync(seededTmpRoot, { recursive: true, force: true });
  });

  it('succeeds (does not reject as both-disclosures) when opts.machineAssist is set alongside English (ocrTranscription) issues', async () => {
    const result = await publish({
      sourceId: SEEDED_SOURCE_ID,
      variant: VARIANT,
      confirm: true,
      outDir: seededOutDir,
      sourcesDir: seededSourcesDir,
      publicationsDir: seededPublicationsDir,
      store: seededStore,
      clock: fixedClock,
      pinReader: seededPinReader,
      corpusSnapshotReader: seededCorpusSnapshotReader,
      cdnBase: CDN_BASE,
      warm: false,
      commit: seededCommit,
      // The seeded run option AUDIT-20260719-08 flags: must NOT contaminate
      // an English (ocrTranscription) run.
      machineAssist: SEEDED_MACHINE_ASSIST,
      log: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('confirm');
    expect(result.published).toBe(SEEDED_ISSUE_IDS.length);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);

    const loaded = loadSourceFile(path.join(seededSourcesDir, `${SEEDED_SOURCE_ID}.yml`));
    expect(loaded.source.publications).toHaveLength(1);
    const publication = loaded.source.publications?.[0];
    if (publication === undefined) {
      throw new Error('test bug: publication entry missing after seeded-option English publish');
    }
    // Recorded: ocrTranscription only, no machineAssist -- the seeded run
    // option must be dropped, not merged in alongside the English disclosure.
    expect(publication.ocrTranscription).toEqual(OCR_TRANSCRIPTION);
    expect(publication.machineAssist).toBeUndefined();
  });
});

/**
 * AUDIT-20260719-08 companion (AUDIT-20260719-11 corrected docstring): a
 * French (machineAssist) run with opts.machineAssist SET TO THE SAME VALUE as
 * every page's recto.machineAssist must still succeed and record machineAssist
 * only.
 *
 * IMPORTANT (AUDIT-20260719-11): because this fixture writes the SAME value
 * for both the per-page `recto.machineAssist` and the run-option
 * `opts.machineAssist`, this test alone CANNOT distinguish "the option-seed
 * survived" from "the option-seed was dropped unconditionally" -- either way
 * `readIssueBuildInfo`'s per-page read alone supplies the recorded value (it
 * MUST, per the exactly-one-of-machineAssist/ocrTranscription invariant --
 * AUDIT-02/04/05 -- every successfully-read French issue already carries a
 * non-null machineAssist before the option is ever consulted). This test
 * therefore only proves the narrower, still-useful claim: a MATCHING option
 * value does not spuriously trip `mergeDisclosure`'s conflict check. The
 * "seed is not dropped unconditionally" half of AUDIT-08 is isolated instead
 * by two OTHER tests: (1) the DISTINCT-value test immediately below, which
 * proves the option is actually READ (a silently-dropped option could never
 * produce the conflict-throw asserted there), and (2) the direct unit tests
 * on `applyMachineAssistOverride` in `tests/unit/publish/disclosure.test.ts`,
 * which call it with an EMPTY running disclosure -- the one state this
 * integration fixture can never reach -- and assert the option becomes the
 * SOLE recorded value.
 */
describe('publish() French edition: opts.machineAssist seed still works for a machineAssist-carrying (parallel) run', () => {
  const FRENCH_SOURCE_ID = 'PB-994';
  const FRENCH_ISSUE_IDS = ['1900-10-01_a'];
  const FRENCH_VARIANT = 'parallel' as const;

  const FRENCH_MACHINE_ASSIST: MachineAssistLabel = {
    engine: 'claude-code-cli',
    model: 'claude-opus-4',
    retrieved: '2026-07-19T00:00:00.000Z',
  };

  const frenchPinReader: ArchivePinReader = { read: () => PIN_REF };
  const frenchCorpusSnapshotReader: CorpusSnapshotReader = {
    read(sourceId: string) {
      if (sourceId !== FRENCH_SOURCE_ID) {
        throw new Error(`fake corpusSnapshotReader: unexpected sourceId ${sourceId}`);
      }
      return {
        sources: [
          {
            sourceId: FRENCH_SOURCE_ID,
            title: 'French Test Source',
            kind: 'periodical' as const,
            ark: 'ark:/12148/french-seeded-test',
            rights: 'public-domain',
            issues: FRENCH_ISSUE_IDS.map((issueId, i) => ({
              issueId,
              date: '1900-10-01',
              sequence: i + 1,
              pages: [],
            })),
          },
        ],
        skipped: [],
      };
    },
  };

  let frenchTmpRoot: string;
  let frenchSourcesDir: string;
  let frenchPublicationsDir: string;
  let frenchOutDir: string;
  let frenchStore: FakeObjectStore;
  let frenchCommit: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    frenchTmpRoot = mkdtempSync(path.join(tmpdir(), 'corpus-print-pdf-publish-french-seeded-'));
    frenchSourcesDir = path.join(frenchTmpRoot, 'bibliography', 'sources');
    frenchPublicationsDir = path.join(frenchTmpRoot, 'bibliography', 'publications');
    frenchOutDir = path.join(frenchTmpRoot, 'build', 'pdf');

    const source: Source = {
      sourceId: FRENCH_SOURCE_ID,
      titles: [{ text: 'French Test Source', role: 'canonical' }],
      kind: 'periodical',
      identifiers: [],
      rights: { status: 'public-domain', basis: RIGHTS_BASIS },
    };
    mkdirSync(frenchSourcesDir, { recursive: true });
    writeSourceFile(frenchSourcesDir, { source, records: [] });

    const sourceOutDir = path.join(frenchOutDir, FRENCH_SOURCE_ID);
    mkdirSync(sourceOutDir, { recursive: true });
    for (const issueId of FRENCH_ISSUE_IDS) {
      writeFileSync(
        path.join(sourceOutDir, `${issueId}.pdf`),
        Buffer.from(`%PDF-1.4 french stub for ${issueId}\n`, 'utf-8'),
      );
      const pages = Array.from({ length: PAGE_COUNT }, () => ({
        recto: { machineAssist: FRENCH_MACHINE_ASSIST },
      }));
      writeFileSync(
        path.join(sourceOutDir, `${issueId}.input.json`),
        JSON.stringify({ pages }),
        'utf-8',
      );
    }

    frenchStore = new FakeObjectStore();
    frenchCommit = vi.fn();
  });

  afterAll(() => {
    rmSync(frenchTmpRoot, { recursive: true, force: true });
  });

  it('succeeds and records machineAssist only, with opts.machineAssist seed present', async () => {
    const result = await publish({
      sourceId: FRENCH_SOURCE_ID,
      variant: FRENCH_VARIANT,
      confirm: true,
      outDir: frenchOutDir,
      sourcesDir: frenchSourcesDir,
      publicationsDir: frenchPublicationsDir,
      store: frenchStore,
      clock: fixedClock,
      pinReader: frenchPinReader,
      corpusSnapshotReader: frenchCorpusSnapshotReader,
      cdnBase: CDN_BASE,
      warm: false,
      commit: frenchCommit,
      machineAssist: FRENCH_MACHINE_ASSIST,
      log: () => {},
    });

    expect(result.ok).toBe(true);
    expect(result.published).toBe(FRENCH_ISSUE_IDS.length);
    expect(result.failed).toBe(0);

    const loaded = loadSourceFile(path.join(frenchSourcesDir, `${FRENCH_SOURCE_ID}.yml`));
    const publication = loaded.source.publications?.[0];
    if (publication === undefined) {
      throw new Error('test bug: publication entry missing after French seeded-option publish');
    }
    expect(publication.machineAssist).toEqual(FRENCH_MACHINE_ASSIST);
    expect(publication.ocrTranscription).toBeUndefined();
  });

  /**
   * AUDIT-20260719-11: a DISTINCT opts.machineAssist (differing from every
   * page's real recto.machineAssist) must fail loud with a conflict, NOT
   * silently succeed using the per-page value. This is the isolation the
   * SAME-value test above cannot provide: if a regression made the seed
   * unconditionally dropped, this fixture's option value would simply never
   * be consulted and the run would succeed anyway -- so a passing "throws"
   * assertion here proves the option is genuinely read and folded in via
   * `applyMachineAssistOverride`/`mergeDisclosure`, not silently ignored.
   */
  it('throws when opts.machineAssist DIFFERS from every page real machineAssist value -- proves the option is read, not silently dropped', async () => {
    const CONFLICTING_MACHINE_ASSIST: MachineAssistLabel = {
      engine: 'claude-code-cli',
      model: 'claude-opus-4',
      retrieved: '2026-07-19T09:00:00.000Z',
    };

    await expect(
      publish({
        sourceId: FRENCH_SOURCE_ID,
        variant: FRENCH_VARIANT,
        confirm: true,
        outDir: frenchOutDir,
        sourcesDir: frenchSourcesDir,
        publicationsDir: frenchPublicationsDir,
        store: frenchStore,
        clock: fixedClock,
        pinReader: frenchPinReader,
        corpusSnapshotReader: frenchCorpusSnapshotReader,
        cdnBase: CDN_BASE,
        warm: false,
        commit: frenchCommit,
        machineAssist: CONFLICTING_MACHINE_ASSIST,
        log: () => {},
      }),
    ).rejects.toThrow(/machineAssist/);
  });
});
