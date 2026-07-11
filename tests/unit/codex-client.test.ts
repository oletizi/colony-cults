import { describe, it, expect } from 'vitest';
import type { ExecResult } from '@/ocr/exec';
import { createCodexEngine } from '@/codex/client';

interface Call { command: string; args: string[]; stdin?: string }
function fake(result: ExecResult, fileContent: string) {
  const calls: Call[] = [];
  const runner = { run: async (command: string, args: string[], stdin?: string) => { calls.push({ command, args, stdin }); return result; } };
  const readLastMessage = async (_file: string) => fileContent;
  return { runner, readLastMessage, calls };
}

describe('createCodexEngine', () => {
  it('runs `codex exec` isolated, folds the system prompt, returns the -o message', async () => {
    const { runner, readLastMessage, calls } = fake({ stdout: '', stderr: '', exitCode: 0 }, 'English text here, plenty long.');
    const engine = createCodexEngine(runner, readLastMessage);
    expect(engine.name).toBe('codex-cli');
    const out = await engine.run('INSTRUCTION', 'Texte français', 'gpt-5-codex', 'SYSTEM RULES');
    expect(out).toBe('English text here, plenty long.');
    expect(calls[0].command).toBe('codex');
    expect(calls[0].args).toContain('exec');
    expect(calls[0].args).toContain('--ignore-user-config');
    expect(calls[0].args).toContain('--ignore-rules');
    expect(calls[0].args).toContain('read-only');
    expect(calls[0].args).toContain('--ephemeral');
    expect(calls[0].args).toContain('-m'); expect(calls[0].args).toContain('gpt-5-codex');
    const oIdx = calls[0].args.indexOf('-o'); expect(oIdx).toBeGreaterThanOrEqual(0);
    // prompt arg folds SYSTEM RULES + INSTRUCTION
    const prompt = calls[0].args.find((a) => a.includes('INSTRUCTION') && a.includes('SYSTEM RULES'));
    expect(prompt).toBeDefined();
    expect(calls[0].stdin).toBe('Texte français');
  });
  it('omits -m when model is undefined', async () => {
    const { runner, readLastMessage, calls } = fake({ stdout: '', stderr: '', exitCode: 0 }, 'English text here, plenty long.');
    const engine = createCodexEngine(runner, readLastMessage);
    await engine.run('i', 's', undefined, 'sys');
    expect(calls[0].args).not.toContain('-m');
  });
  it('throws on non-zero exit', async () => {
    const { runner, readLastMessage } = fake({ stdout: '', stderr: 'boom', exitCode: 2 }, '');
    const engine = createCodexEngine(runner, readLastMessage);
    await expect(engine.run('i', 's', undefined, 'sys')).rejects.toThrow(/codex exec/);
  });
  it('throws on empty final message', async () => {
    const { runner, readLastMessage } = fake({ stdout: '', stderr: '', exitCode: 0 }, '   ');
    const engine = createCodexEngine(runner, readLastMessage);
    await expect(engine.run('i', 's', undefined, 'sys')).rejects.toThrow(/empty/);
  });
});
