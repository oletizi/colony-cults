/**
 * Shared fixtures for the English-source publish() tests
 * (`english-source.test.ts` / `english-source-machine-assist.test.ts`), split
 * out of the original combined `english-source.test.ts` (spec
 * 015-english-source-pdf, AUDIT-20260719-02/06/08/11) to keep each test file
 * under the govern line-count / byte-size caps. Behavior-preserving extract
 * only -- no fixture semantics changed.
 */
import type { OcrTranscription } from '@/pdf/model';

export const PIN_REF = 'd'.repeat(40);
export const SNAPSHOT_SHORT = 'dddddddd';
export const CDN_BASE = 'https://cdn.example.test';
export const PAGE_COUNT = 6;
export const RIGHTS_BASIS = 'English-source test public-domain basis';

export const OCR_TRANSCRIPTION: OcrTranscription = {
  engineStatus: 'machine OCR · tesseract 5 (searchable)',
  caveat: null,
};

export const FIXED_NOW = new Date('2026-07-18T09:30:00.000Z');
export const fixedClock = (): Date => FIXED_NOW;
