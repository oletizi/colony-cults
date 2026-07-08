import { describe, it, expect } from 'vitest';
import { createClaudeCli } from '@/claude/client';
import type { ClaudeCommandRunner } from '@/claude/exec';
import type { ExecResult } from '@/ocr/exec';

/**
 * Unit coverage for `ClaudeCli` (T006): ONE `claude --print` invocation per
 * `run()` call, with the source text on stdin and the prompt as the
 * instruction argument. All calls go through an injected fake
 * `ClaudeCommandRunner` -- no real `claude` binary is invoked.
 */

interface FakeCall {
  command: string;
  args: string[];
  stdin?: string;
}

function fakeRunner(result: ExecResult): {
  runner: ClaudeCommandRunner;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const runner: ClaudeCommandRunner = {
    run: async (command, args, stdin) => {
      calls.push({ command, args, stdin });
      return result;
    },
  };
  return { runner, calls };
}

describe('createClaudeCli (T006)', () => {
  it('invokes claude --print with the prompt and sourceText on stdin', async () => {
    const { runner, calls } = fakeRunner({
      stdout: 'translated output',
      stderr: '',
      exitCode: 0,
    });
    const cli = createClaudeCli(runner);

    const result = await cli.run('Translate to English', 'bonjour le monde');

    expect(result).toBe('translated output');
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('claude');
    expect(calls[0].args).toContain('--print');
    expect(calls[0].args).toContain('Translate to English');
    expect(calls[0].stdin).toBe('bonjour le monde');
  });

  it('includes --model and the model name when a model is given', async () => {
    const { runner, calls } = fakeRunner({
      stdout: 'translated output',
      stderr: '',
      exitCode: 0,
    });
    const cli = createClaudeCli(runner);

    await cli.run('Translate to English', 'bonjour', 'claude-opus-4');

    expect(calls[0].args).toContain('--model');
    expect(calls[0].args).toContain('claude-opus-4');
  });

  it('omits --model when no model is given', async () => {
    const { runner, calls } = fakeRunner({
      stdout: 'translated output',
      stderr: '',
      exitCode: 0,
    });
    const cli = createClaudeCli(runner);

    await cli.run('Translate to English', 'bonjour');

    expect(calls[0].args).not.toContain('--model');
  });

  it('appends --append-system-prompt with the given system prompt', async () => {
    const { runner, calls } = fakeRunner({
      stdout: 'translated output',
      stderr: '',
      exitCode: 0,
    });
    const cli = createClaudeCli(runner);

    await cli.run('Translate to English', 'bonjour', 'some-model', 'BE TERSE');

    const idx = calls[0].args.indexOf('--append-system-prompt');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(calls[0].args[idx + 1]).toBe('BE TERSE');
  });

  it('omits --append-system-prompt when no system prompt is given', async () => {
    const { runner, calls } = fakeRunner({
      stdout: 'translated output',
      stderr: '',
      exitCode: 0,
    });
    const cli = createClaudeCli(runner);

    await cli.run('Translate to English', 'bonjour');

    expect(calls[0].args).not.toContain('--append-system-prompt');
  });

  it('returns the runner stdout on exit code 0 with non-empty output', async () => {
    const { runner } = fakeRunner({
      stdout: '  some translated text  ',
      stderr: '',
      exitCode: 0,
    });
    const cli = createClaudeCli(runner);

    const result = await cli.run('prompt', 'source');

    expect(result).toBe('  some translated text  ');
  });

  it('throws a descriptive error on a non-zero exit code, including stderr', async () => {
    const { runner } = fakeRunner({
      stdout: '',
      stderr: 'authentication expired',
      exitCode: 1,
    });
    const cli = createClaudeCli(runner);

    await expect(cli.run('prompt', 'source')).rejects.toThrow(
      /authentication expired/,
    );
    await expect(cli.run('prompt', 'source')).rejects.toThrow(/claude/);
    await expect(cli.run('prompt', 'source')).rejects.toThrow(/1/);
  });

  it('throws a descriptive error on empty stdout', async () => {
    const { runner } = fakeRunner({ stdout: '', stderr: '', exitCode: 0 });
    const cli = createClaudeCli(runner);

    await expect(cli.run('prompt', 'source')).rejects.toThrow(/empty|no output|produced nothing/i);
  });

  it('throws a descriptive error on whitespace-only stdout', async () => {
    const { runner } = fakeRunner({ stdout: '   \n\t  ', stderr: '', exitCode: 0 });
    const cli = createClaudeCli(runner);

    await expect(cli.run('prompt', 'source')).rejects.toThrow(/empty|no output|produced nothing/i);
  });
});
