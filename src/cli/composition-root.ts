import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveScopeContext,
  deriveSourceIdPolicy,
  type ScopeResolutionContext,
  type SourceIdPolicy,
} from '@/corpus/policies';
import { selectCorpus, type SelectedCorpus } from '@/corpus/select';

/**
 * THE CLI COMPOSITION ROOT (T009). See spec.md FR-003, FR-004, FR-009,
 * FR-016 and contracts/corpus-seam.md (§Selection).
 *
 * This module is the ONE place in the codebase that may:
 *   1. name the production corpora directory (`corpora`, FR-016) — no core
 *      module hardcodes it, which is what makes SC-003 (a fixture corpus
 *      selected with zero `src/` edits) achievable; and
 *   2. turn a selected corpus into the NARROW per-seam policies (FR-004) the
 *      hotspots consume.
 *
 * It deliberately does NOT read `process.env`: the two bins
 * (`@/cli/dispatch`, `@/cli/translate-dispatch`) read `COLONY_CORPUS` at their
 * entry points and pass it in as data, keeping this module and `selectCorpus`
 * pure with respect to ambient state.
 */

/**
 * Walk up from `startDir` to the nearest ancestor containing a `package.json`,
 * stopping at the filesystem root. Depth-agnostic on purpose: this module runs
 * from `src/cli/` under `tsx` (two levels below the repo root) and from
 * `dist/` in the esbuild bundle (one level) — a single hardcoded relative path
 * cannot be correct for both.
 */
export function findPackageJsonUpward(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`could not locate package.json above ${startDir}`);
    }
    dir = parent;
  }
}

/** The repository root, resolved depth-agnostically from this module's location. */
export function resolveRepoRootUpward(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return dirname(findPackageJsonUpward(moduleDir));
}

/**
 * The production corpora directory name — the ONE literal permitted anywhere
 * for it (FR-016). Tests inject their own root (`tests/fixtures/corpora`)
 * instead of going through this.
 */
export const PRODUCTION_CORPORA_DIRNAME = 'corpora';

/** Resolve the production corpora root under a repo root (FR-016). */
export function resolveCorporaRoot(repoRoot: string): string {
  return join(repoRoot, PRODUCTION_CORPORA_DIRNAME);
}

/**
 * The composition root's bundle of derived, narrow per-seam policies.
 *
 * THIS IS NOT AN OMNIBUS CORPUS OBJECT INJECTED INTO CORE MODULES (FR-004).
 * It exists only at the root and inside the two dispatchers; a hotspot
 * receives ONLY its own field — `scope` for `bibliography/scope.ts`,
 * `sourceIds` for `sourcegroup/id-alloc.ts` — never this record, never the
 * manifest, never a registry.
 *
 * TWO POLICIES ARE DELIBERATELY ABSENT HERE, both for stated reasons:
 * - `ArchiveLayoutPolicy` — `deriveArchiveLayoutPolicy` requires the corpus's
 *   already-loaded `Source[]` (its `derived` map must be PRECOMPUTED per
 *   Source id; see `@/corpus/policies`). Loading the whole SSOT for every
 *   command — including commands that never touch a layout — would change
 *   observable behavior (a malformed SSOT would start failing at startup) and
 *   contradict FR-010. `archive/location.ts`'s seam is T013; the load-side
 *   `SourceFilenamePolicy` it needs is T023.
 * - `BrowserDefaultsPolicy` — per the FR-014 table, **no** registered CLI
 *   command consumes browser defaults; the only consumer is the Astro site
 *   build (`src/browser/config.ts`), a separate composition root wired in
 *   T014. FR-005 also requires that a missing profile never fails a
 *   non-browser command, which deriving it here would risk.
 */
export interface CorpusComposition {
  /** The selection result — manifest + the injected `corporaRoot` it came from. */
  readonly selected: SelectedCorpus;
  /** Narrow policy for `bibliography/scope.ts` (T011). */
  readonly scope: ScopeResolutionContext;
  /** Narrow policy for `sourcegroup/id-alloc.ts` (T012). */
  readonly sourceIds: SourceIdPolicy;
}

