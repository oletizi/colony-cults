import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { ProvenanceFields } from '@/archive/provenance';
import { serializeProvenance } from '@/archive/provenance';
import { sha256OfBytes } from '@/archive/checksum';

/**
 * A page's translation configuration for the fixture.
 */
export interface FixturePageConfig {
  /**
   * Translation label: `machine-assisted` (with non-empty English text) or
   * `untranslatable` (empty English text, blank column in render).
   * Omit to generate a default machine-assisted page.
   */
  translationLabel?: 'machine-assisted' | 'untranslatable';

  /**
   * English translation text. For `machine-assisted`, defaults to a generated
   * string; for `untranslatable`, MUST be absent or empty.
   */
  englishText?: string;

  /**
   * OCR French text from the issue.txt segment. Defaults to a generated string.
   */
  ocrFrench?: string;

  /**
   * Corrected French text (optional). When present, writes to
   * `translation/pNNN.fr.txt` and overrides the issue.txt segment as the FR source.
   */
  correctedFrench?: string;

  /**
   * When true, the translation artifact (pNNN.en.txt + sidecar) is omitted
   * entirely, fixture the fail-loud absent-translation case.
   */
  omitTranslationArtifact?: boolean;
}

/**
 * Options for building a fixture archive directory.
 */
export interface WriteFixtureArchiveOptions {
  /**
   * Case folder name (e.g., `port-breton`).
   */
  case: string;

  /**
   * Book slug (e.g., `PB-P001`).
   */
  slug: string;

  /**
   * Total number of pages to generate.
   */
  pageCount: number;

  /**
   * Starting folio number. Defaults to 1. Use to fixture extracts (e.g., 48 for
   * folios f048..f050).
   */
  startFolio?: number;

  /**
   * Per-page configurations. Length must match `pageCount`; defaults to
   * machine-assisted pages with generated text.
   */
  pages?: FixturePageConfig[];

  /**
   * Catalog/issue URL for provenance. Defaults to a generated ARK URL.
   */
  catalogUrl?: string;

  /**
   * Holding archive label. Defaults to `Gallica / BnF`.
   */
  sourceArchive?: string;

  /**
   * Primary language. Defaults to `French`.
   */
  language?: string;
}

/**
 * Return type for the fixture archive builder.
 */
export interface WriteFixtureArchiveResult {
  /**
   * Absolute path to the archive root (the temp directory containing
   * `archive/cases/.../` structure).
   */
  archiveRoot: string;

  /**
   * Absolute path to the source directory itself
   * (`archive/cases/<case>/books/<slug>/`).
   */
  sourceDir: string;

  /**
   * Call to clean up the temp directory. Safe to call multiple times.
   */
  cleanup: () => void;

  /**
   * Fixture image bytes keyed by folio number as a zero-padded 3-digit string
   * (e.g., "001", "048", "050"). Each byte string is deterministic but distinct
   * per folio, so image-fetch tests can serve them.
   */
  imageBytes: Map<string, Uint8Array>;
}

/**
 * Build a fixture archive directory structure for testing the archive-direct
 * reader. Writes folio sidecars, OCR blob, and translation artifacts under a
 * temp directory, and returns the paths + cleanup handle + fixture image bytes.
 *
 * The directory structure mirrors the real archive layout:
 * ```
 * archive/cases/<case>/books/<slug>/
 *   fNNN.yml                         (folio sidecar, via serializeProvenance)
 *   issue.txt                        (form-feed-delimited OCR, one segment/page)
 *   translation/
 *     pNNN.en.txt                    (English, when present)
 *     pNNN.en.txt.yml                (provenance sidecar)
 *     pNNN.fr.txt                    (corrected French, optional)
 * ```
 *
 * **Key behaviors**:
 * - Folios are numbered starting at `startFolio` (default 1): `f001`, `f002`, etc.
 * - Translations are numbered EXTRACT-RELATIVE from `p001`: regardless of folio
 *   start, the first page is always `p001`, second is `p002`, etc.
 * - Each folio sidecar carries a distinct `object_store.key` and the
 *   image-master sha256 of that page's fixture image bytes.
 * - Pages default to machine-assisted translations; configure via `pages`.
 * - An `untranslatable`-labeled page has empty English text (the blank-column marker).
 * - An `omitTranslationArtifact: true` page has no translation artifact at all
 *   (fixtures the fail-loud case).
 * - The OCR French defaults to the issue.txt segment unless `correctedFrench`
 *   is provided (then both the segment and pNNN.fr.txt use the corrected text).
 *
 * @param opts Configuration.
 * @returns Archive paths, cleanup, and fixture image bytes.
 */
