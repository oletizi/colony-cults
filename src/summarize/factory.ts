import type { SummarizerName, SummarizationRunner } from '@/summarize/types';
import { createClaudeSummarizer } from '@/summarize/runner-claude';
import { defaultClaudeCommandRunner } from '@/claude/exec';
import { assertClaudeAvailable } from '@/claude/preflight';

/** A constructed summarizer paired with its own preflight check. */
export interface SummarizerBundle {
  runner: SummarizationRunner;
  preflight: () => Promise<void>;
}

/**
 * Build the {@link SummarizationRunner} + preflight pair named by `name`,
 * wiring each adapter to its real (shell-out) command runner. Mirrors
 * `createEngine` (`src/engine/factory.ts`). An explicit `switch` over the
 * closed {@link SummarizerName} union keeps this exhaustive -- adding a new
 * summarizer name to the type without a matching case is a compile error.
 */
export function createSummarizer(name: SummarizerName): SummarizerBundle {
  switch (name) {
    case 'claude':
      return {
        runner: createClaudeSummarizer(defaultClaudeCommandRunner()),
        preflight: () => assertClaudeAvailable(),
      };
  }
}
