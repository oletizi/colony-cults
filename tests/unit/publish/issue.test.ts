/**
 * Unit test (AUDIT-20260719-02, spec 015-english-source-pdf): `readIssueBuildInfo`
 * (`@/pdf/publish/issue`) must read EITHER disclosure a built issue's
 * `<issueId>.input.json` carries -- a French `machineAssist` label
 * (`pages[0].recto.machineAssist`, unchanged) OR an English
 * `ocrTranscription` disclosure (`colophon.ocrTranscription`, spec 015
 * FR-008/FR-013) -- and fail loud only when NEITHER is present.
 *
 * Before the fix, an English-source `input.json` (`recto.machineAssist:
 * null`, `colophon.ocrTranscription` present) threw
 * "pages[0].recto.machineAssist must be an object" -- generation was correct
 * (spec 015) but publish/reconcile failed deterministically. This is the RED
 * case this file's first `describe` block proves fixed.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readIssueBuildInfo } from '@/pdf/publish/issue';
import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';

const MACHINE_ASSIST: MachineAssistLabel = {
  engine: 'claude-code-cli',
  model: null,
  retrieved: '2026-07-12',
};

const OCR_TRANSCRIPTION: OcrTranscription = {
  engineStatus: 'machine OCR · tesseract 5 (searchable)',
  caveat: null,
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'issue-build-info-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Write `content` (already an object, JSON.stringify'd) to `<tmpDir>/<issueId>.input.json`. */
function writeInputJson(issueId: string, content: unknown): string {
  const filePath = path.join(tmpDir, `${issueId}.input.json`);
  writeFileSync(filePath, JSON.stringify(content), 'utf-8');
  return filePath;
}

describe('readIssueBuildInfo: English-source input.json (colophon.ocrTranscription, no machineAssist)', () => {
  it('reads pages + the ocrTranscription disclosure WITHOUT throwing (AUDIT-20260719-02 RED case)', () => {
    const filePath = writeInputJson('1900-01-01_en', {
      pages: [
        { recto: { machineAssist: null } },
        { recto: { machineAssist: null } },
      ],
      colophon: { ocrTranscription: OCR_TRANSCRIPTION },
    });

    const info = readIssueBuildInfo(filePath);

    expect(info.pages).toBe(2);
    expect(info.machineAssist).toBeNull();
    expect(info.ocrTranscription).toEqual(OCR_TRANSCRIPTION);
  });

  it('tolerates a missing recto.machineAssist key entirely (undefined, not just null)', () => {
    const filePath = writeInputJson('1900-01-02_en', {
      pages: [{ recto: {} }],
      colophon: { ocrTranscription: OCR_TRANSCRIPTION },
    });

    const info = readIssueBuildInfo(filePath);

    expect(info.machineAssist).toBeNull();
    expect(info.ocrTranscription).toEqual(OCR_TRANSCRIPTION);
  });

  it('carries a non-null caveat through when the OCR condition is sub-high', () => {
    const withCaveat: OcrTranscription = { engineStatus: 'machine OCR · raw', caveat: 'quality: low' };
    const filePath = writeInputJson('1900-01-03_en', {
      pages: [{ recto: { machineAssist: null } }],
      colophon: { ocrTranscription: withCaveat },
    });

    const info = readIssueBuildInfo(filePath);

    expect(info.ocrTranscription).toEqual(withCaveat);
  });
});

describe('readIssueBuildInfo: French-source input.json (pages[0].recto.machineAssist) -- regression', () => {
  it('reads pages + the machineAssist label exactly as before, ocrTranscription null', () => {
    const filePath = writeInputJson('1879-07-15_fr', {
      pages: [
        { recto: { machineAssist: MACHINE_ASSIST } },
        { recto: {} },
      ],
    });

    const info = readIssueBuildInfo(filePath);

    expect(info.pages).toBe(2);
    expect(info.machineAssist).toEqual(MACHINE_ASSIST);
    expect(info.ocrTranscription).toBeNull();
  });

  it('still throws on a malformed (non-object, non-null) machineAssist', () => {
    const filePath = writeInputJson('1879-07-16_fr', {
      pages: [{ recto: { machineAssist: 'not-an-object' } }],
    });

    expect(() => readIssueBuildInfo(filePath)).toThrow(/machineAssist/);
  });
});

describe('readIssueBuildInfo: no disclosure at all -- fail loud (genuine provenance gap)', () => {
  it('throws when neither machineAssist nor colophon.ocrTranscription is present', () => {
    const filePath = writeInputJson('1900-01-04_none', {
      pages: [{ recto: { machineAssist: null } }],
    });

    expect(() => readIssueBuildInfo(filePath)).toThrow(/machineAssist|ocrTranscription/);
  });

  it('throws when neither is present and colophon is entirely absent', () => {
    const filePath = writeInputJson('1900-01-05_none', {
      pages: [{ recto: {} }],
    });

    expect(() => readIssueBuildInfo(filePath)).toThrow(/machineAssist|ocrTranscription/);
  });
});
