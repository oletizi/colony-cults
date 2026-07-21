/**
 * Capture persistence for the Source Query Client (Phase 1, T008).
 *
 * Every fetched page is persisted as TWO artifacts under
 * `bibliography/repository-responses/<source>/`: the raw HTML
 * (`<slug>-<UTC>.html`) and an accessibility-snapshot markdown rendering
 * (`<slug>-<UTC>.md`). A detected block is persisted the same way under a
 * fixed `block-<UTC>` name (data-model.md § PersistedCapture / BlockEvidence,
 * research.md R5/R8).
 *
 * Fail-loud (Principle V): a write failure throws rather than returning a
 * partial capture. `capturedAtUtc` is always caller-supplied (never
 * `Date.now()`/`new Date()` here) so the module stays deterministic and
 * testable.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlockEvidence, BlockEvidenceKind, PersistedCapture } from '@/sourcequery/types';

/** Subpath under the base dir that all source-query captures live under. */
const REPOSITORY_RESPONSES_SUBDIR = ['bibliography', 'repository-responses'];

/** The fixed slug used for block-evidence captures (`block-<UTC>.{html,md}`). */
const BLOCK_EVIDENCE_SLUG = 'block';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turn a source id + query into a filesystem-safe slug: lowercased,
 * non-alphanumeric runs collapsed to a single `-`, leading/trailing `-`
 * trimmed. Throws if the result would be empty (e.g. both inputs are purely
 * punctuation/whitespace) rather than silently producing an unusable name.
 */