/** Inputs to {@link composeCorpus}: pure data, resolved by the caller. */
export interface ComposeCorpusOptions {
  /** The injected corpora root (FR-016). Required — never defaulted here. */
  readonly corporaRoot: string;
  /** The extracted `--corpus` value, if any. */
  readonly cliCorpus?: string;
  /** The `COLONY_CORPUS` value the bin read, if any. */
  readonly envCorpus?: string;
}

/**
 * Reject a selector that is present but blank. An exported-but-empty
 * `COLONY_CORPUS=` (or `--corpus ""`) is an ambiguous invocation, so it fails
 * loud rather than being silently treated as "unset" — treating it as unset
 * would be exactly the implicit fallback Principle V forbids.
 */
function requireNonBlank(value: string | undefined, origin: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.trim().length === 0) {
    throw new Error(
      `${origin} is set but empty — pass a corpus id (e.g. port-breton) or unset it; ` +
        `an empty value is not an implicit default (FR-003)`,
    );
  }
  return value;
}

/**
 * Resolve the corpus ONCE and derive the narrow policies from it (FR-003,
 * FR-004). Throws — loud, no fallback — when no corpus is selected, when the
 * selected id names no manifest under `corporaRoot`, or when the manifest is
 * invalid (FR-009).
 */
export function composeCorpus(options: ComposeCorpusOptions): CorpusComposition {
  const selected = selectCorpus({
    corporaRoot: options.corporaRoot,
    cliCorpus: requireNonBlank(options.cliCorpus, '--corpus'),
    envCorpus: requireNonBlank(options.envCorpus, 'COLONY_CORPUS'),
  });

  return {
    selected,
    scope: deriveScopeContext(selected),
    sourceIds: deriveSourceIdPolicy(selected),
  };
}

/**
 * Assert that a corpus-dependent code path actually received a composition.
 *
 * `null` reaches a dispatcher only on the FR-014 exception path, so a `null`
 * here means a command was classified as an exception but then reached
 * corpus-dependent work — a wiring defect, not a data problem. It fails loud
 * naming the command rather than silently proceeding without policies.
 */
export function requireCorpus(
  corpus: CorpusComposition | null,
  commandName: string,
): CorpusComposition {
  if (corpus === null) {
    throw new Error(
      `${commandName}: no corpus was composed for a corpus-dependent command — ` +
        `this command is classified as an FR-014 exception but reached corpus-dependent ` +
        `work; fix its classification in @/cli/corpus-exceptions`,
    );
  }
  return corpus;
}

/**
 * Composition-root inputs a bin resolves for itself in production and a test
 * may override (FR-016).
 *
 * PRESENCE, NOT VALUE, SELECTS THE SOURCE: each field is read with an `in`
 * check, so passing `{ envCorpus: undefined }` explicitly means "there is no
 * `COLONY_CORPUS`" and is NOT the same as omitting the field (which reads the
 * real environment). That is what lets a test assert the no-selection failure
 * hermetically, whatever the developer's shell has exported.
 */
export interface CliEnvironment {
  /** Override the corpora root (production: `<repoRoot>/corpora`). */
  readonly corporaRoot?: string;
  /** Override the `COLONY_CORPUS` value (production: `process.env.COLONY_CORPUS`). */
  readonly envCorpus?: string;
}

/** The corpora root a bin should use: injected override, else production (FR-016). */
export function corporaRootFor(environment: CliEnvironment): string {
  return 'corporaRoot' in environment && environment.corporaRoot !== undefined
    ? environment.corporaRoot
    : resolveCorporaRoot(resolveRepoRootUpward());
}

/** The `COLONY_CORPUS` value a bin should use: injected override, else the real env. */
export function envCorpusFor(environment: CliEnvironment): string | undefined {
  return 'envCorpus' in environment ? environment.envCorpus : process.env.COLONY_CORPUS;
}
