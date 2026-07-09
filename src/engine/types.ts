/** Engine selector value (CLI/config). */
export type EngineName = 'claude' | 'codex';

/**
 * A pluggable translation engine: one adapter per backend CLI. `name` is the
 * provenance label recorded in each artifact's `.yml` (e.g. "claude-code-cli",
 * "codex-cli"). `run` is one instruction+sourceText transformation call.
 */
export interface TranslationEngine {
  readonly name: string;
  run(
    prompt: string,
    sourceText: string,
    model?: string,
    systemPrompt?: string,
  ): Promise<string>;
}
