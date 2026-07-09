import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TranslationEngine } from '@/engine/types';
import type { CodexCommandRunner } from '@/codex/exec';

/**
 * Isolation flags: run codex as a non-agentic, config-free text engine (the
 * analog to the claude `--disable-slash-commands --tools ""` hardening).
 * The exact set is confirmed in the Task-1 spike and recorded in the design
 * doc: sandboxed to read-only, no user config, no project rules, no git
 * repo check, and ephemeral (no session persisted).
 */
const CODEX_ISOLATION = [
  '-s', 'read-only',
  '--ignore-user-config',
  '--ignore-rules',
  '--skip-git-repo-check',
  '--ephemeral',
];

/** Read codex's `-o` last-message file, injected so tests avoid disk. */
export async function readLastMessageFile(file: string): Promise<string> {
  const text = await readFile(file, 'utf-8');
  await unlink(file).catch(() => undefined);
  return text;
}

/**
 * Build a {@link TranslationEngine} backed by the given
 * {@link CodexCommandRunner}. A factory + closure over the injected runner
 * (composition, not inheritance) so tests can supply a fake runner and
 * never shell out to a real `codex` binary. `name` records this adapter's
 * provenance label for artifact `.yml` metadata.
 *
 * codex exec has no separate system-prompt channel like `claude
 * --append-system-prompt`, so `systemPrompt` (when provided) is folded into
 * the prompt argument ahead of the instruction. The transformed result is
 * not captured stdout -- it is written by codex to the file named by `-o`,
 * which this adapter reads via the injected `readLastMessage` and deletes
 * afterward (real deletion happens in {@link readLastMessageFile}; tests
 * inject a fake that never touches disk).
 */
export function createCodexEngine(
  runner: CodexCommandRunner,
  readLastMessage: (file: string) => Promise<string> = readLastMessageFile,
): TranslationEngine {
  return {
    name: 'codex-cli',
    async run(
      prompt: string,
      sourceText: string,
      model?: string,
      systemPrompt?: string,
    ): Promise<string> {
      // codex exec has no separate system channel: fold systemPrompt into the prompt.
      const folded = systemPrompt !== undefined ? `${systemPrompt}\n\n${prompt}` : prompt;
      const outFile = path.join(
        tmpdir(),
        `codex-out-${globalThis.process.pid}-${randomUUID()}.txt`,
      );
      const args = ['exec', folded, ...CODEX_ISOLATION, '-o', outFile];
      if (model !== undefined) {
        args.push('-m', model);
      }
      const result = await runner.run('codex', args, sourceText);

      if (result.exitCode !== 0) {
        throw new Error(
          `codex exec failed (exit ${result.exitCode}): ${result.stderr.trim() || '(no stderr)'}`,
        );
      }

      const message = await readLastMessage(outFile);
      if (message.trim().length === 0) {
        throw new Error('codex exec produced empty output (no fallback substituted).');
      }
      return message;
    },
  };
}
