import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
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

/** Narrow `unknown` to a plain (non-array) object without a type assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the parsed JSON body of `summarize.config.json` into a
 * {@link SummaryConfig}, defensively: unknown keys are ignored, and known
 * keys (`model`, `engine`) must be correctly typed (string) or an error is
 * thrown immediately. No type assertions are used -- every field access is
 * gated by a `typeof`/`isRecord` check. Mirrors `src/engine/config.ts`'s
 * `readConfig` (AUDIT-20260722-13: fail loud on malformed known keys
 * instead of silently accepting them).
 */
function readConfig(parsed: Record<string, unknown>): SummaryConfig {
  const cfg: SummaryConfig = {};

  if ('model' in parsed) {
    if (typeof parsed.model !== 'string') {
      throw new Error(
        `summarize.config.json has invalid model field: expected string, got ${typeof parsed.model} (value: ${JSON.stringify(parsed.model)})`,
      );
    }
    cfg.model = parsed.model;
  }

  if ('engine' in parsed) {
    if (typeof parsed.engine !== 'string') {
      throw new Error(
        `summarize.config.json has invalid engine field: expected string, got ${typeof parsed.engine} (value: ${JSON.stringify(parsed.engine)})`,
      );
    }
    cfg.engine = validateSummarizerName(parsed.engine);
  }

  return cfg;
}

/**
 * Load `summarize.config.json` from `repoRoot`. An absent file resolves to
 * `{}` (no config = all defaults); a malformed file (invalid JSON, or a
 * non-object root) throws rather than silently falling back, so operators
 * discover a broken config immediately instead of getting unexplained
 * default behavior. Mirrors `src/engine/config.ts`'s `loadEngineConfig`
 * (AUDIT-20260722-03: the summarize CLI previously had no config layer at
 * all, so `flag > config > default` degraded to `flag > default`).
 *
 * Absence is checked explicitly via `access` BEFORE the read, so only a
 * missing file resolves to `{}` -- any error from the subsequent `readFile`
 * or `JSON.parse` (permission denied, a directory in the file's place, a
 * transient I/O error, malformed JSON) propagates uncaught instead of being
 * silently swallowed as "no config".
 */
export async function loadSummaryConfig(repoRoot: string): Promise<SummaryConfig> {
  const file = path.join(repoRoot, 'summarize.config.json');

  try {
    await access(file);
  } catch {
    return {};
  }

  const raw = await readFile(file, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(
      `summarize.config.json is malformed (expected a JSON object at the root): ${file}`,
    );
  }

  return readConfig(parsed);
}
