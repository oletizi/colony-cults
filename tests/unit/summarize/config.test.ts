import { describe, it, expect } from 'vitest';
import {
  resolveSummaryModel,
  resolveSummarizerName,
  DEFAULT_SUMMARY_MODEL,
} from '@/summarize/config';

describe('summarize/config resolution', () => {
  it('model: flag over config over default', () => {
    expect(resolveSummaryModel('m1', { model: 'm2' })).toBe('m1');
    expect(resolveSummaryModel(undefined, { model: 'm2' })).toBe('m2');
    expect(resolveSummaryModel(undefined, {})).toBe(DEFAULT_SUMMARY_MODEL);
    expect(resolveSummaryModel(undefined)).toBe(DEFAULT_SUMMARY_MODEL);
  });

  it('model: an empty/whitespace-only flag falls through to config', () => {
    expect(resolveSummaryModel('   ', { model: 'm2' })).toBe('m2');
    expect(resolveSummaryModel('', { model: 'm2' })).toBe('m2');
    expect(resolveSummaryModel('', {})).toBe(DEFAULT_SUMMARY_MODEL);
  });

  it('engine: flag over config over default', () => {
    expect(resolveSummarizerName('claude', { engine: 'claude' })).toBe('claude');
    expect(resolveSummarizerName(undefined, { engine: 'claude' })).toBe('claude');
    expect(resolveSummarizerName(undefined, {})).toBe('claude');
    expect(resolveSummarizerName(undefined)).toBe('claude');
  });

  it('engine: unknown flag throws', () => {
    expect(() => resolveSummarizerName('gpt', {})).toThrow(/unknown summarizer/i);
  });

  it('engine: an empty/whitespace-only flag falls through to config', () => {
    expect(resolveSummarizerName('   ', { engine: 'claude' })).toBe('claude');
    expect(resolveSummarizerName('', { engine: 'claude' })).toBe('claude');
    expect(resolveSummarizerName('', {})).toBe('claude');
  });
});
