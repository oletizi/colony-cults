import { describe, expect, it } from 'vitest';

import { applyMachineAssistOverride, mergeDisclosure } from '@/pdf/publish/disclosure';
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

/**
 * Unit tests (AUDIT-20260719-11, spec 015-english-source-pdf) for
 * `applyMachineAssistOverride` directly (not through a full `publish()` run).
 *
 * These ISOLATE the "the run-option seed is not dropped unconditionally"
 * half of AUDIT-20260719-08 that the integration-level companion test in
 * `english-source.test.ts` (the "French edition: opts.machineAssist seed
 * still works" describe) CANNOT isolate: that fixture writes the SAME value
 * for both the per-page `recto.machineAssist` and `opts.machineAssist`, so
 * the recorded disclosure comes from the per-page read regardless of whether
 * the option-seed logic works at all -- `readIssueBuildInfo`'s exactly-one-
 * of-`machineAssist`/`ocrTranscription` invariant (AUDIT-02/04/05) means NO
 * successful `publish()` run can ever reach `recordAndCommit` with an EMPTY
 * running disclosure to seed from a per-page read alone -- at least one
 * present, successfully-read issue must already carry `machineAssist` (or
 * the run is English and the option is ignored outright). So the "seed is
 * the SOLE source of the recorded value" case is only reachable by calling
 * `applyMachineAssistOverride` directly with an EMPTY running disclosure, as
 * this block does.
 */
describe('applyMachineAssistOverride (AUDIT-20260719-11: isolates the seed channel from any per-issue value)', () => {
  it('is the SOLE source of machineAssist when the running disclosure carries nothing yet', () => {
    const result = applyMachineAssistOverride({}, { machineAssist: MACHINE_ASSIST_A }, 'opt-label');
    expect(result.machineAssist).toEqual(MACHINE_ASSIST_A);
    expect(result.ocrTranscription).toBeUndefined();
  });

  it('is a no-op when opts.machineAssist is undefined', () => {
    const disclosure: Disclosure = { machineAssist: MACHINE_ASSIST_A };
    expect(applyMachineAssistOverride(disclosure, {}, 'opt-label')).toEqual(disclosure);
  });

  it('is IGNORED outright for an English (ocrTranscription-carrying) run -- never contaminates it', () => {
    const disclosure: Disclosure = { ocrTranscription: OCR_A };
    const result = applyMachineAssistOverride(disclosure, { machineAssist: MACHINE_ASSIST_A }, 'opt-label');
    expect(result).toEqual(disclosure);
    expect(result.machineAssist).toBeUndefined();
  });

  it('merges without conflict when the option matches an already-present machineAssist', () => {
    const disclosure: Disclosure = { machineAssist: MACHINE_ASSIST_A };
    const result = applyMachineAssistOverride(disclosure, { machineAssist: MACHINE_ASSIST_A }, 'opt-label');
    expect(result.machineAssist).toEqual(MACHINE_ASSIST_A);
  });

  it('throws when the option CONFLICTS with an already-present machineAssist -- the option is read, not silently dropped', () => {
    const disclosure: Disclosure = { machineAssist: MACHINE_ASSIST_A };
    expect(() =>
      applyMachineAssistOverride(disclosure, { machineAssist: MACHINE_ASSIST_B }, 'opt-label'),
    ).toThrow(/machineAssist/);
  });
});
