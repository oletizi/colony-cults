/**
 * Assemble + persist a {@link Publication} entry and its per-issue
 * {@link PublicationManifest} file (spec 008, T018).
 *
 * Pure composition over injected inputs (a clock and target directories), so
 * the whole assemble/write/upsert flow is unit-testable against temp dirs and a
 * fake clock -- no ambient `Date.now()`, no hard-coded repo paths.
 *
 * The four steps mirror the data-model's write path:
 *   1. {@link buildManifest}      upload results -> a validated PublicationManifest
 *   2. {@link writeManifestFile}  deterministic manifest YAML under bibliography/publications/
 *   3. {@link buildPublication}   the lean Publication entry (with a mandatory
 *                                 provenance disclosure -- machineAssist (French)
 *                                 or ocrTranscription (English, spec 015) --
 *                                 enforced, Constitution IV)
 *   4. {@link upsertPublication}  idempotent add to Source.publications[] + re-write
 *
 * See specs/008-edition-publishing/data-model.md §2/§3 and
 * contracts/ssot-publications.md (sha256 64-hex, url === cdnBase + '/' + key,
 * issueCount === issues.length, deterministic emission sorted by issueId).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';

import { writeSourceFile } from '@/bibliography/source-writer';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import { cdnUrl, type PublicationVariant } from '@/pdf/publish/key';
import type { MachineAssistLabel, OcrTranscription } from '@/pdf/model';
import type {
  Publication,
  PublicationManifest,
  PublishedArtifactRef,
} from '@/model/publication';
import type { Source } from '@/model/source';

/** Repo-relative directory the manifest files live under (contract §3). */
const PUBLICATIONS_DIR_REL = 'bibliography/publications';

/** A 64-char lowercase-hex sha256, the archive's checksum invariant. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Injected clock: returns "now" so {@link buildPublication}'s `publishedAt` is
 * deterministic in tests. Defaults to `() => new Date()` in production callers.
 */
export type Clock = () => Date;

/**
 * One issue's upload result -- the input to {@link buildManifest}. Matches the
 * per-issue data the upload step produces: the object-store `key`, the canonical
 * `url`, the content `sha256`, and the `pages` count (read from the build's
 * `<issueId>.input.json`, NOT parsed from PDF bytes -- data-model §3).
 */
export interface IssueUploadResult {
  /** The built item id (`build/pdf/<sourceId>/<issueId>.pdf`). */
  issueId: string;
  /** The object-store key (versioned or legacy-flat). */
  key: string;
  /** The canonical public CDN URL; MUST equal `cdnBase + '/' + key`. */
  url: string;
  /** Lowercase-hex sha256 (64 chars) of the published PDF bytes. */
  sha256: string;
  /** The built PDF's page count. */
  pages: number;
}

/** Input to {@link buildManifest}: the source/variant context + upload results. */
export interface BuildManifestInput {
  sourceId: string;
  variant: PublicationVariant;
  /** Full ref; omit (or `legacy`) for the reconciled flat set. */
  snapshot?: string;
  /** The canonical CDN base, used to verify each issue's `url`. */
  cdnBase: string;
  issues: IssueUploadResult[];
}

/**
 * Build a {@link PublicationManifest} from per-issue upload results, issues
 * SORTED by `issueId` for deterministic emission. Validates each `sha256` is
 * 64 lowercase hex and each `url === cdnBase + '/' + key` (throws on violation --
 * the URL is derived, never free-typed).
 */
export function buildManifest(input: BuildManifestInput): PublicationManifest {
  const issues: PublishedArtifactRef[] = [...input.issues]
    .map((issue) => toArtifactRef(issue, input.cdnBase))
    .sort(byIssueId);

  const manifest: PublicationManifest = {
    sourceId: input.sourceId,
    variant: input.variant,
    issues,
  };
  if (input.snapshot !== undefined) {
    manifest.snapshot = input.snapshot;
  }
  return manifest;
}

/** Validate one upload result and project it to a {@link PublishedArtifactRef}. */
function toArtifactRef(
  issue: IssueUploadResult,
  cdnBase: string,
): PublishedArtifactRef {
  if (!SHA256_PATTERN.test(issue.sha256)) {
    throw new Error(
      `buildManifest: issue "${issue.issueId}" has sha256 "${issue.sha256}" ` +
        `which is not 64 lowercase hex chars (contract §3 invariant).`,
    );
  }
  const expectedUrl = cdnUrl(cdnBase, issue.key);
  if (issue.url !== expectedUrl) {
    throw new Error(
      `buildManifest: issue "${issue.issueId}" url "${issue.url}" does not equal ` +
        `cdnBase + '/' + key ("${expectedUrl}"); the URL is derived, never free-typed.`,
    );
  }
  return {
    issueId: issue.issueId,
    url: issue.url,
    key: issue.key,
    sha256: issue.sha256,
    pages: issue.pages,
  };
}

function byIssueId(a: PublishedArtifactRef, b: PublishedArtifactRef): number {
  if (a.issueId < b.issueId) {
    return -1;
  }
  return a.issueId > b.issueId ? 1 : 0;
}

/**
 * Serialize `manifest` deterministically (fixed key order, issues sorted by
 * `issueId`) to `<publicationsDir>/<sourceId>-<variant>-<version>.yml`, where
 * `version` is the `snapshotShort` (versioned scheme) or the literal `legacy`
 * (reconciled flat set). Re-writing identical input is byte-identical
 * (idempotent, SC-004). Returns the REPO-RELATIVE path recorded on the
 * publication entry (`bibliography/publications/<file>`), while writing the
 * bytes to the given physical `publicationsDir`.
 */
