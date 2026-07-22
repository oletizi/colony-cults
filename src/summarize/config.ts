import type { SummarizerName } from '@/summarize/types';

/**
 * Shape of summary config: an optional default model. All fields are optional --
 * an absent config resolves to an empty object, which falls through to the
 * built-in defaults below.
 */
export interface SummaryConfig {
  model?: string;
  engine?: SummarizerName;
}

/** Model selected when neither a CLI flag nor `config.model` is set. */
export const DEFAULT_SUMMARY_MODEL = 'claude-sonnet-5';

/**
 * Resolve the model to use for summarization: CLI flag beats config beats the
 * built-in default. A flag value is taken as-is; a config value is trusted as
 * already validated.
 */
export function resolveSummaryModel(
  flag: string | undefined,
  config?: SummaryConfig,
): string {
  if (flag !== undefined && flag.trim().length > 0) {
    return flag;
  }
  if (config?.model !== undefined) {
    return config.model;
  }
  return DEFAULT_SUMMARY_MODEL;
}

/**
 * Resolve the summarizer engine to use: CLI flag beats config beats default.
 * v1 defaults to 'claude'; future versions may add 'codex' or other engines.
 */
export function resolveSummarizerName(
  flag: string | undefined,
  config?: SummaryConfig,
): SummarizerName {
  if (flag !== undefined && flag.trim().length > 0) {
    return validateSummarizerName(flag);
  }
  if (config?.engine !== undefined) {
    return config.engine;
  }
  return 'claude';
}

/**
 * Validate + narrow an arbitrary string into a {@link SummarizerName} via an
 * explicit `switch` (never a type assertion) so an unrecognized summarizer
 * name throws instead of being silently accepted.
 */
function validateSummarizerName(value: string): SummarizerName {
  switch (value) {
    case 'claude':
      return 'claude';
    default:
      throw new Error(
        `unknown summarizer "${value}" (expected one of: claude)`,
      );
  }
}
