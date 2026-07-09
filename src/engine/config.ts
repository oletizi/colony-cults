import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineName } from '@/engine/types';

/**
 * Shape of `translate.config.json`: an optional default engine plus
 * optional per-engine default models. All fields are optional -- an absent
 * config file resolves to `{}`, which falls all the way through to the
 * built-in defaults below.
 */
export interface EngineConfig {
  engine?: EngineName;
  models?: { claude?: string; codex?: string };
}

/** Engine selected when neither a CLI flag nor `config.engine` is set. */
export const DEFAULT_ENGINE: EngineName = 'claude';

/** Per-engine model selected when neither a CLI flag nor `config.models[engine]` is set. */
export const DEFAULT_MODELS: Record<EngineName, string> = {
  claude: 'claude-opus-4-8',
  codex: 'gpt-5.5',
};

const ENGINES: readonly EngineName[] = ['claude', 'codex'];

/**
 * Validate + narrow an arbitrary string into an {@link EngineName} via an
 * explicit `switch` (never `value as EngineName`) so an unrecognized engine
 * name throws instead of being silently accepted.
 */
function assertEngine(value: string): EngineName {
  switch (value) {
    case 'claude':
      return 'claude';
    case 'codex':
      return 'codex';
    default:
      throw new Error(
        `unknown engine "${value}" (expected one of: ${ENGINES.join(', ')})`,
      );
  }
}

/**
 * Resolve the engine to use for a run: CLI flag beats config beats the
 * built-in default. A flag value is always validated (and throws when it
 * names an unsupported engine); a config value is trusted as already
 * validated (by {@link loadEngineConfig}).
 */
export function resolveEngine(
  flag: string | undefined,
  config: EngineConfig,
): EngineName {
  if (flag !== undefined) {
    return assertEngine(flag);
  }
  if (config.engine !== undefined) {
    return config.engine;
  }
  return DEFAULT_ENGINE;
}

/**
 * Resolve the model to use for a run: CLI flag beats
 * `config.models[engine]` beats that engine's built-in default.
 */
export function resolveModel(
  flag: string | undefined,
  engine: EngineName,
  config: EngineConfig,
): string {
  if (flag !== undefined) {
    return flag;
  }
  const configured = config.models?.[engine];
  if (configured !== undefined) {
    return configured;
  }
  return DEFAULT_MODELS[engine];
}

/** Narrow `unknown` to a plain (non-array) object without a type assertion. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the parsed JSON body of `translate.config.json` into an
 * {@link EngineConfig}, defensively: unknown keys are ignored, `engine` is
 * validated via {@link assertEngine} when present as a string, and
 * `models.claude`/`models.codex` are read only when they are strings. No
 * type assertions are used -- every field access is gated by a `typeof`/
 * `isRecord` check.
 */
function readConfig(parsed: Record<string, unknown>): EngineConfig {
  const cfg: EngineConfig = {};

  if (typeof parsed.engine === 'string') {
    cfg.engine = assertEngine(parsed.engine);
  }

  if (isRecord(parsed.models)) {
    const models: { claude?: string; codex?: string } = {};
    if (typeof parsed.models.claude === 'string') {
      models.claude = parsed.models.claude;
    }
    if (typeof parsed.models.codex === 'string') {
      models.codex = parsed.models.codex;
    }
    cfg.models = models;
  }

  return cfg;
}

/**
 * Load `translate.config.json` from `repoRoot`. An absent file resolves to
 * `{}` (no config = all defaults); a malformed file (invalid JSON, or a
 * non-object root) throws rather than silently falling back, so operators
 * discover a broken config immediately instead of getting unexplained
 * default behavior.
 */
export async function loadEngineConfig(repoRoot: string): Promise<EngineConfig> {
  const file = path.join(repoRoot, 'translate.config.json');

  let raw: string;
  try {
    raw = await readFile(file, 'utf-8');
  } catch {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(
      `translate.config.json is malformed (expected a JSON object at the root): ${file}`,
    );
  }

  return readConfig(parsed);
}
