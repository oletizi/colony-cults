import { describe, it, expect } from 'vitest';
import {
  defaultClaudeCommandRunner,
  type ClaudeCommandRunner,
} from '@/claude/exec';

/**
 * Unit coverage for the Claude CLI command adapter (T004). The default
 * runner delegates to the extended `execCommand` (`@/ocr/exec`), which now
 * accepts an optional `stdin` string; `cat` with no args is a portable way
 * to prove stdin actually reaches the child process on this darwin host.
 */

describe('defaultClaudeCommandRunner (T004)', () => {
  it('writes stdin to the child process and captures it on stdout', async () => {
    const runner = defaultClaudeCommandRunner();
    const result = await runner.run('cat', [], 'bonjour');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('bonjour');
  });

  it('resolves with an empty stdout when no stdin is provided', async () => {
    const runner = defaultClaudeCommandRunner();
    const result = await runner.run('echo', ['bonjour']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('bonjour');
  });
});

describe('ClaudeCommandRunner (compile-time shape + fake injection)', () => {
  it('accepts a fake runner satisfying the interface and records the call', async () => {
    const calls: Array<{ command: string; args: string[]; stdin?: string }> =
      [];
    const fakeRunner: ClaudeCommandRunner = {
      run: async (command, args, stdin) => {
        calls.push({ command, args, stdin });
        return { stdout: 'fake-output', stderr: '', exitCode: 0 };
      },
    };

    const result = await fakeRunner.run('claude', ['--print'], 'bonjour');

    expect(result).toEqual({ stdout: 'fake-output', stderr: '', exitCode: 0 });
    expect(calls).toEqual([
      { command: 'claude', args: ['--print'], stdin: 'bonjour' },
    ]);
  });
});
