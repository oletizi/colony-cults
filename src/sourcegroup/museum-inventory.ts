import type { AuthoredRepositoryRecord } from '@/bibliography/model';
import { serializeSource } from '@/bibliography/migrate-serialize';
import type {
  RepositoryAdapter,
  RepositoryName,
  ResolvedRepositoryItem,
} from '@/repository/adapter';
import { allocateMemberId } from '@/sourcegroup/id-alloc';
import { resolveSourceGroup } from '@/sourcegroup/inventory';
import { writeSnapshot } from '@/sourcegroup/snapshot';
import type { MetadataSnapshotRef, RepositoryRecord } from '@/model/repository-record';
import type { Source, Title } from '@/model/source';

/**
 * `runMuseumInventory` (T017, specs/011-museum-acquisition-path, US1): the
 * `--repository`-routed sibling of `@/sourcegroup/inventory`'s `runInventory`
 * for a RAW repository locator (a museum item-page URL, not a Gallica ark).
 * Resolves the locator through the injected adapter registry --
 * `registry.selectByName(name).resolve(...)` -- rather than the
 * ark-oriented `ArkResolver`, and creates an `archival-item` member (never
 * `monograph`/`periodical`: a museum item is a discrete non-serial archival
 * work by construction).
 *
 * Kept in its own module (rather than folded into `inventory.ts`) to stay
 * under the project's file-size guideline; shares the group-resolution +
 * atomic-id-allocation + write-once-snapshot machinery
 * ({@link resolveSourceGroup}, `allocateMemberId`, `writeSnapshot`) with the
 * ark path, diverging only in WHERE the member's fields come from: a
 * `ResolvedRepositoryItem` (adapter contract) rather than `ArkMetadata` (the
 * Gallica-specific OAIRecord shape). No rights judgment is made here
 * (rights-assess is a later, operator-confirmed step) -- the created record
 * carries no `rights`/`rightsAssessment`.
 */
export interface RunMuseumInventoryInput {
  /** The raw repository locator, e.g. a Musarch item-page URL. */
  locator: string;
  /** The repository to dispatch on; the caller (CLI) narrows the raw `--repository` string to this. */
  repository: RepositoryName;
  /** Must resolve to an existing `kind: source-group` Source (FR-005, shared with the ark path). */
  groupId: string;
  /**
   * Holding archive display name (`--archive`). Optional: when absent, a
   * fixed per-repository display name is used (mirrors `runInventory`'s
   * `--archive`/metadata-hint precedence, minus the metadata hint -- a
   * `ResolvedRepositoryItem` carries no archive-name field).
   */
  archive?: string;
  /** The `bibliography/sources` directory (one-file-per-source SSOT). */
  sourcesDir: string;
  /** The repo root the metadata-snapshot store's `bibliography/` subpath is relative to. */
  baseDir: string;
  /** Injected adapter registry (no adapter construction inside this module). */
  registry: RepositoryRegistry;
}

/** The outcome of one `runMuseumInventory` call. */
export interface RunMuseumInventoryResult {
  /** The newly allocated member id, e.g. `PB-P007`. */
  sourceId: string;
  /** The written member Source (`kind: archival-item`). */
  source: Source;
  /** The written RepositoryRecord (`status: wanted`, no rights determination). */
  record: RepositoryRecord;
  /** The written immutable metadata snapshot's reference. */
  snapshot: MetadataSnapshotRef;
}

/**
 * The minimal adapter-registry surface `runMuseumInventory` depends on
 * (structurally satisfied by `@/repository/registry`'s
 * `RepositoryAdapterRegistry`; a test injects a fake). Kept narrow -- this
 * module never needs `selectForRecord`, only the explicit-by-name lookup an
 * operator-supplied `--repository` drives.
 */
export interface RepositoryRegistry {
  selectByName(name: RepositoryName): RepositoryAdapter;
}

/** The normalization scheme version for a museum item's metadata snapshot (its raw JSON shape). */
export const MUSEUM_NORMALIZATION_VERSION = 1;

/**
 * Fixed display names for repositories with no per-item archive-name hint
 * (unlike Gallica's OAIRecord, a Musarch item page carries no "holding
 * archive" field of its own -- the holding archive IS the repository).
 * `--archive` still overrides this, same precedence as `runInventory`.
 */
const REPOSITORY_ARCHIVE_NAMES: Readonly<Partial<Record<RepositoryName, string>>> = {
  'new-italy-museum': 'New Italy Museum',
};

function archiveNameFor(repository: RepositoryName, override: string | undefined): string {
  if (override !== undefined) {
    return override;
  }
  const fixedName = REPOSITORY_ARCHIVE_NAMES[repository];
  if (fixedName === undefined) {
    throw new Error(
      `runMuseumInventory: no default archive display name is known for repository ` +
        `"${repository}" -- pass --archive <name> explicitly`,
    );
  }
  return fixedName;
}

