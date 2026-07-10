import type { EngineName, TranslationEngine } from '@/engine/types';
import { createClaudeCli } from '@/claude/client';
import { defaultClaudeCommandRunner } from '@/claude/exec';
import { assertClaudeAvailable } from '@/claude/preflight';
import { createCodexEngine } from '@/codex/client';
import { defaultCodexCommandRunner } from '@/codex/exec';
import { assertCodexAvailable } from '@/codex/preflight';

/** A constructed engine paired with its own preflight check. */
export interface EngineBundle {
  engine: TranslationEngine;
  preflight: () => Promise<void>;
}

/**
 * Build the {@link TranslationEngine} + preflight pair named by `name`,
 * wiring each adapter to its real (shell-out) command runner. An explicit
 * `switch` over the closed {@link EngineName} union keeps this exhaustive --
 * adding a new engine name to the type without a matching case is a
 * compile error.
 */
export function createEngine(name: EngineName): EngineBundle {
  switch (name) {
    case 'claude':
      return {
        engine: createClaudeCli(defaultClaudeCommandRunner()),
        preflight: () => assertClaudeAvailable(),
      };
    case 'codex':
      return {
        engine: createCodexEngine(defaultCodexCommandRunner()),
        preflight: () => assertCodexAvailable(),
      };
  }
}
