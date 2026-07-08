import { describe, it, expect } from 'vitest';
import { parse } from '@/cli/parse';

describe('parse', () => {
  it('extracts command, positional args, and flags', () => {
    const result = parse([
      'census',
      'ark:/12148/cb328261098/date',
      '--dry-run',
      '--ocr',
    ]);

    expect(result.command).toBe('census');
    expect(result.positional).toEqual(['ark:/12148/cb328261098/date']);
    expect(result.flags).toEqual({
      dryRun: true,
      force: false,
      verify: false,
      ocr: true,
    });
  });

  it('defaults all flags to false when none are given', () => {
    const result = parse(['fetch-issue', 'ark:/12148/bpt6k000001']);

    expect(result.flags).toEqual({
      dryRun: false,
      force: false,
      verify: false,
      ocr: false,
    });
  });

  it('throws a descriptive error on an unknown command', () => {
    expect(() => parse(['bogus', 'ark:/12148/foo'])).toThrow(
      /unknown command "bogus"/,
    );
  });

  it('throws a descriptive error when no command is given', () => {
    expect(() => parse([])).toThrow(/missing command/);
  });

  it('throws a descriptive error when the required positional is missing', () => {
    expect(() => parse(['ocr'])).toThrow(
      /ocr: missing required argument <issueArk>/,
    );
  });
});
