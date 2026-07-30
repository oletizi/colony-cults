import { resolve } from 'path';
import type { ImageProviderConfig } from '@/browser/model';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { resolveCorporaRoot } from '@/cli/composition-root';
import { deriveBrowserProfile } from '@/corpus/policies';
import { selectCorpus, type SelectedCorpus } from '@/corpus/select';

/**
 * THE BROWSER / SITE-BUILD COMPOSITION ROOT (T014, specs/018-corpus-config-seam
 * FR-004, FR-005, FR-016). `site:build`/`site:preview` (`npm run`, invoked from
 * `site/src/pages/*.astro`) are a SEPARATE entrypoint from the `bib`/`translate`
 * CLIs that `@/cli/composition-root` wires (T009) — this module is their
 * counterpart, and the ONLY place a corpus is selected for a browser build.
 *
 * It reuses `@/cli/composition-root`'s `resolveCorporaRoot` and
 * `@/corpus/select`'s `selectCorpus` rather than inventing a parallel
 * mechanism — same production corpora directory (FR-016), same
 * `--corpus`-then-`COLONY_CORPUS`-then-fail-loud precedence (FR-003), minus
 * `--corpus` itself: a site build has no argv to parse, so only
 * `COLONY_CORPUS` is read (an operator/CI concern — see `netlify.toml` and
 * `site/README.md`, updated alongside this module).
 *
 * `resolveRepoRoot` — NOT `@/cli/composition-root`'s `resolveRepoRootUpward`
 * — resolves the repo root here: it is anchored on `bibliography/sources`
 * rather than `package.json`, which is what already lets every other browser
 * module (`@/browser/load/corpus`, the `.astro` pages) resolve correctly both
 * under `tsx`/vitest and from Astro's bundled `site/dist` server output.
 */

/** Default snapshot directory (relative to the repo root) when unset. */
const DEFAULT_SNAPSHOT_DIR = 'site/data';

/**
 * The configuration required to load and build the corpus.
 *
 * All values are sourced from environment variables; no defaults are baked
 * in except the snapshot directory. The operator is responsible for setting
 * the environment.
 */
export interface LoadConfig {
  /**
   * Absolute path to the private archive clone, when set. OPTIONAL: a build
   * without the archive (e.g. Netlify) reads the committed snapshot instead.
   * `loadCorpus` decides the archive-vs-snapshot precedence.
   */
  archivePath?: string;
  /**
   * Where the committed public-domain snapshot lives (one `<sourceId>.json`
   * per source). Absolute, or relative to the repo root. Defaults to
   * `site/data`.
   */
  snapshotDir: string;
  sources: string[];
  provider: ImageProviderConfig;
}