export function slugify(source: string, query: string): string {
  const slug = `${source}-${query}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) {
    throw new Error(
      `slugify: source "${source}" + query "${query}" produces an empty filesystem slug`,
    );
  }
  return slug;
}

/** Sanitize an ISO UTC timestamp for use inside a filename (no `:`, `.`, etc.). */
function sanitizeUtcForFilename(capturedAtUtc: string): string {
  const sanitized = capturedAtUtc
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (sanitized.length === 0) {
    throw new Error(
      `capturePaths: capturedAtUtc "${capturedAtUtc}" produces an empty filename component`,
    );
  }
  return sanitized;
}

/** The two on-disk paths a capture (or block-evidence capture) writes to. */
export interface CapturePaths {
  /** `bibliography/repository-responses/<source>/<slug>-<UTC>.html` */
  htmlPath: string;
  /** `bibliography/repository-responses/<source>/<slug>-<UTC>.md` */
  snapshotPath: string;
}

/**
 * Build the (not-yet-written) HTML + markdown-snapshot paths for a capture,
 * rooted at `baseDir` (default `process.cwd()` — the repo root when the
 * client runs normally; tests may pass a temp dir so no real filesystem
 * state is touched).
 */
export function capturePaths(
  source: string,
  slug: string,
  capturedAtUtc: string,
  baseDir: string = process.cwd(),
): CapturePaths {
  const stamp = sanitizeUtcForFilename(capturedAtUtc);
  const dir = path.join(baseDir, ...REPOSITORY_RESPONSES_SUBDIR, source);
  const base = `${slug}-${stamp}`;
  return {
    htmlPath: path.join(dir, `${base}.html`),
    snapshotPath: path.join(dir, `${base}.md`),
  };
}

/**
 * Write one capture file, creating its parent directory first. Throws a
 * descriptive error (fail-loud, Principle V) on any failure — a missing
 * parent that cannot be created, a permission error, a full disk, etc.
 */
async function writeCaptureFile(filePath: string, contents: string): Promise<void> {
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, 'utf-8');
  } catch (error) {
    throw new Error(
      `persistence: failed to write capture file ${filePath}: ${describeError(error)}`,
    );
  }
}

/**
 * Derive the repo-relative capture path (starting `bibliography/repository-responses/...`,
 * forward-slash separated) from an absolute or base-dir-rooted capture htmlPath —
 * i.e. the `path` a `MetadataSnapshotRef` records. Works whether the capture was
 * written under a temp `baseDir` (tests) or `process.cwd()` (prod), by slicing at
 * the `bibliography/repository-responses` marker. Throws (fail-loud) if the path
 * is not under that tree rather than returning an unusable reference.
 */
export function repoRelativeCapturePath(htmlPath: string): string {
  const marker = path.join(...REPOSITORY_RESPONSES_SUBDIR);
  const idx = htmlPath.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `repoRelativeCapturePath: "${htmlPath}" is not under "${marker}" ` +
        '(cannot derive a repo-relative snapshot reference).',
    );
  }
  return htmlPath.slice(idx).split(path.sep).join('/');
}

/** Input to {@link persistCapture}. */
export interface PersistCaptureArgs {
  /** Source id (also the `repository-responses/<source>/` dir name). */
  source: string;
  /** The query string that produced this page (slugified into the filename). */
  query: string;
  /** The queried URL. */
  url: string;
  /** Raw `page.content()` HTML. */
  html: string;
  /** `page.accessibility.snapshot()` rendered to markdown. */
  snapshotMarkdown: string;
  /** ISO UTC timestamp, injected by the caller (never generated here). */
  capturedAtUtc: string;
  /** Base dir the `bibliography/...` tree is rooted at (default `process.cwd()`). */
  baseDir?: string;
}

/**
 * Persist a query-page capture: writes BOTH the raw HTML and the
 * accessibility-snapshot markdown (creating the source dir as needed), then
 * returns the {@link PersistedCapture}. Writes happen before any parsing
 * (research.md R5) — a failure on EITHER write throws; a partial capture is
 * never returned (Principle V).
 */
export async function persistCapture(args: PersistCaptureArgs): Promise<PersistedCapture> {
  const { source, query, url, html, snapshotMarkdown, capturedAtUtc, baseDir } = args;
  const slug = slugify(source, query);
  const { htmlPath, snapshotPath } = capturePaths(source, slug, capturedAtUtc, baseDir);

  await writeCaptureFile(htmlPath, html);
  await writeCaptureFile(snapshotPath, snapshotMarkdown);

  return { htmlPath, snapshotPath, url, capturedAtUtc };
}

/** Input to {@link persistBlockEvidence}. */
export interface PersistBlockEvidenceArgs {
  /** Source id (also the `repository-responses/<source>/` dir name). */
  source: string;
  /** Kind of blocking signal detected (research.md R1). */
  kind: BlockEvidenceKind;
  /** Human-readable detail of what was detected (status code, fingerprint match, etc.). */
  detail: string;
  /** Raw HTML of the challenge/block page. */
  html: string;
  /** Accessibility snapshot of the challenge/block page, rendered to markdown. */
  snapshotMarkdown: string;
  /** ISO UTC timestamp, injected by the caller (never generated here). */
  capturedAtUtc: string;
  /** Base dir the `bibliography/...` tree is rooted at (default `process.cwd()`). */
  baseDir?: string;
}

/**
 * Persist proof of a detected hard block as `block-<UTC>.{html,md}` under the
 * source's capture dir (research.md R8) and return the {@link BlockEvidence},
 * with `evidencePath` pointing at the persisted HTML. The escalation
 * (`OperatorPermissionRequest`) must never be raised without this having
 * succeeded — a write failure throws (Principle V).
 */
export async function persistBlockEvidence(
  args: PersistBlockEvidenceArgs,
): Promise<BlockEvidence> {
  const { source, kind, detail, html, snapshotMarkdown, capturedAtUtc, baseDir } = args;
  const { htmlPath, snapshotPath } = capturePaths(
    source,
    BLOCK_EVIDENCE_SLUG,
    capturedAtUtc,
    baseDir,
  );

  await writeCaptureFile(htmlPath, html);
  await writeCaptureFile(snapshotPath, snapshotMarkdown);

  return { kind, detail, evidencePath: htmlPath, capturedAtUtc };
}
