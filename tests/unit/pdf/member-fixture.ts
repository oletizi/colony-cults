import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { Source } from '@/model/source';
import type { RepositoryRecord } from '@/model/repository-record';
import type { AcquiredAsset } from '@/model/acquired-asset';
import type { ObjectStore } from '@/archive/object-store';
import type { ProvenanceFields } from '@/archive/provenance';
import { serializeProvenance } from '@/archive/provenance';
import { sha256OfBytes } from '@/archive/checksum';

/**
 * Options for building a source-group member fixture.
 */
export interface WriteMemberFixtureOptions {
  /**
   * The source-group this member belongs to, e.g., `PB-G001`.
   */
  groupId: string;

  /**
   * Member source ID, e.g., `PB-P061`.
   */
  sourceId: string;

  /**
   * Case folder name (e.g., `port-breton`).
   */
  case: string;

  /**
   * Member slug (e.g., `la-nouvelle-france-1879-07-15`).
   */
  slug: string;

  /**
   * Total number of page-master segments to generate.
   */
  pageCount: number;

  /**
   * Article/issue date, normalized as YYYY-MM-DD.
   */
  articleDate: string;

  /**
   * Starting folio number. Defaults to 1.
   */
  startFolio?: number;

  /**
   * OCR text for the entire member (the detached ocr-text asset).
   * Defaults to a generated string.
   */
  ocrText?: string;

  /**
   * Holding archive label. Defaults to `Gallica / BnF`.
   */
  sourceArchive?: string;

  /**
   * Primary language. Defaults to `French`.
   */
  language?: string;

  /**
   * Catalog URL for provenance. Defaults to a generated Gallica URL.
   */
  catalogUrl?: string;
}

/**
 * Result of a member fixture builder.
 */
export interface WriteMemberFixtureResult {
  /**
   * Absolute path to the archive root (the temp directory containing
   * `archive/cases/.../` structure).
   */
  archiveRoot: string;

  /**
   * Absolute path to the member source directory itself
   * (`archive/cases/<case>/newspapers/<slug>/`).
   */
  sourceDir: string;

  /**
   * Call to clean up the temp directory. Safe to call multiple times.
   */
  cleanup: () => void;

  /**
   * Fixture image bytes keyed by folio number as a zero-padded 3-digit string
   * (e.g., "001", "002"). Each byte string is deterministic but distinct per
   * folio, suitable for serving via image fetch.
   */
  imageBytes: Map<string, Uint8Array>;

  /**
   * The raw OCR text bytes for the detached ocr-text asset.
   */
  ocrTextBytes: Uint8Array;

  /**
   * The object-store key where the ocr-text asset bytes reside.
   */
  ocrTextObjectStoreKey: string;

  /**
   * Lowercase-hex sha256 of `ocrTextBytes` -- the same value recorded as the
   * ocr-text asset's `checksum`, exposed so tests can assert a materialized
   * provenance sidecar's `sha256` against it without recomputing it.
   */
  ocrTextSha256: string;

  /**
   * The member `Source` object with `kind: 'periodical'` and `partOf: groupId`.
   * Does not include repositoryRecords; use `repositoryRecord` instead.
   */
  memberSource: Source;

  /**
   * The corresponding `RepositoryRecord` with `assets[]` containing the
   * N page-master segments and 1 ocr-text asset.
   */
  repositoryRecord: RepositoryRecord;

  /**
   * A fake ObjectStore that serves the ocr-text bytes. Used in tests
   * to stub the object-store reader so the batch/translate/OCR build
   * can fetch the ocr-text without network calls.
   */
  objectStore: ObjectStore;
}

/**
 * Build a fixture for a source-group member (periodical) with:
 * - N page-master segment folios in `archive/cases/<case>/newspapers/<slug>/`
 *   with `ocr_status: none` and ascending sequence (1..N)
 * - NO inline `issue.txt`
 * - A detached `ocr-text` asset with bytes and object-store key
 * - A member `Source` with `kind: 'periodical'`, `partOf: groupId`,
 *   and `repositoryRecords[0].assets[]` carrying the page-master and ocr-text
 *
 * Downstream tests wire this result to:
 * - Register the member layout via `registerSourceLayout` + `deriveSourceLayout`
 * - Stub the ObjectStore with `objectStore` so ocr-text fetch succeeds
 * - Serve segment images via `makeFixtureFetch(imageBytes)` (the image CDN)
 * - Read the member Source for bibliography metadata
 *
 * @param opts Configuration.
 * @returns Paths, cleanup, fixture data, and ready-to-use member Source.
 */
