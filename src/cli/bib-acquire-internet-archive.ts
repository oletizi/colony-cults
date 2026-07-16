/**
 * Internet Archive adapter wiring for `bib acquire` (T027), extracted from
 * `@/cli/bib-sourcegroup` to keep that file under the project's size
 * guideline -- mirrors `@/cli/bib-acquire-museum`'s
 * `buildMuseumAdapterForMember` almost exactly, substituting the IA
 * toolchain (poppler, staging root, quality gate) for the museum's
 * (codex extractor, object store).
 *
 * `buildInternetArchiveAdapterForMember` builds the {@link
 * InternetArchiveAdapter} ONLY when the member's SELECTED copy is an
 * `ia-item` record, so an `ark`/`accession` acquire never pays the IA
 * toolchain's cost (poppler process spawns, B2 credential resolution,
 * archive-root resolution) -- same rationale as the museum builder's own doc
 * comment.
 *
 * This module also defines the CLI's flag-driven {@link QualityGate}
 * ({@link makeCliQualityGate}), implementing the operator-chosen two-phase
 * flow (FR-008 / IA-INV-C):
 *
 *   - **Phase 1** -- `bib acquire <id> --dry-run` (no `--approved-range`):
 *     the gate reports `sound` with `approvedLeafRange` defaulted to the
 *     scandata-seeded `proposedRange`, so the dry run stages + extracts
 *     exactly that proposed range to RETAINED staging (no B2 write) for the
 *     operator to examine.
 *   - **Phase 2** -- `bib acquire <id> --approved-range <start-end>`: the
 *     gate reports `sound` with the operator's own range, reusing staging
 *     and uploading.
 *   - **Either phase** -- `--reject` overrides both: the gate reports
 *     `unsound`, so `enforceQualityGate` halts fail-closed (zero B2 writes,
 *     staging retained) regardless of any `--approved-range`.
 */

import { loadAllSources } from '@/bibliography/load';
import { selectRepositoryRecord } from '@/sourcegroup/record-select';
import { HttpClient } from '@/gallica/http-client';
import { InternetArchiveAdapter } from '@/repository/internet-archive/adapter';
import { PopplerRunnerImpl } from '@/pdf/poppler/runner';
import { execCommand } from '@/ocr/exec';
import { S3ObjectStore } from '@/archive/s3-object-store';
import { resolveObjectStoreConfig } from '@/archive/b2-config';
import { resolveArchiveRoot } from '@/archive/location';
import { resolveRepoRoot } from '@/cli/bib-sourcegroup-paths';
import type { RepositoryAdapter } from '@/repository/adapter';
import type { RepositoryRecord } from '@/model/repository-record';
import type { LeafRange, QualityAssessment } from '@/model/quality-assessment';
import type {
  QualityGate,
  QualityGateInput,
} from '@/repository/internet-archive/quality-gate';

/**
 * Operator-supplied answer, threaded from `bib acquire`'s
 * `--approved-range`/`--reject`/`--notes` flags into {@link
 * makeCliQualityGate}. `now` is the injected clock -- the same one the
 * `InternetArchiveAdapter` itself is constructed with, so a `QualityAssessment`
 * and the adapter's own snapshot timestamps come from a single clock.
 */
export interface CliQualityGateOptions {
  /** `--approved-range <start-end>`, when the operator supplied one. */
  approvedRange?: LeafRange;
  /** `--reject`: force an `unsound` assessment regardless of any range. */
  reject?: boolean;
  /** `--notes <text>`: free-text operator notes recorded on the assessment. */
  notes?: string;
  /** Clock for `QualityAssessment.assessedAt`. */
  now: () => string;
}

/**
 * Build the CLI's flag-driven {@link QualityGate} (FR-008 / IA-INV-C). Never
 * itself judges the staged file's quality from bytes -- it only packages
 * whatever the operator supplied on the CLI into a durable
 * {@link QualityAssessment}:
 *
 * - `opts.reject` -> `status: 'unsound'`. `approvedLeafRange` still carries
 *   `input.proposedRange` (a leaf range is a required field on every
 *   assessment, sound or not) but is never acted on --
 *   `enforceQualityGate` halts on `status` alone.
 * - otherwise -> `status: 'sound'`, `approvedLeafRange` = `opts.approvedRange`
 *   when given (phase 2), else `input.proposedRange` (phase 1: the dry-run
 *   extracts exactly the scandata-seeded proposal for the operator to
 *   examine).
 */
