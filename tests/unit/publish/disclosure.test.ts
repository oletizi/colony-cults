import { describe, expect, it } from 'vitest';

import { mergeDisclosure } from '@/pdf/publish/disclosure';
import type { Disclosure } from '@/pdf/publish/disclosure';
import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';

/**
 * Unit tests (AUDIT-20260719-06, spec 015-english-source-pdf) for
 * `mergeDisclosure`'s replacement of the old first-seen-wins merge with a
 * fail-loud-on-conflict merge: two issues in one publish run carrying
 * DIFFERENT values for the same disclosure field must throw (locating,
 * naming the issueId) rather than silently collapse to the first-seen value.
 */

const OCR_A: OcrTranscription = {
  engineStatus: 'machine OCR · tesseract 5 (searchable)',
  caveat: null,
};

const OCR_B: OcrTranscription = {
  engineStatus: 'machine OCR · raw',
  caveat: 'quality: low (sub-high tier folios present)',
};

const MACHINE_ASSIST_A: MachineAssistLabel = {
  engine: 'claude-code-cli',
  model: null,
  retrieved: '2026-07-12',
};

const MACHINE_ASSIST_B: MachineAssistLabel = {
  engine: 'claude-code-cli',
  model: null,
  retrieved: '2026-07-15',
};

describe('mergeDisclosure: consistent values across issues merge without throwing', () => {
  it('carries an ocrTranscription value forward unchanged when every issue agrees', () => {
    const afterFirst = mergeDisclosure({}, { ocrTranscription: OCR_A }, 'issue-1');
    const afterSecond = mergeDisclosure(afterFirst, { ocrTranscription: OCR_A }, 'issue-2');
    expect(afterSecond.ocrTranscription).toEqual(OCR_A);
  });

  it('carries a machineAssist value forward unchanged when every issue agrees', () => {
    const afterFirst = mergeDisclosure({}, { machineAssist: MACHINE_ASSIST_A }, 'issue-1');
    const afterSecond = mergeDisclosure(afterFirst, { machineAssist: MACHINE_ASSIST_A }, 'issue-2');
    expect(afterSecond.machineAssist).toEqual(MACHINE_ASSIST_A);
  });

  it('an issue with no disclosure at all (undefined/undefined) leaves the running disclosure unchanged', () => {
    const current: Disclosure = { ocrTranscription: OCR_A };
    const merged = mergeDisclosure(current, {}, 'issue-2');
    expect(merged.ocrTranscription).toEqual(OCR_A);
  });
});

describe('mergeDisclosure: DIFFERING per-issue disclosures fail loud (AUDIT-20260719-06 RED case)', () => {
  it('throws when a later issue carries an ocrTranscription that differs from an earlier issue', () => {
    const afterFirst = mergeDisclosure({}, { ocrTranscription: OCR_A }, 'issue-1');
    expect(() => mergeDisclosure(afterFirst, { ocrTranscription: OCR_B }, 'issue-2')).toThrow(
      /ocrTranscription/,
    );
    expect(() => mergeDisclosure(afterFirst, { ocrTranscription: OCR_B }, 'issue-2')).toThrow(
      /issue-2/,
    );
  });

  it('throws when a later issue carries a machineAssist that differs from an earlier issue', () => {
    const afterFirst = mergeDisclosure({}, { machineAssist: MACHINE_ASSIST_A }, 'issue-1');
    expect(() =>
      mergeDisclosure(afterFirst, { machineAssist: MACHINE_ASSIST_B }, 'issue-2'),
    ).toThrow(/machineAssist/);
  });

  it('does not silently first-seen-win: the thrown error surfaces BOTH the earlier and the conflicting value', () => {
    const afterFirst = mergeDisclosure({}, { ocrTranscription: OCR_A }, 'issue-1');
    expect(() => mergeDisclosure(afterFirst, { ocrTranscription: OCR_B }, 'issue-2')).toThrow(
      /quality: low/,
    );
  });
});