/**
 * Resolves the LoadConfig from environment variables.
 *
 * Does NOT throw merely because CORPUS_ARCHIVE_PATH is unset: a build may run
 * from the committed snapshot instead (the archive-vs-snapshot decision, and
 * the "neither available" throw, live in `loadCorpus`). Still fail-loud on a
 * genuinely invalid provider config.
 *
 * `sources` (FR-005) comes from the browser/site-build composition root
 * (module doc comment above), via {@link resolveBrowserSources}: `--corpus`
 * has no site-build equivalent, so `COLONY_CORPUS` selects the corpus, whose
 * `<corporaRoot>/<id>.browser.yml` `defaultSources` apply UNLESS
 * `CORPUS_SOURCES` is set, in which case it wins outright (FR-005).
 *
 * OPERATOR-VISIBLE CHANGE, stated rather than glossed (AUDIT-25): `COLONY_CORPUS`
 * is now REQUIRED for every site build, including one that sets
 * `CORPUS_SOURCES`. `CORPUS_SOURCES` alone no longer produces a build, because
 * {@link resolveBrowserSources} selects a corpus UNCONDITIONALLY before applying
 * the override. This is INTENDED (FR-003, no implicit default): what previously
 * made `CORPUS_SOURCES`-alone work was the hardcoded 44-id Port Breton literal
 * standing in as an implicit default corpus, and retiring that literal is the
 * point of the seam. An override still needs a corpus to be an override OF —
 * `deriveBrowserProfile` checks the ids against the selected corpus's own ID
 * policies (AUDIT-24).
 *
 * @param env - Environment variables (defaults to process.env)
 * @returns LoadConfig ready for corpus loading
 * @throws Error if no corpus is selected (`COLONY_CORPUS` is unset) — including
 *   when `CORPUS_SOURCES` IS set
 * @throws Error if the selected corpus has no browser-defaults policy (no
 *   `CORPUS_SOURCES` override and no committed `<id>.browser.yml`)
 * @throws Error if `CORPUS_SOURCES` names an id conforming to none of the
 *   selected corpus's `sourceIds` policies (AUDIT-24)
 * @throws Error if CORPUS_IMAGE_PROVIDER is set to an unknown value
 * @throws Error if CORPUS_IMAGE_PROVIDER is 'b2-cdn' but CORPUS_CDN_BASE is missing
 */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): LoadConfig {
  const archivePathRaw = env.CORPUS_ARCHIVE_PATH?.trim();
  const archivePath = archivePathRaw ? resolve(archivePathRaw) : undefined;

  const snapshotDirRaw = env.CORPUS_SNAPSHOT_DIR?.trim();
  const snapshotDir = snapshotDirRaw ? snapshotDirRaw : DEFAULT_SNAPSHOT_DIR;

  const sources = resolveBrowserSources({
    env,
    corporaRoot: resolveCorporaRoot(resolveRepoRoot()),
  });

  const providerKind = env.CORPUS_IMAGE_PROVIDER?.trim() ?? 'source-iiif';

  let provider: ImageProviderConfig;

  if (providerKind === 'source-iiif') {
    provider = { kind: 'source-iiif' };
  } else if (providerKind === 'b2-cdn') {
    const cdnBase = env.CORPUS_CDN_BASE?.trim();
    if (!cdnBase) {
      throw new Error(
        'CORPUS_IMAGE_PROVIDER is set to "b2-cdn" but CORPUS_CDN_BASE is not set. ' +
        'When using the b2-cdn provider, CORPUS_CDN_BASE must be provided (e.g. https://my-cdn.example.com).'
      );
    }
    provider = { kind: 'b2-cdn', cdnBase, imageWidth: resolveCdnImageWidth(env) };
  } else {
    throw new Error(
      `Unknown CORPUS_IMAGE_PROVIDER value: "${providerKind}". ` +
      'Expected one of: "source-iiif" (default), "b2-cdn".'
    );
  }

  return {
    archivePath,
    snapshotDir,
    sources,
    provider,
  };
}

/**
 * Select the active corpus for a browser build (T014, FR-003, FR-016): the
 * first step of the browser/site-build composition root (module doc comment
 * above). `COLONY_CORPUS` is the only selector a site build has — there is no
 * `--corpus` flag on `npm run site:build`/`site:preview` — and there is no
 * implicit Port-Breton default: an unset `COLONY_CORPUS` fails loud, exactly
 * as `selectCorpus` documents for the CLI.
 *
 * Exported (not `resolveBrowserSources`-internal only) so another
 * browser/site-build entrypoint that needs the selected corpus itself — e.g.
 * `site/src/pages/coverage/index.astro`, which binds `@/bibliography/
 * coverage/load-coverage-report`'s scope check to this same selection — can
 * reuse this ONE composition root rather than re-deriving the selection
 * inline.
 *
 * @param env - Environment variables (defaults to process.env)
 * @throws Error if `COLONY_CORPUS` is unset, or names no committed manifest
 */
export function selectBrowserCorpus(env: NodeJS.ProcessEnv = process.env): SelectedCorpus {
  const corporaRoot = resolveCorporaRoot(resolveRepoRoot());
  return selectCorpus({ corporaRoot, envCorpus: env.COLONY_CORPUS });
}

/** Inputs to {@link resolveBrowserSources}: pure data, injected by the caller. */
export interface ResolveBrowserSourcesOptions {
  /** Environment variables to read `CORPUS_SOURCES`/`COLONY_CORPUS` from. */
  readonly env: NodeJS.ProcessEnv;
  /**
   * The injected corpora root (FR-016). A production caller passes
   * `resolveCorporaRoot(resolveRepoRoot())` (as {@link resolveConfig} does);
   * a test injects a fixture directory directly, without a process.env
   * round-trip.
   */
  readonly corporaRoot: string;
}