export async function writeFixtureArchive(
  opts: WriteFixtureArchiveOptions,
): Promise<WriteFixtureArchiveResult> {
  const startFolio = opts.startFolio ?? 1;
  const sourceArchive = opts.sourceArchive ?? 'Gallica / BnF';
  const language = opts.language ?? 'French';
  const catalogUrl =
    opts.catalogUrl ?? `https://gallica.bnf.fr/ark:/12148/bpt6k${opts.slug}`;

  const tempRoot = mkdtempSync(path.join('/tmp', 'fixture-archive-'));
  const archiveRoot = tempRoot;
  const sourceDir = path.join(
    archiveRoot,
    'archive',
    'cases',
    opts.case,
    'books',
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

    // Collect OCR segments for the issue.txt blob.
    const ocrSegments: string[] = [];

    // Generate folio sidecars, translation artifacts, and collect OCR.
    for (let i = 0; i < opts.pageCount; i++) {
      const pageConfig = (opts.pages ?? [])[i] ?? {};
      const folioNum = startFolio + i;
      const folioStr = String(folioNum).padStart(3, '0');
      const positionStr = String(i + 1).padStart(3, '0');

      // Generate fixture image bytes: deterministic but distinct per folio.
      const imageData = Buffer.concat([
        Buffer.from('image-', 'utf-8'),
        Buffer.from(folioStr, 'utf-8'),
        randomBytes(32),
      ]);
      const imageBuffer = new Uint8Array(imageData);
      imageBytes.set(folioStr, imageBuffer);

      const imageSha256 = sha256OfBytes(imageBuffer);

      // Folio sidecar.
      const folioSidecarPath = path.join(sourceDir, `f${folioStr}.yml`);
      const localPath = `archive/cases/${opts.case}/books/${opts.slug}/f${folioStr}.jpg`;
      const objectStoreKey = localPath;

      const folioProv: ProvenanceFields = {
        id: `${opts.slug}-f${folioStr}`,
        title: `${opts.slug} folio ${folioStr}`,
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
        format: 'image/jpeg',
        ocr_status: 'searchable',
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

      // OCR segment for issue.txt.
      const ocrFrench =
        pageConfig.ocrFrench ??
        `French OCR for page ${positionStr} (folio f${folioStr})`;
      ocrSegments.push(ocrFrench);

      // Translation artifact: skip if omitTranslationArtifact is true.
      if (!pageConfig.omitTranslationArtifact) {
        const translationLabel = pageConfig.translationLabel ?? 'machine-assisted';
        const englishText =
          translationLabel === 'untranslatable'
            ? ''
            : pageConfig.englishText ??
              `English translation for page ${positionStr} (folio f${folioStr})`;

        // Write pNNN.en.txt.
        const translationDir = path.join(sourceDir, 'translation');
        await mkdir(translationDir, { recursive: true });

        const enTextPath = path.join(translationDir, `p${positionStr}.en.txt`);
        await writeFile(enTextPath, englishText);

        // Write pNNN.en.txt.yml sidecar.
        const enSidecarPath = path.join(translationDir, `p${positionStr}.en.txt.yml`);
        const translationProv: ProvenanceFields = {
          id: `${opts.slug}-p${positionStr}-en`,
          title: `${opts.slug} page ${positionStr} English translation`,
          type: 'translation-text',
          case: opts.case,
          language: 'English',
          source_archive: sourceArchive,
          catalog_url: catalogUrl,
          original_url: `${catalogUrl}/p${i + 1}`,
          rights_status: 'public-domain',
          retrieved: new Date().toISOString(),
          local_path: `archive/cases/${opts.case}/books/${opts.slug}/translation/p${positionStr}.en.txt`,
          sha256: sha256OfBytes(new Uint8Array(Buffer.from(englishText, 'utf-8'))),
          format: 'text/plain',
          ocr_status: 'none',
          size: Buffer.byteLength(englishText, 'utf-8'),
          object_store: null,
          engine: 'claude-code-cli',
          model: 'claude-opus-4',
          translation: translationLabel,
          notes: null,
          rights_raw: '<OAIRecord>dummy</OAIRecord>',
        };

        await writeFile(enSidecarPath, serializeProvenance(translationProv));
      }

      // Corrected French (optional).
      if (pageConfig.correctedFrench !== undefined) {
        const frTextPath = path.join(
          sourceDir,
          'translation',
          `p${positionStr}.fr.txt`,
        );
        await mkdir(path.dirname(frTextPath), { recursive: true });
        await writeFile(frTextPath, pageConfig.correctedFrench);

        // Update the OCR segment to the corrected version.
        ocrSegments[i] = pageConfig.correctedFrench;
      }
    }

    // Write issue.txt with form-feed delimiters.
    const issueTextPath = path.join(sourceDir, 'issue.txt');
    const issueBlobContent = ocrSegments.join('\f');
    await writeFile(issueTextPath, issueBlobContent);

    return {
      archiveRoot,
      sourceDir,
      cleanup,
      imageBytes,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}
