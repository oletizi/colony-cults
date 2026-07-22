import { describe, it, expect } from 'vitest';
import { createSummarizer } from '@/summarize/factory';

describe('createSummarizer', () => {
  it('builds the claude summarizer + preflight', () => {
    const { runner, preflight } = createSummarizer('claude');
    expect(runner.name).toBe('claude-code-cli');
    expect(typeof preflight).toBe('function');
  });
});
