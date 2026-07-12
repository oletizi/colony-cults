/**
 * scripts/publish-pdf.ts
 *
 * The `pdf:publish` CLI (T021, spec 008-edition-publishing,
 * contracts/cli.md): publish already-built facsimile PDFs
 * (`build/pdf/<sourceId>/<issueId>.pdf`, written by `pdf:build`) to the
 * object store, recording the result in the bibliography SSOT. Sibling to
 * `pdf:build` / `site:export-public` in `package.json`. This verb is a thin
 * driver: it parses argv, preflights fail-loud preconditions, wires the real
 * (network/disk/git) collaborators, and delegates all sequencing to
 * `publish()` (`src/pdf/publish/publish.ts`).
 *
 *   npm run pdf:publish -- <sourceId> --variant <english-only|parallel>              # dry-run
 *   npm run pdf:publish -- <sourceId> --variant <english-only|parallel> --confirm    # mutates
 *
 * Flags:
 *   --variant <english-only|parallel>   REQUIRED -- which built variant to publish
 *                                        (not inferable from the built path; FR-012).
 *   --confirm                           deliberate-action gate (mirrors
 *                                        `site:export-public`'s `--confirm`). Absent
 *                                        -> dry-run: plans keys/URLs, uploads/records
 *                                        nothing.
 *   --out <dir>                         built-PDF root (default `build/pdf`).
 *   --no-warm                           skip the best-effort CDN warm (FR-015).
 *
 * NOT implemented here: `--reconcile` (T032, FR-013's back-fill mode) --
 * deliberately left out so `parseArgs` stays a straightforward flag surface
 * to extend, per T021's scope.
 *
 * Fail-loud preflight (before any upload/record work, contracts/cli.md
 * "Environment"):
 *  - `COLONY_S3_BUCKET` / `COLONY_S3_ENDPOINT` / `COLONY_S3_REGION` + the B2
 *    credentials file -> `resolveObjectStoreConfig()`, with the real
 *    `S3ObjectStore` constructed eagerly (mirrors `src/cli/fetch-shared.ts`'s
 *    `defaultFetchDeps`), so a missing credential fails loud before any work.
 *  - `CORPUS_CDN_BASE` -> `resolveCdnBase()`; unset fails loud.
 *  - The archive pin (`site/data/archive-source.json` `.ref`) ->
 *    `resolveSnapshot()`; missing/malformed fails loud. Its `short` token also
 *    seeds the commit message (FR-008), so this preflight call is reused
 *    rather than re-derived.
 *
 * The FR-008 commit hook (only wired when `--confirm` is given): stages the
 * SSOT + manifest directories (`bibliography/sources`,
 * `bibliography/publications`) and commits them with a message naming the
 * source, variant, and snapshot. The core (`publish()`) never runs git
 * itself -- this verb is the one place that does, mirroring
 * `src/cli/archive-checkpoint.ts`'s "one place invokes git" posture. Fires
 * only after `publish()` has written records (confirm mode, and only when at
 * least one issue succeeded -- see `publish.ts`'s `recordAndCommit`).
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { resolveObjectStoreConfig } from '@/archive/b2-config';
import { defaultHttpGet } from '@/archive/public-cache';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { resolveRepoRoot } from '@/browser/load/repo-root';
import { publish, type PublishOptions } from '@/pdf/publish/publish';
import { resolveCdnBase, type PublicationVariant } from '@/pdf/publish/key';
import type { Clock } from '@/pdf/publish/record';
import { resolveSnapshot, type SnapshotVersion } from '@/pdf/publish/version';

/** Parsed CLI invocation. */
interface CliArgs {
  /** The positional source id, e.g. `PB-P001`. */
  sourceId: string;
  /** Which built variant to publish (FR-012, required -- not inferable). */
  variant: PublicationVariant;
  /** `--confirm` deliberate-action gate. Absent => dry-run. */
  confirm: boolean;
  /** `--out` dir, or `undefined` (fall back to `publish()`'s config default). */
  out: string | undefined;
  /** `false` when `--no-warm` is given; `true` otherwise (the default). */
  warm: boolean;
}