export async function writeMemberFixture(
  opts: WriteMemberFixtureOptions,
): Promise<WriteMemberFixtureResult> {
  const startFolio = opts.startFolio ?? 1;
  const sourceArchive = opts.sourceArchive ?? 'Gallica / BnF';
  const language = opts.language ?? 'French';
  const catalogUrl =
    opts.catalogUrl ?? `https://gallica.bnf.fr/ark:/12148/bpt6k${opts.sourceId}`;

  const tempRoot = mkdtempSync(path.join('/tmp', 'fixture-member-'));
  const archiveRoot = tempRoot;
  const sourceDir = path.join(
    archiveRoot,
    'archive',
    'cases',
    opts.case,
    'newspapers', // periodical members use newspapers layout
    opts.slug,
  );

  const cleanup = (): void => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Already cleaned or doesn't exist; ignore.
    }
  };

  const imageBytes = new Map<string, Uint8Array>();

  try {
    // Create the source directory.
    await mkdir(sourceDir, { recursive: true });

    // Generate folio sidecars and collect image bytes.
    const assets: AcquiredAsset[] = [];

    for (let i = 0; i < opts.pageCount; i++) {
      const folioNum = startFolio + i;
      const folioStr = String(folioNum).padStart(3, '0');

      // Generate fixture image bytes: deterministic but distinct per folio, and
      // prefixed with the JPEG magic (FF D8 FF E0) so format detection recognizes them.
      const imageData = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from('image-', 'utf-8'),
        Buffer.from(folioStr, 'utf-8'),
        randomBytes(32),
      ]);
      const imageBuffer = new Uint8Array(imageData);
      imageBytes.set(folioStr, imageBuffer);

      const imageSha256 = sha256OfBytes(imageBuffer);

      // Folio sidecar with ocr_status: none (no inline issue.txt).
      const folioSidecarPath = path.join(sourceDir, `f${folioStr}.yml`);
      const localPath = `archive/cases/${opts.case}/newspapers/${opts.slug}/f${folioStr}.gif`;
      const objectStoreKey = localPath;

      const folioProv: ProvenanceFields = {
        id: `${opts.sourceId}-f${folioStr}`,
        title: `${opts.sourceId} folio ${folioStr}`,
        type: 'page-image',
        case: opts.case,
        language,
        source_archive: sourceArchive,
        catalog_url: catalogUrl,
        original_url: `${catalogUrl}/f${folioNum}`,
        rights_status: 'public-domain',
        retrieved: new Date().toISOString(),
        local_path: localPath,
        sha256: imageSha256,
        format: 'image/gif',
        ocr_status: 'none', // Key difference: segments have no OCR status
        size: imageBuffer.byteLength,
        object_store: {
          provider: 'backblaze-b2',
          bucket: 'colony-cults',
          key: objectStoreKey,
          endpoint: 's3.us-west-000.backblazeb2.com',
        },
        notes: null,
        rights_raw: '<OAIRecord>dummy</OAIRecord>',
      };

      await writeFile(folioSidecarPath, serializeProvenance(folioProv));

      // Add to repositoryRecords assets as a page-master segment.
      assets.push({
        sourceUrl: `${catalogUrl}/f${folioNum}`,
        mediaType: 'image/gif',
        objectStoreKey,
        checksum: imageSha256,
        byteLength: imageBuffer.byteLength,
        provenancePath: `archive/cases/${opts.case}/newspapers/${opts.slug}/f${folioStr}.yml`,
        role: 'page-master',
        sequence: i + 1, // sequence starts at 1 for page-masters
      });
    }

    // Create the detached ocr-text asset.
    const ocrText =
      opts.ocrText ??
      `OCR text for ${opts.sourceId} (${opts.articleDate}): Lorem ipsum dolor sit amet.`;
    const ocrTextBytes = new Uint8Array(Buffer.from(ocrText, 'utf-8'));
    const ocrTextSha256 = sha256OfBytes(ocrTextBytes);
    const ocrTextObjectStoreKey = `archive/cases/${opts.case}/newspapers/${opts.slug}/ocr.txt`;

    assets.push({
      sourceUrl: catalogUrl,
      mediaType: 'text/plain',
      objectStoreKey: ocrTextObjectStoreKey,
      checksum: ocrTextSha256,
      byteLength: ocrTextBytes.byteLength,
      provenancePath: `archive/cases/${opts.case}/newspapers/${opts.slug}/ocr.txt.yml`,
      role: 'ocr-text',
      sequence: 0, // ocr-text always has sequence 0
      sourceRepresentation: 'papers-past-text-tab',
    });

    // Build the member Source.
    const memberSource: Source = {
      sourceId: opts.sourceId,
      kind: 'periodical',
      partOf: opts.groupId,
      case: opts.case,
      language,
      identifiers: [],
      titles: [
        {
          text: opts.slug.replace(/-/g, ' '),
          role: 'archive',
        },
      ],
    };

    // Build the repository record with assets.
    const repositoryRecord: RepositoryRecord = {
      sourceId: opts.sourceId,
      sourceArchive,
      status: 'archived',
      catalogUrl,
      assets,
    };

    // Create a fake ObjectStore that serves the ocr-text bytes.
    const objectStore: ObjectStore = {
      async head() {
        return { exists: true, sha256: ocrTextSha256 };
      },
      async put() {
        // No-op for tests.
      },
      async get(key: string) {
        if (key === ocrTextObjectStoreKey) {
          return ocrTextBytes;
        }
        throw new Error(`Unexpected object-store key in member fixture: ${key}`);
      },
      async attachSha256Metadata() {
        // No-op for tests.
      },
    };

    return {
      archiveRoot,
      sourceDir,
      cleanup,
      imageBytes,
      ocrTextBytes,
      ocrTextObjectStoreKey,
      ocrTextSha256,
      memberSource,
      repositoryRecord,
      objectStore,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/**
 * Options for building a source-group fixture.
 */
export interface WriteGroupFixtureOptions {
  /**
   * Source-group ID, e.g., `PB-G001`.
   */
  groupId: string;

  /**
   * Case folder name (e.g., `port-breton`).
   */
  case: string;

  /**
   * Number of member fixtures to create. Defaults to 2.
   * Each member gets a distinct article date (chronologically ordered).
   */
  memberCount?: number;
}

/**
 * Result of a source-group fixture builder.
 */
export interface WriteGroupFixtureResult {
  /**
   * The source-group `Source` with `kind: 'source-group'` and no repositoryRecords.
   * Members are derived from their `partOf` edges.
   */
  groupSource: Source;

  /**
   * Array of member fixture results, in chronological order by articleDate.
   */
  members: WriteMemberFixtureResult[];

  /**
   * Combined cleanup function that calls cleanup on all members and the group.
   */
  cleanup: () => void;
}

/**
 * Build a fixture for a source-group with ≥2 members, each with distinct article dates.
 * Useful for testing chronological ordering, member filtering, and multi-issue rendering.
 *
 * Each member is created via `writeMemberFixture` with:
 * - `groupId` set to the group's ID
 * - `sourceId` auto-generated as `<groupId>-M<N>` (e.g., `PB-G001-M001`)
 * - Distinct `articleDate` in ascending chronological order
 *
 * The group Source carries no repositoryRecords; members reference the group
 * via `partOf`, and a reader derives membership at load time.
 *
 * @param opts Configuration.
 * @returns Group Source, array of member fixtures, and combined cleanup.
 */
export async function writeGroupFixture(
  opts: WriteGroupFixtureOptions,
): Promise<WriteGroupFixtureResult> {
  const memberCount = opts.memberCount ?? 2;
  if (memberCount < 1) {
    throw new Error('writeGroupFixture: memberCount must be >= 1');
  }

  const baseDate = new Date('2026-01-01');
  const members: WriteMemberFixtureResult[] = [];

  try {
    // Create each member with a distinct date in ascending order.
    for (let i = 0; i < memberCount; i++) {
      const memberNum = String(i + 1).padStart(3, '0');
      const sourceId = `${opts.groupId}-M${memberNum}`;
      const memberDate = new Date(baseDate);
      memberDate.setDate(memberDate.getDate() + i * 7); // Each member 7 days apart
      const articleDate = memberDate.toISOString().split('T')[0];

      const slug = `${opts.groupId.toLowerCase()}-${articleDate}`;
      const fixture = await writeMemberFixture({
        groupId: opts.groupId,
        sourceId,
        case: opts.case,
        slug,
        pageCount: 2, // 2 pages per member by default
        articleDate,
        ocrText: `OCR for ${sourceId} (${articleDate})`,
      });

      members.push(fixture);
    }

    // Build the source-group Source.
    const groupSource: Source = {
      sourceId: opts.groupId,
      kind: 'source-group',
      case: opts.case,
      identifiers: [],
      titles: [
        {
          text: opts.groupId,
          role: 'archive',
        },
      ],
    };

    // Combined cleanup for all members and the group.
    const cleanup = (): void => {
      for (const member of members) {
        member.cleanup();
      }
    };

    return {
      groupSource,
      members,
      cleanup,
    };
  } catch (err) {
    // Clean up any successfully created members on error.
    for (const member of members) {
      member.cleanup();
    }
    throw err;
  }
}
