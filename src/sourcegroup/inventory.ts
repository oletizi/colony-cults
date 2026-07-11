import { loadAllSources } from '@/bibliography/load';
import { describeError } from '@/bibliography/load-primitives';
import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type { RightsStatus } from '@/bibliography/vocab';
import { allocateMemberId } from '@/sourcegroup/id-alloc';
import { writeSnapshot } from '@/sourcegroup/snapshot';
import type { MetadataSnapshotRef } from '@/model/repository-record';
import type { RepositoryRecord } from '@/model/repository-record';
import type { Rights } from '@/model/rights';
import type { Source, Title, WorkIdentifier } from '@/model/source';

/**
 * `runInventory` (T018/T019, US1, FR-001-005): the MVP entry point of the
 * source-group acquisition pipeline. Turns one discovered archival ark into a
 * source-group member `Source` + a `RepositoryRecord` at `status: wanted` +
 * an immutable metadata snapshot (`@/sourcegroup/snapshot`).
 *
 * All I/O beyond the filesystem writes this function is explicitly
 * responsible for (the member Source file, the snapshot file) is injected --
 * in particular the archival lookup (`resolveArk`) -- so this module is
 * pure-ish and testable without ever touching the network or the real
 * `bibliography/` tree.
 *
 * See specs/006-source-group-acquisition/contracts/cli-commands.md
 * (`bib inventory`) and data-model.md.
 */

/**
 * The metadata resolved for one ark from the discovery/repository endpoint.
 * Deliberately archive-agnostic (not Gallica-specific): `rawResponse` is
 * whatever the resolver retrieved (stored verbatim in the metadata snapshot),
 * `rightsRaw` is the holding archive's verbatim rights statement (evidence;
 * normalized into `Rights.status` by this module, not the resolver).
 */
export interface ArkMetadata {
  /** One or more titles for the member Source; see `Source.titles`. */
  titles: Title[];
  /** Author/editor, if known. */
  creator?: string;
  /**
   * Publication date as reported by the archive, kept VERBATIM (no format
   * normalization -- an archive-supplied date may be a bare year, e.g.
   * `1889`, rather than `YYYY-MM-DD`). Captured for provenance; not yet
   * consumed by `runInventory` itself (a `Source` carries no date field --
   * see `@/sourcegroup/verify-member`'s `candidateDate`).
   */
  date?: string;
  /** Work-level identifiers (ISBN/ISSN/OCLC), if known. */
  identifiers?: WorkIdentifier[];
  /**
   * The holding archive's verbatim rights statement (evidence). Normalized
   * into `public-domain` | `other` by `runInventory`, not by the resolver.
   * Absent when the endpoint carries no rights statement at all.
   */
  rightsRaw?: string;
  /** The original URL the copy was retrieved from. */
  originalUrl?: string;
  /** The raw, unparsed response body, preserved verbatim in the snapshot. */
  rawResponse: string;
  /** The discovery/repository endpoint this metadata was retrieved from. */
  endpoint: string;
  /** ISO retrieval timestamp. */
  retrievedAt: string;
  /** The normalization scheme version applied to derive normalized fields. */
  normalizationVersion: number;
  /**
   * The holding archive's display name, e.g. `Gallica / BnF`, used as the
   * RepositoryRecord's `sourceArchive` when `--archive` is not given. Absent
   * when the resolver cannot supply one -- `runInventory` then requires an
   * explicit `archive` input and fails loud without one.
   */
  archive?: string;
}

/**
 * Injected ark resolver: resolves an ark's metadata against the discovery/
 * repository endpoint, or `null` when it cannot be retrieved (a dead/unknown
 * ark). Injected so `runInventory` never reaches the network directly and
 * stays testable (FR-002).
 */
export type ArkResolver = (ark: string) => Promise<ArkMetadata | null>;