/** Parse `process.argv.slice(2)`. Fails loud on an unknown flag, a missing/bad `--variant`, or extra args. */
function parseArgs(argv: string[]): CliArgs {
  let sourceId: string | undefined;
  let variant: PublicationVariant | undefined;
  let confirm = false;
  let out: string | undefined;
  let warm = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--variant') {
      const value = argv[i + 1];
      i += 1;
      if (value !== 'english-only' && value !== 'parallel') {
        throw new Error(
          `pdf:publish: --variant expects "english-only" or "parallel", got ` +
            `${JSON.stringify(value ?? '(missing)')}.`,
        );
      }
      variant = value;
    } else if (arg === '--confirm') {
      confirm = true;
    } else if (arg === '--no-warm') {
      warm = false;
    } else if (arg === '--out') {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined || value.trim().length === 0) {
        throw new Error('pdf:publish: --out expects a directory path.');
      }
      out = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`pdf:publish: unknown flag ${JSON.stringify(arg)}.`);
    } else if (sourceId === undefined) {
      sourceId = arg;
    } else {
      throw new Error(
        `pdf:publish: unexpected extra argument ${JSON.stringify(arg)} (already have sourceId ` +
          `${JSON.stringify(sourceId)}).`,
      );
    }
  }

  if (sourceId === undefined) {
    throw new Error(
      'pdf:publish: no sourceId given. Pass "<sourceId>" (e.g. PB-P001) plus ' +
        '"--variant <english-only|parallel>".',
    );
  }
  if (variant === undefined) {
    throw new Error(
      'pdf:publish: --variant is required (expected "english-only" or "parallel") -- the ' +
        'variant is not inferable from the built path (FR-012).',
    );
  }

  return { sourceId, variant, confirm, out, warm };
}

/** Everything the fail-loud preflight resolves, reused by the run itself. */
interface Preflight {
  store: S3ObjectStore;
  cdnBase: string;
  snapshot: SnapshotVersion;
}

/**
 * Fail-loud preflight (before any upload/record work): construct the real
 * object store eagerly (a missing credential/env var throws here, mirroring
 * `src/cli/fetch-shared.ts`'s `defaultFetchDeps`), resolve the CDN base, and
 * resolve the archive pin. All three throw a descriptive Error on failure --
 * none of them have a fallback.
 */
function preflight(): Preflight {
  const objectStoreConfig = resolveObjectStoreConfig();
  const store = new S3ObjectStore(objectStoreConfig);
  const cdnBase = resolveCdnBase();
  const snapshot = resolveSnapshot();
  return { store, cdnBase, snapshot };
}

/**
 * Build the FR-008 commit hook: stage the SSOT + manifest directories and
 * commit them with a message naming the source, variant, and snapshot. Mimics
 * `src/cli/archive-checkpoint.ts`'s idempotent-commit idiom -- after staging,
 * probe `git diff --cached --quiet` and treat a clean result (nothing staged)
 * as a no-op rather than invoking `git commit` (which would fail on an empty
 * commit). Never passes `--no-verify`: a failing hook is a real failure.
 */
function buildCommitHook(
  repoRoot: string,
  sourceId: string,
  variant: PublicationVariant,
  snapshotShort: string,
): () => void {
  return () => {
    execFileSync(
      'git',
      ['add', '-A', '--', 'bibliography/sources', 'bibliography/publications'],
      { cwd: repoRoot, stdio: 'inherit' },
    );

    let hasStagedChanges: boolean;
    try {
      execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot, stdio: 'ignore' });
      // Exit 0 => nothing staged relative to HEAD: a clean no-op, not an
      // error and not an empty commit.
      hasStagedChanges = false;
    } catch {
      // A non-zero exit means there IS a staged diff.
      hasStagedChanges = true;
    }
    if (!hasStagedChanges) {
      return;
    }

    const message = `publish(edition-publishing): ${sourceId} ${variant} @ ${snapshotShort}`;
    execFileSync('git', ['commit', '-m', message], { cwd: repoRoot, stdio: 'inherit' });
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();

  // Fail-loud preflight, before any upload/record work.
  const { store, cdnBase, snapshot } = preflight();

  const sourcesDir = path.join(repoRoot, 'bibliography', 'sources');
  const publicationsDir = path.join(repoRoot, 'bibliography', 'publications');

  const outLabel = args.out ?? 'build/pdf (config default)';
  process.stdout.write(
    `pdf:publish -- source ${args.sourceId}  variant ${args.variant}  ` +
      `(${args.confirm ? 'confirmed' : 'DRY RUN'})\n` +
      `  cdn base: ${cdnBase}\n` +
      `  snapshot: ${snapshot.short} (pinned ${snapshot.full})\n` +
      `  out root: ${outLabel}\n` +
      `  warm:     ${args.warm ? 'on' : 'off (--no-warm)'}\n\n`,
  );

  const clock: Clock = () => new Date();

  const opts: PublishOptions = {
    sourceId: args.sourceId,
    variant: args.variant,
    confirm: args.confirm,
    outDir: args.out,
    sourcesDir,
    publicationsDir,
    store,
    clock,
    httpGet: defaultHttpGet,
    warm: args.warm,
    cdnBase,
    ...(args.confirm
      ? { commit: buildCommitHook(repoRoot, args.sourceId, args.variant, snapshot.short) }
      : {}),
  };

  const result = await publish(opts);

  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
