import { execCommand } from '@/ocr/exec';
import type { ExecResult } from '@/ocr/exec';

/** Injectable codex command runner (mirrors ClaudeCommandRunner). */
export interface CodexCommandRunner {
  run(command: string, args: string[], stdin?: string): Promise<ExecResult>;
}

/** Real runner: delegates to the shared execCommand (stdin supported). */
export function defaultCodexCommandRunner(): CodexCommandRunner {
  return { run: (command, args, stdin) => execCommand(command, args, stdin) };
}