export function makeCliQualityGate(opts: CliQualityGateOptions): QualityGate {
  return {
    async assess(input: QualityGateInput): Promise<QualityAssessment> {
      if (opts.reject === true) {
        return {
          status: 'unsound',
          assessedBy: 'operator',
          assessedAt: opts.now(),
          sourceFileChecksum: input.sourceFileChecksum,
          expectedPageCount: input.expectedPageCount,
          observedPageCount: input.observedPageCount,
          approvedLeafRange: input.proposedRange,
          notes: opts.notes,
        };
      }
      return {
        status: 'sound',
        assessedBy: 'operator',
        assessedAt: opts.now(),
        sourceFileChecksum: input.sourceFileChecksum,
        expectedPageCount: input.expectedPageCount,
        observedPageCount: input.observedPageCount,
        approvedLeafRange: opts.approvedRange ?? input.proposedRange,
        notes: opts.notes,
      };
    },
  };
}

/** The `--approved-range`/`--reject`/`--notes` flags, minus the clock (the builder supplies its own). */
export type AcquireGateOptions = Omit<CliQualityGateOptions, 'now'>;

/**
 * Build the Internet Archive adapter for `bib acquire` ONLY when the
 * member's SELECTED copy is an `ia-item` record, so an `ark`/`accession`
 * acquire never requires the poppler toolchain, an archive root
 * (`COLONY_ARCHIVE_ROOT`), or B2 credentials -- all of which ONLY the IA
 * path uses. The registry dispatch in `runAcquire` (`selectForRecord`) stays
 * the source of truth; this peek merely decides which heavy deps to
 * construct here.
 *
 * Resilient by design, mirroring `buildMuseumAdapterForMember`: any failure
 * to load/select the member's record yields `undefined` (no IA adapter),
 * leaving `runAcquire` to surface the real selection/precondition error with
 * its own message rather than this peek double-reporting it.
 */
export async function buildInternetArchiveAdapterForMember(
  sourcesDir: string,
  id: string,
  archive: string | undefined,
  gateOptions?: AcquireGateOptions,
): Promise<RepositoryAdapter | undefined> {
  let record: RepositoryRecord;
  try {
    const loaded = loadAllSources(sourcesDir);
    const entry = loaded.find((e) => e.source.sourceId === id);
    if (entry === undefined) {
      return undefined;
    }
    const candidates: RepositoryRecord[] = entry.records.map((authored) => ({
      ...authored,
      sourceId: entry.source.sourceId,
    }));
    record = selectRepositoryRecord(candidates, archive);
  } catch {
    return undefined;
  }

  const dispatchesToInternetArchive = (record.identifiers ?? []).some(
    (identifier) => identifier.type === 'ia-item',
  );
  if (!dispatchesToInternetArchive) {
    return undefined;
  }

  // IA acquire fetches to a staging root under the private archive clone,
  // stages+extracts via poppler, and mirrors masters + the source PDF to the
  // object store -- REQUIRED for this path, so fail loud if any is absent
  // rather than silently constructing a half-working adapter.
  const repoRoot = resolveRepoRoot();
  const stagingRoot = resolveArchiveRoot(repoRoot);
  const objectStore = new S3ObjectStore(resolveObjectStoreConfig());
  const poppler = new PopplerRunnerImpl(execCommand);
  const now = () => new Date().toISOString();
  const qualityGate = makeCliQualityGate({ ...gateOptions, now });

  return new InternetArchiveAdapter({
    client: new HttpClient(),
    poppler,
    objectStore,
    qualityGate,
    unzip: execCommand,
    convert: execCommand,
    stagingRoot,
    baseDir: repoRoot,
    now,
  });
}