/** Input to {@link runInventory}. */
export interface RunInventoryInput {
  /** The archival ark/identifier to inventory. */
  ark: string;
  /** Must resolve to an existing `kind: source-group` Source (FR-005). */
  groupId: string;
  /** Member kind; defaults to `monograph`. Never `source-group` (a member is never a group). */
  kind?: 'monograph' | 'periodical';
  /**
   * Holding archive name (`--archive`). Optional: when absent, the resolved
   * metadata's `archive` hint is used instead; if neither is available,
   * `runInventory` fails loud (a RepositoryRecord's `sourceArchive` is
   * required, D-05).
   */
  archive?: string;
  /** The `bibliography/sources` directory (one-file-per-source SSOT). */
  sourcesDir: string;
  /** The repo root the metadata-snapshot store's `bibliography/` subpath is relative to. */
  baseDir: string;
  /** Injected ark resolver (no direct network access from this module). */
  resolveArk: ArkResolver;
}

/** The outcome of one `runInventory` call. */
export interface RunInventoryResult {
  /** The newly allocated member id, e.g. `PB-P007`. */
  sourceId: string;
  /** The written member Source. */
  source: Source;
  /** The written RepositoryRecord (`status: wanted`). */
  record: RepositoryRecord;
  /** The written immutable metadata snapshot's reference. */
  snapshot: MetadataSnapshotRef;
  /**
   * `true` only when `record.rights.status === 'public-domain'`. A
   * non-public-domain record is still created (FR-003) -- this flag is how a
   * caller (e.g. the CLI wiring) surfaces that it is not yet acquirable
   * (US1 scenario 5), without inventing a new persisted field.
   */
  acquirable: boolean;
}

/**
 * The only rights statements this module recognizes as an affirmative
 * public-domain marker (matched case-insensitively after trimming). Anything
 * else -- including an absent statement -- normalizes to `other`; the
 * determination is fail-closed, mirroring `@/rights/gate`'s Gallica-specific
 * gate.
 */
const PUBLIC_DOMAIN_MARKERS: ReadonlySet<string> = new Set(['public domain', 'domaine public']);

function normalizeRightsStatus(rightsRaw: string | undefined): RightsStatus {
  if (rightsRaw === undefined) {
    return 'other';
  }
  return PUBLIC_DOMAIN_MARKERS.has(rightsRaw.trim().toLowerCase()) ? 'public-domain' : 'other';
}

/**
 * Fail loud unless `groupId` resolves to an existing `kind: source-group`
 * Source in `sourcesDir` (FR-005). Runs BEFORE any allocation/write so a
 * failure here creates nothing.
 */
function assertSourceGroup(sourcesDir: string, groupId: string): void {
  let loaded: ReturnType<typeof loadAllSources>;
  try {
    loaded = loadAllSources(sourcesDir);
  } catch (error) {
    throw new Error(
      `runInventory: cannot resolve --group "${groupId}": failed to load sources from ` +
        `"${sourcesDir}": ${describeError(error)}`,
    );
  }
  const group = loaded.find((entry) => entry.source.sourceId === groupId);
  if (group === undefined) {
    throw new Error(
      `runInventory: --group "${groupId}" does not resolve to an existing Source in "${sourcesDir}"`,
    );
  }
  if (group.source.kind !== 'source-group') {
    throw new Error(
      `runInventory: --group "${groupId}" resolves to a Source of kind "${group.source.kind}", ` +
        `not "source-group" -- a member may only be inventoried into an actual source-group`,
    );
  }
}

/**
 * Create a source-group member from an archival ark: resolve its metadata,
 * allocate the next-free `PB-P###` id, and atomically write the member
 * Source + its RepositoryRecord (`status: wanted`) + an immutable metadata
 * snapshot referenced from the record.
 *
 * Fails loud -- creating nothing -- when `groupId` does not resolve to an
 * existing `source-group` Source, or when `ark` cannot be resolved. A
 * non-public-domain ark still produces a member + record (`rights.status:
 * other`); the caller learns this via the returned `acquirable: false`
 * (FR-003, US1 scenario 5).
 */
