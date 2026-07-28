import { join } from 'node:path';

import { describeError } from '@/bibliography/load-primitives';
import { loadCorpusManifest, type CorpusManifest } from '@/corpus/manifest';

/**
 * Explicit corpus selection — the composition-root entry point for User
 * Story 1. See specs/018-corpus-config-seam/spec.md (FR-003, FR-009,
 * User Story 1) and contracts/corpus-seam.md (§Selection).
 *
 * SCOPE: selection + existence checking only. This module does NOT
 * validate `requiredCapabilities` subsets (startup validation, a later
 * task), does NOT perform repository-wide config validation (`@/corpus/
 * validate`), and does NOT derive narrow per-seam policies (`@/corpus/
 * policies`) — it hands back the whole `SelectedCorpus`, from which those
 * later steps derive their narrow inputs.
 */

/**
 * Inputs to {@link selectCorpus}. `corporaRoot` is REQUIRED here, not
 * optional or defaulted (FR-016) — this module never hardcodes a corpora
 * root, so the caller (the CLI / browser-build composition root) must
 * resolve and inject it. `cliCorpus` and `envCorpus` are plain data: the
 * caller is responsible for reading `--corpus` and `process.env.
 * COLONY_CORPUS` and passing the resulting strings in.
 *
 * `selectCorpus` is pure with respect to ambient state — it reads none of
 * `process.env`, `process.argv`, or a case operand. It is called exactly
 * once, at the composition root; every core module downstream consumes
 * only the narrow policies derived from its result.
 */
export interface SelectCorpusOptions {
  /**
   * The injected corpora root (FR-016) — `<repoRoot>/corpora` in
   * production, a fixture directory (e.g. `tests/fixtures/corpora/...`)
   * under test. Never a literal or a default inside this module.
   */
  corporaRoot: string;
  /** The `--corpus` CLI flag value, if the caller supplied one. */
  cliCorpus?: string;
  /**
   * The `COLONY_CORPUS` environment variable value, if set. The caller
   * reads `process.env.COLONY_CORPUS` and passes it in — this function
   * never inspects `process.env` itself.
   */
  envCorpus?: string;
}

/**
 * The composition-root selection result (data-model.md § SelectedCorpus).
 * Carries the full validated manifest plus the `corporaRoot` it was
 * resolved against, so that a later composition-root step (narrow-policy
 * derivation, including the `BrowserProfile`, which lives beside the
 * manifest under the same root) has everything it needs without
 * re-deriving or re-injecting the root. It is NOT itself injected whole
 * into core modules — those receive only the narrow policies derived from
 * it.
 */
export interface SelectedCorpus {
  readonly corporaRoot: string;
  readonly manifest: CorpusManifest;
}

function fail(message: string): never {
  throw new Error(`selectCorpus: ${message}`);
}

/**
 * Resolve the active corpus, explicitly, with NO implicit default
 * (Principle V — Fail Loud, No Fallbacks).
 *
 * Precedence: `cliCorpus` (`--corpus`) wins over `envCorpus`
 * (`COLONY_CORPUS`), which wins over nothing — if neither is supplied,
 * this throws. There is no fallback corpus, and specifically no implicit
 * Port Breton default.
 *
 * An id naming no committed manifest under `corporaRoot` throws, naming
 * the missing manifest.
 */
export function selectCorpus(options: SelectCorpusOptions): SelectedCorpus {
  const { corporaRoot, cliCorpus, envCorpus } = options;

  const id = cliCorpus ?? envCorpus;
  if (id === undefined) {
    fail(
      'no corpus selected — pass --corpus <id>, or set the COLONY_CORPUS ' +
        'environment variable to <id>; there is no implicit default (see FR-003)',
    );
  }

  let manifest: CorpusManifest;
  try {
    manifest = loadCorpusManifest(corporaRoot, id);
  } catch (error) {
    fail(
      `unknown corpus ${JSON.stringify(id)} — no manifest at ` +
        `${join(corporaRoot, `${id}.yml`)} (${describeError(error)})`,
    );
  }

  return { corporaRoot, manifest };
}