/**
 * Derive the new member's required (non-fabricated) title from the resolved
 * item's DETERMINISTIC `title` field (`ResolvedRepositoryItem.title` --
 * mechanically derived by the adapter, e.g. the New Italy Museum's
 * `#objectdesc` DOM span, NEVER the optional LLM-grounded
 * `metadata.description`). A Musarch item page has no distinct "title" field
 * of its own; its short prose description (e.g. "Pioneers Group Photo 1890")
 * IS the item's title in practice. Every adapter's `resolve` contract
 * guarantees `title` is a non-empty string whenever `resolve` succeeds at
 * all (see `ResolvedRepositoryItem.title`'s doc comment), so this no longer
 * depends on the LLM extractor having grounded an optional field -- it only
 * fails loud (creating nothing) if a resolved item somehow carries a blank
 * title, which `Source.titles` (load.ts rule 2) can never accept.
 */
function titleFromResolvedItem(item: ResolvedRepositoryItem): Title[] {
  const text = item.title.trim();
  if (text.length === 0) {
    throw new Error(
      `runMuseumInventory: the resolved item at "${item.sourceUrl}" carries an empty ` +
        'deterministic title -- Source.titles cannot be empty and no placeholder title is ' +
        'ever fabricated',
    );
  }
  return [{ text, role: 'archive' }];
}

/**
 * Create a source-group member from a raw repository locator (US1, museum
 * path): resolve it via the injected registry/adapter, allocate the
 * next-free `PB-P###` id, and atomically write the member Source
 * (`kind: archival-item`) + its RepositoryRecord (`status: wanted`, identity
 * only -- no rights) + an immutable metadata snapshot referenced from the
 * record.
 *
 * Fails loud -- creating nothing -- when `groupId` does not resolve to an
 * existing `source-group` Source, when `repository` is not registered
 * (`registry.selectByName` throws, INV-D), when the locator cannot be
 * resolved/verified (`adapter.resolve` throws, INV-A -- e.g. a missing
 * accession), or when the resolved item carries no description to derive a
 * title from.
 */
export async function runMuseumInventory(
  input: RunMuseumInventoryInput,
): Promise<RunMuseumInventoryResult> {
  const { locator, repository, groupId, sourcesDir, baseDir, registry } = input;

  // FR-005: validate the group BEFORE any resolve/allocation/write -- a
  // failure here must create nothing. Also the source of the new member's
  // `case`, mirroring `runInventory`.
  const group = resolveSourceGroup(sourcesDir, groupId);

  // INV-D/INV-A: the registry and adapter are the only sources of truth for
  // dispatch and verification -- no locator-shape sniffing here.
  const adapter = registry.selectByName(repository);
  const item = await adapter.resolve({ repository, value: locator }, {});

  const sourceArchive = archiveNameFor(repository, input.archive);
  const titles = titleFromResolvedItem(item);
  const creatorField = item.metadata.creator;
  const creator =
    creatorField !== undefined && typeof creatorField.value === 'string'
      ? creatorField.value
      : undefined;
  // `date` is a REQUIRED, rights-critical field of every `ResolvedRepositoryItem`
  // (`MUSEUM_ITEM_SCHEMA.rightsCriticalFields`), so its provenance timestamp is
  // always present -- used as this snapshot/record's retrieval timestamp.
  const retrievedAt = item.metadata.date.provenance.at;

  // Captured from inside the id-alloc content callback -- see `runInventory`'s
  // comment on why capture (rather than reconstruction) is correct here.
  let capturedSource: Source | undefined;
  let capturedAuthoredRecord: AuthoredRepositoryRecord | undefined;
  let capturedSnapshot: MetadataSnapshotRef | undefined;

  const sourceId = await allocateMemberId(sourcesDir, async (candidateId) => {
    const snapshot = await writeSnapshot(baseDir, {
      sourceId: candidateId,
      ark: locator,
      raw: JSON.stringify(item.metadata),
      retrievedAt,
      endpoint: item.sourceUrl,
      normalizationVersion: MUSEUM_NORMALIZATION_VERSION,
      stamp: retrievedAt,
    });

    const authoredRecord: AuthoredRepositoryRecord = {
      sourceArchive,
      status: 'wanted',
      sourceUrl: item.sourceUrl,
      retrievedAt,
      identifiers: item.identifiers,
      metadataSnapshot: snapshot,
    };

    const source: Source = {
      sourceId: candidateId,
      titles,
      kind: 'archival-item',
      partOf: groupId,
      status: 'discovered',
      creator,
      identifiers: [],
      case: group.source.case,
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
      `runMuseumInventory: internal error -- allocateMemberId returned "${sourceId}" without a ` +
        'captured member Source/RepositoryRecord/snapshot',
    );
  }

  const record: RepositoryRecord = {
    sourceId,
    sourceArchive: capturedAuthoredRecord.sourceArchive,
    identifiers: capturedAuthoredRecord.identifiers,
    sourceUrl: capturedAuthoredRecord.sourceUrl,
    retrievedAt: capturedAuthoredRecord.retrievedAt,
    status: capturedAuthoredRecord.status,
    metadataSnapshot: capturedAuthoredRecord.metadataSnapshot,
  };

  return {
    sourceId,
    source: capturedSource,
    record,
    snapshot: capturedSnapshot,
  };
}