/**
 * Resolve the browser build's default source ids (FR-005, FR-014): select
 * the corpus, then derive its `BrowserDefaultsPolicy`
 * (`@/corpus/policies`' `deriveBrowserProfile`).
 *
 * `CORPUS_SOURCES` is read and split HERE, at the composition root — a
 * comma-separated-string CLI/env-input concern, not something a policy
 * derivation should own (see `deriveBrowserProfile`'s own doc comment) — and
 * handed down as the already-parsed `envOverride`, which wins outright over
 * the corpus's committed `defaultSources` when supplied (FR-005).
 *
 * SELECTION IS UNCONDITIONAL, AND THAT IS A DELIBERATE BEHAVIOR CHANGE
 * (AUDIT-25). `selectCorpus` runs on the line below whether or not
 * `CORPUS_SOURCES` is set, so an unset `COLONY_CORPUS` fails loud even for an
 * override-only build. Before this seam, `CORPUS_SOURCES` alone DID produce a
 * build — but only because the retired hardcoded 44-id Port Breton literal was
 * acting as an implicit default corpus, which is exactly what FR-003 forbids.
 * The ordering is therefore load-bearing, not incidental: the override's ids are
 * checked against the selected corpus's ID policies (AUDIT-24), which requires
 * knowing the corpus first.
 *
 * ABSENCE IS FATAL HERE (unlike most of the codebase, FR-005): a site build
 * IS a browser-default-CONSUMING path — its only job is producing default
 * sources — so `deriveBrowserProfile` returning `null` (no override, no
 * committed `<id>.browser.yml`) is this function's OWN "no defaults
 * configured" failure, thrown loud rather than swallowed. Every OTHER
 * command in the codebase must keep tolerating profile absence
 * (`tryLoadBrowserProfile`'s documented contract) — this function is the one
 * place that is exempt, because unlike them it has no other job to fall back
 * to.
 */
export function resolveBrowserSources(options: ResolveBrowserSourcesOptions): string[] {
  const { env, corporaRoot } = options;

  const sourcesRaw = env.CORPUS_SOURCES?.trim();
  const envOverride =
    sourcesRaw === undefined || sourcesRaw.length === 0
      ? undefined
      : sourcesRaw.split(',').map((s) => s.trim());

  const selected = selectCorpus({ corporaRoot, envCorpus: env.COLONY_CORPUS });
  const policy = deriveBrowserProfile(selected, envOverride);

  if (policy === null) {
    throw new Error(
      `resolveBrowserSources: no browser-defaults policy for corpus ${JSON.stringify(selected.manifest.id)} -- ` +
        `no CORPUS_SOURCES override, and no ${selected.manifest.id}.browser.yml under ${corporaRoot}. ` +
        'The site build is a browser-default-consuming path (FR-005) and requires one of the two.',
    );
  }

  return [...policy.defaultSources];
}

/**
 * Default b2-cdn reading width (px) when CORPUS_CDN_IMAGE_WIDTH is unset.
 *
 * 2000 chosen from measured CDN behavior: the heavy ~2 MB newspaper masters
 * (~3000-3900px) roughly halve (to ~0.9-1.2 MB) while staying legible, and
 * every smaller page in the corpus (down to ~14 KB monographs) is served at or
 * below its master size -- at this width cf.image scale-down never re-encodes a
 * page LARGER than its master (a smaller width like 1200 can inflate the tiny
 * scans; 2400 inflated a mid-size page). Tune via CORPUS_CDN_IMAGE_WIDTH.
 */
const DEFAULT_CDN_IMAGE_WIDTH = 2000;

/**
 * Resolves the b2-cdn reading width from `CORPUS_CDN_IMAGE_WIDTH`:
 * a positive integer sets `?w=<n>` (CDN resize); `0` / `"full"` disables it
 * (serve the full master); unset defaults to {@link DEFAULT_CDN_IMAGE_WIDTH}.
 *
 * @throws Error if the value is present but not a non-negative integer / "full".
 */
function resolveCdnImageWidth(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.CORPUS_CDN_IMAGE_WIDTH?.trim();
  if (raw === undefined) {
    return DEFAULT_CDN_IMAGE_WIDTH;
  }
  if (raw === '' || raw === '0' || raw.toLowerCase() === 'full') {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== raw) {
    throw new Error(
      `CORPUS_CDN_IMAGE_WIDTH must be a positive integer, 0, or "full"; got ${JSON.stringify(raw)}.`
    );
  }
  return n;
}