export function writeManifestFile(
  publicationsDir: string,
  manifest: PublicationManifest,
  version: string,
): string {
  const fileName = `${manifest.sourceId}-${manifest.variant}-${version}.yml`;
  mkdirSync(publicationsDir, { recursive: true });
  writeFileSync(path.join(publicationsDir, fileName), serializeManifest(manifest), 'utf-8');
  return `${PUBLICATIONS_DIR_REL}/${fileName}`;
}

/**
 * Deterministic manifest YAML: fixed top-level key order
 * (`sourceId, variant, snapshot?, issues`), each issue in fixed field order
 * (`issueId, key, url, sha256, pages`), issues sorted by `issueId`. Mirrors
 * `serializeSource`'s `stringify(obj, { lineWidth: 0 })` posture.
 */
function serializeManifest(manifest: PublicationManifest): string {
  const out: Record<string, unknown> = {
    sourceId: manifest.sourceId,
    variant: manifest.variant,
  };
  if (manifest.snapshot !== undefined) {
    out.snapshot = manifest.snapshot;
  }
  out.issues = [...manifest.issues].sort(byIssueId).map((issue) => ({
    issueId: issue.issueId,
    key: issue.key,
    url: issue.url,
    sha256: issue.sha256,
    pages: issue.pages,
  }));
  return stringify(out, { lineWidth: 0 });
}

/** Input to {@link buildPublication}: everything but the injected `publishedAt`. */
export interface BuildPublicationInput {
  variant: PublicationVariant;
  snapshot: string;
  snapshotShort: string;
  cdnBase: string;
  keyScheme: Publication['keyScheme'];
  rightsBasis: string;
  /**
   * The French-source machine-assisted translation label. Modeled optional:
   * exactly one of `machineAssist` / `ocrTranscription` is present for a real
   * built issue (spec 015's `ColophonMeta`) -- `buildPublication` throws if
   * BOTH are absent (Constitution IV), but does NOT require `machineAssist`
   * specifically once `ocrTranscription` is present (English-source, spec
   * 015 FR-008/FR-013).
   */
  machineAssist?: MachineAssistLabel;
  /**
   * The English-source OCR-transcription disclosure, recorded INSTEAD OF
   * `machineAssist` for an English-source edition (spec 015 FR-008/FR-013).
   * See `machineAssist`'s doc for the presence invariant.
   */
  ocrTranscription?: OcrTranscription;
  /** Repo-relative manifest path (from {@link writeManifestFile}). */
  manifestPath: string;
  /** Published-issue count (`manifest.issues.length`). */
  issueCount: number;
}

/**
 * Assemble the lean {@link Publication} entry. `publishedAt` comes from the
 * injected `clock` (ISO date, `YYYY-MM-DD`). Throws if BOTH `machineAssist`
 * and `ocrTranscription` are absent (Constitution IV: every publication must
 * disclose either a machine-assisted translation label (French) or an
 * OCR-transcription disclosure (English) -- never neither). The distinguishing
 * signal is the disclosure SHAPE the caller collected from the built issues'
 * `input.json` colophon (`@/pdf/publish/issue`), not the `variant` -- the
 * `english-only` variant is ambiguous between a French source (EN
 * translation) and an English source (EN OCR), so `variant` alone cannot
 * decide this (AUDIT-20260719-02).
 */
export function buildPublication(input: BuildPublicationInput, clock: Clock): Publication {
  if (input.machineAssist === undefined && input.ocrTranscription === undefined) {
    throw new Error(
      `buildPublication: variant "${input.variant}" has no machineAssist label ` +
        `and no ocrTranscription disclosure. Constitution IV requires every ` +
        `publication to disclose either a machine-assisted translation label ` +
        `(French) or an OCR-transcription disclosure (English); refusing to ` +
        `record a publication with no provenance disclosure at all.`,
    );
  }

  const publication: Publication = {
    variant: input.variant,
    publishedAt: isoDate(clock()),
    snapshot: input.snapshot,
    snapshotShort: input.snapshotShort,
    cdnBase: input.cdnBase,
    keyScheme: input.keyScheme,
    rightsBasis: input.rightsBasis,
    manifest: {
      manifestPath: input.manifestPath,
      issueCount: input.issueCount,
    },
  };
  if (input.machineAssist !== undefined) {
    publication.machineAssist = input.machineAssist;
  }
  if (input.ocrTranscription !== undefined) {
    publication.ocrTranscription = input.ocrTranscription;
  }
  return publication;
}

/** Format a `Date` as an ISO date (`YYYY-MM-DD`), matching the SSOT date fields. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Idempotently add `publication` to `source.publications[]`, identified by
 * `(variant, snapshotShort)`: replace an existing entry in place (never a
 * duplicate), else append. Then re-write the source via {@link writeSourceFile}.
 * Returns whether the publications set changed (a byte-identical re-upsert of an
 * existing entry returns `false`).
 */
export function upsertPublication(
  sourcesDir: string,
  source: Source,
  records: AuthoredRepositoryRecord[],
  publication: Publication,
): boolean {
  const existing = source.publications ?? [];
  const index = existing.findIndex(
    (p) => p.variant === publication.variant && p.snapshotShort === publication.snapshotShort,
  );

  let changed: boolean;
  const next = [...existing];
  if (index === -1) {
    next.push(publication);
    changed = true;
  } else {
    changed = !samePublication(existing[index], publication);
    next[index] = publication;
  }
  source.publications = next;

  mkdirSync(sourcesDir, { recursive: true });
  writeSourceFile(sourcesDir, { source, records });
  return changed;
}

/** Structural equality of two publication entries (for change detection). */
function samePublication(a: Publication, b: Publication): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
