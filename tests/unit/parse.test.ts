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
      objectStore: false,
      reconcileRemote: false,
      checkpoint: false,
    });
  });

  it('defaults all flags to false when none are given', () => {
    const result = parse(['fetch-issue', 'ark:/12148/bpt6k000001']);

    expect(result.flags).toEqual({
      dryRun: false,
      force: false,
      verify: false,
      ocr: false,
      objectStore: false,
      reconcileRemote: false,
      checkpoint: false,
    });
  });

  it('parses --archive-root and --object-store', () => {
    const result = parse([
      'fetch-issue',
      'ark:/12148/bpt6k000001',
      '--archive-root',
      '/tmp/some-archive',
      '--object-store',
    ]);

    expect(result.options.archiveRoot).toBe('/tmp/some-archive');
    expect(result.flags.objectStore).toBe(true);
  });

  it('parses --checkpoint', () => {
    const result = parse([
      'fetch-issue',
      'ark:/12148/bpt6k000001',
      '--checkpoint',
    ]);

    expect(result.flags.checkpoint).toBe(true);
  });

  it('parses --checkpoint-every into a number', () => {
    const result = parse([
      'fetch-source',
      'ark:/12148/bpt6k000001',
      '--checkpoint',
      '--checkpoint-every',
      '25',
    ]);

    expect(result.options.checkpointEvery).toBe(25);
  });

  it('leaves checkpointEvery undefined when --checkpoint-every is absent', () => {
    const result = parse(['fetch-issue', 'ark:/12148/bpt6k000001']);

    expect(result.options.checkpointEvery).toBeUndefined();
  });

  it('throws a descriptive error when --checkpoint-every is zero', () => {
    expect(() =>
      parse(['fetch-source', 'ark:/12148/bpt6k000001', '--checkpoint-every', '0']),
    ).toThrow(/--checkpoint-every must be a positive integer/);
  });

  it('throws a descriptive error when --checkpoint-every is negative', () => {
    // `--checkpoint-every -3` (two args) is ambiguous to Node's parseArgs (it
    // could be another flag), so a negative value must use `=` syntax -- same
    // as any other Node CLI option taking a dash-prefixed value.
    expect(() =>
      parse(['fetch-source', 'ark:/12148/bpt6k000001', '--checkpoint-every=-3']),
    ).toThrow(/--checkpoint-every must be a positive integer/);
  });

  it('throws a descriptive error when --checkpoint-every is non-integer', () => {
    expect(() =>
      parse(['fetch-source', 'ark:/12148/bpt6k000001', '--checkpoint-every', '2.5']),
    ).toThrow(/--checkpoint-every must be a positive integer/);
  });

  it('throws a descriptive error when --checkpoint-every is non-numeric', () => {
    expect(() =>
      parse(['fetch-source', 'ark:/12148/bpt6k000001', '--checkpoint-every', 'abc']),
    ).toThrow(/--checkpoint-every must be a positive integer/);
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

  it('parses --engine into options', () => {
    const a = parse(['translate', 'ark', '--engine', 'codex']);
    expect(a.options.engine).toBe('codex');
  });
});
