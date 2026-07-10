import { execCommand, type ExecResult } from '@/ocr/exec';

/**
 * Runs one `claude` CLI invocation to completion (T004, research R8). Mirrors
 * `@/ocr/types`' `OcrCommandRunner` shape but adds the optional `stdin`
 * parameter the Claude CLI needs to receive source text on standard input.
 * The indirection (an interface plus a factory) lets tests inject a fake
 * runner instead of shelling out to a real `claude` binary.
 */
export interface ClaudeCommandRunner {
  run(command: string, args: string[], stdin?: string): Promise<ExecResult>;
}

/** The real (shell-out) command runner, used by CLI wiring in production. */
export function defaultClaudeCommandRunner(): ClaudeCommandRunner {
  return {
    run: (command, args, stdin) => execCommand(command, args, stdin),
  };
}
