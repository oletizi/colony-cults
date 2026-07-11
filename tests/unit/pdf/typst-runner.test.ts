/**
 * Unit tests for `@/pdf/render/typst-runner` (specs/007-corpus-print-pdf/
 * contracts/typst-template.md G-5): asserts the `typst compile` request shape
 * shelled through the injected `ExecRunner`, and that a non-zero exit throws
 * with the captured stderr surfaced verbatim. Uses a FAKE `ExecRunner` --
 * no real `typst` binary is required.
 */

import { describe, expect, it } from 'vitest';

import type { ExecResult } from '@/ocr/exec';
import { makeTypstRunner, type ExecRunner } from '@/pdf/render/typst-runner';

interface RecordedCall {
  command: string;
  args: string[];
  stdin: string | undefined;
}

function fakeExecRunner(result: ExecResult): { runner: ExecRunner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const runner: ExecRunner = {
    run: async (command, args, stdin) => {
      calls.push({ command, args, stdin });
      return result;
    },
  };
  return { runner, calls };
}

const request = {
  templatePath: '/repo/pdf/template/edition.typ',
  inputPath: '/tmp/build-xyz/typst-input.json',
  imageDir: '/tmp/build-xyz/images',
  outPath: '/repo/build/pdf/PB-P001/PB-P001-1879-08-15.pdf',
  root: '/repo',
  fontPath: '/repo/pdf/template/fonts',
};

describe('makeTypstRunner (G-5 request shape)', () => {
  it('shells "typst compile <template> <out> --root <root> --font-path <fontPath> --ignore-system-fonts --input data=<inputPath> --input images=<imageDir>"', async () => {
    const { runner, calls } = fakeExecRunner({ stdout: '', stderr: '', exitCode: 0 });
    const result = await makeTypstRunner(runner).compile(request);

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('typst');
    expect(calls[0].args).toEqual([
      'compile',
      request.templatePath,
      request.outPath,
      '--root',
      request.root,
      '--font-path',
      request.fontPath,
      '--ignore-system-fonts',
      '--input',
      `data=${request.inputPath}`,
      '--input',
      `images=${request.imageDir}`,
    ]);
    expect(result).toEqual({ outPath: request.outPath });
  });

  it('sandboxes reads to --root and resolves fonts from --font-path', async () => {
    const { runner, calls } = fakeExecRunner({ stdout: '', stderr: '', exitCode: 0 });
    await makeTypstRunner(runner).compile(request);

    const args = calls[0].args;
    const rootIndex = args.indexOf('--root');
    const fontIndex = args.indexOf('--font-path');
    expect(rootIndex).toBeGreaterThanOrEqual(0);
    expect(args[rootIndex + 1]).toBe(request.root);
    expect(fontIndex).toBeGreaterThanOrEqual(0);
    expect(args[fontIndex + 1]).toBe(request.fontPath);
  });

  it('never reimplements layout -- resolves to exactly the requested outPath', async () => {
    const { runner } = fakeExecRunner({ stdout: '', stderr: '', exitCode: 0 });
    const result = await makeTypstRunner(runner).compile(request);
    expect(result.outPath).toBe(request.outPath);
  });
});

describe('makeTypstRunner (G-5 fail-loud, stderr surfaced verbatim)', () => {
  it('throws on a non-zero exit, with the exact stderr text in the error message', async () => {
    const stderr =
      'error: file not found (searched at "/repo/pdf/template/edition.typ")\n' +
      '  |\n' +
      '  = hint: check the --root and file path';
    const { runner } = fakeExecRunner({ stdout: '', stderr, exitCode: 1 });

    await expect(makeTypstRunner(runner).compile(request)).rejects.toThrow(
      /error: file not found \(searched at "\/repo\/pdf\/template\/edition\.typ"\)/
    );
    await expect(makeTypstRunner(runner).compile(request)).rejects.toThrow(
      /hint: check the --root and file path/
    );
  });

  it('surfaces a missing-binary failure (non-zero exit, empty stderr/stdout) with a descriptive message', async () => {
    const { runner } = fakeExecRunner({ stdout: '', stderr: '', exitCode: 1 });
    await expect(makeTypstRunner(runner).compile(request)).rejects.toThrow(/typst/);
    await expect(makeTypstRunner(runner).compile(request)).rejects.toThrow(/PATH/);
  });

  it('falls back to stdout when stderr is empty but stdout carries the failure detail', async () => {
    const { runner } = fakeExecRunner({ stdout: 'compile failed: see log', stderr: '', exitCode: 2 });
    await expect(makeTypstRunner(runner).compile(request)).rejects.toThrow(/compile failed: see log/);
  });

  it('does not throw on a zero exit even with non-empty stderr (e.g. warnings)', async () => {
    const { runner } = fakeExecRunner({
      stdout: '',
      stderr: 'warning: layer overflow on page 3',
      exitCode: 0,
    });
    await expect(makeTypstRunner(runner).compile(request)).resolves.toEqual({
      outPath: request.outPath,
    });
  });
});