export async function runInventory(input: RunInventoryInput): Promise<RunInventoryResult> {
  const { ark, groupId, sourcesDir, baseDir, resolveArk } = input;
  const kind = input.kind ?? 'monograph';

  // FR-005: validate the group BEFORE any allocation/write -- a failure here
  // must create nothing.
  assertSourceGroup(sourcesDir, groupId);

  // FR-002: resolve the ark's metadata via the injected resolver. A `null`
  // result (unresolvable ark) fails loud without writing anything; a thrown
  // resolver error propagates as-is (also before any write).
  const metadata = await resolveArk(ark);
  if (metadata === null) {
    throw new Error(`runInventory: ark "${ark}" could not be resolved -- nothing was created`);
  }

  const sourceArchive = input.archive ?? metadata.archive;
  if (sourceArchive === undefined) {
    throw new Error(
      `runInventory: no --archive given and the resolved metadata for ark "${ark}" carries no ` +
        `archive hint -- pass --archive <name> explicitly`,
    );
  }

  const rightsStatus = normalizeRightsStatus(metadata.rightsRaw);

  // Captured from inside the id-alloc content callback -- see the comment
  // below on why capture (rather than reconstruction) is correct here.
  let capturedSource: Source | undefined;
  let capturedAuthoredRecord: AuthoredRepositoryRecord | undefined;
  let capturedSnapshot: MetadataSnapshotRef | undefined;

  const sourceId = await allocateMemberId(sourcesDir, async (candidateId) => {
    // The metadata snapshot's storage path is keyed by `sourceId`
    // (`@/sourcegroup/snapshot`), so it can only be written once the
    // candidate id is known. `allocateMemberId`'s content callback may be
    // invoked more than once under contention (each invocation gets a fresh,
    // distinct candidate id from a rescan) -- so this may write an orphaned
    // snapshot for a losing candidate. That is an acceptable, rare byproduct
    // of the atomic-claim design (see `@/sourcegroup/id-alloc`): the
    // returned `sourceId` and the values captured below always come from the
    // call whose exclusive-create actually won, so the RETURNED result is
    // always internally consistent.
    const snapshot = await writeSnapshot(baseDir, {
      sourceId: candidateId,
      ark,
      raw: metadata.rawResponse,
      retrievedAt: metadata.retrievedAt,
      endpoint: metadata.endpoint,
      normalizationVersion: metadata.normalizationVersion,
      stamp: metadata.retrievedAt,
    });

    const rights: Rights = {
      ark,
      status: rightsStatus,
      rawResponse: metadata.rawResponse,
      dcRights: metadata.rightsRaw !== undefined ? [metadata.rightsRaw] : [],
      raw: metadata.rightsRaw,
    };

    const authoredRecord: AuthoredRepositoryRecord = {
      sourceArchive,
      status: 'wanted',
      originalUrl: metadata.originalUrl,
      retrievedAt: metadata.retrievedAt,
      identifiers: [{ type: 'ark', value: ark }],
      rights,
      metadataSnapshot: snapshot,
    };

    const source: Source = {
      sourceId: candidateId,
      titles: metadata.titles,
      kind,
      partOf: groupId,
      status: 'discovered',
      creator: metadata.creator,
      identifiers: metadata.identifiers ?? [],
    };

    capturedSource = source;
    capturedAuthoredRecord = authoredRecord;
    capturedSnapshot = snapshot;

    return serializeSource({ source, records: [authoredRecord] });
  });

  if (
    capturedSource === undefined ||
    capturedAuthoredRecord === undefined ||
    capturedSnapshot === undefined
  ) {
    throw new Error(
      `runInventory: internal error -- allocateMemberId returned "${sourceId}" without a ` +
        'captured member Source/RepositoryRecord/snapshot',
    );
  }

  const record: RepositoryRecord = {
    sourceId,
    sourceArchive: capturedAuthoredRecord.sourceArchive,
    identifiers: capturedAuthoredRecord.identifiers,
    rights: capturedAuthoredRecord.rights,
    originalUrl: capturedAuthoredRecord.originalUrl,
    retrievedAt: capturedAuthoredRecord.retrievedAt,
    status: capturedAuthoredRecord.status,
    metadataSnapshot: capturedAuthoredRecord.metadataSnapshot,
  };

  return {
    sourceId,
    source: capturedSource,
    record,
    snapshot: capturedSnapshot,
    acquirable: rightsStatus === 'public-domain',
  };
}
