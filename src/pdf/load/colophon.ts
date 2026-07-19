/**
 * Assemble the {@link ColophonMeta} back matter for one Edition (T012, spec
 * 007; spec 015 FR-013 reading-language branch): the reproducibility record
 * (pinned archive ref + per-image key/checksum), the reading-language-keyed
 * provenance disclosure, and the fixed critical-framing statement.
 *
 * Fail-loud (data-model.md G-5 / FR-005, Principle III; spec 015 FR-013):
 *  - `archiveRef` must be non-empty (a build with no pin is not reproducible).
 *  - FRENCH (`readingLanguage === 'french'`, unchanged from spec 014): at
 *    least one page must carry a machine-assist translation label -- the
 *    label is mandatory, so an item whose pages carry none throws rather than
 *    emitting an unlabelled translation. This is the spec-014 safety net and
 *    MUST stay intact.
 *  - ENGLISH (`readingLanguage === 'english'`, spec 015): no page is expected
 *    to carry a machine-assist label (none was performed); instead an
 *    OCR-transcription disclosure is mandatory -- an English source with no
 *    disclosure inputs throws rather than emitting a silent empty disclosure
 *    (Principle V).
 *
 * Pure data assembly -- no image bytes, no I/O.
 */

import type { ColophonImage, ColophonMeta, MachineAssistLabel, OcrTranscription } from '@/pdf/model';
import type { ReadingLanguage } from '@/pdf/load/archive-source';

/**
 * The fixed critical-framing statement rendered in every colophon (FR-016).
 * The corpus is 19th-century colonial-scheme propaganda; this edition
 * reproduces it as historical evidence for study, not to endorse or amplify its
 * claims. The wording is deliberately sober and constant so every Edition
 * carries the identical framing.
 */
export const EVIDENCE_FRAMING =
  'This edition reproduces primary-source material published to promote a ' +
  '19th-century colonial settlement scheme. The text is propaganda, preserved ' +
  'and presented here as historical evidence for scholarly study. Its claims ' +
  'are reproduced faithfully for the documentary record and are neither ' +
  'endorsed nor corrected; readers should treat every assertion as the ' +
  "promoters' own, to be weighed critically against the historical record.";

/**
 * One page's already-validated reproducibility inputs, as prepared by the
 * Edition builder. `objectStoreKey`/`sha256` are non-null here by construction
 * (the builder enforces G-3 before assembling the colophon), so this module
 * does no re-validation of them; `machineAssist` is the per-page translation
 * label carried on the snapshot provenance (or `null` when the page has none).
 */
export interface ColophonPageInput {
  /** Snapshot page id -- used only to name a page in an error message. */
  pageId: string;
  /** Image/view id (e.g. `f001`). */
  folioId: string;
  /** B2 object-store key for this page's image. */
  objectStoreKey: string;
  /** Content checksum recorded in the snapshot provenance. */
  sha256: string;
  /** The page's machine-assist translation label, or `null` if absent. */
  machineAssist: MachineAssistLabel | null;
}

/** Inputs the colophon is assembled from. */
export interface ColophonInput {
  /** The built source id (`ColophonMeta.snapshotSourceId`). */
  sourceId: string;
  /** The item id, used only to name the item in error messages. */
  itemId: string;
  /** The pinned archive ref (`site/data/archive-source.json` `.ref`). */
  archiveRef: string;
  /** The item's pages, in source order. */
  pages: ColophonPageInput[];
  /**
   * The edition's resolved reading language (spec 015, FR-013) -- selects
   * which disclosure is mandatory: `french` requires a machine-assist label
   * (spec-014 safety net, unchanged); `english` requires `ocrTranscription`.
   */
  readingLanguage: ReadingLanguage;
  /**
   * English-path OCR-transcription disclosure inputs (engine/status + an
   * optional low-fidelity caveat). REQUIRED (non-null, non-empty
   * `engineStatus`) when `readingLanguage === 'english'` -- an English source
   * with no disclosure inputs throws (Principle V, no silent empty
   * disclosure). Ignored when `readingLanguage === 'french'` (French carries
   * `translation` instead). Source: `archive-edition.ts`'s lead folio
   * provenance.
   */
  ocrTranscription: OcrTranscription | null;
}

/** The FRENCH branch (spec 014, unchanged): require a machine-assist label. */
function assembleFrenchColophon(
  sourceId: string,
  itemId: string,
  archiveRef: string,
  images: ColophonImage[],
  pages: ColophonPageInput[],
): ColophonMeta {
  // The machine-assist label is mandatory (Principle III / IV): use the first
  // page that carries one. A translation label is edition-level metadata, so a
  // single present label labels the whole edition; a total absence throws.
  const translation = pages.map((page) => page.machineAssist).find((label) => label !== null);
  if (translation === undefined || translation === null) {
    throw new Error(
      `assembleColophon(${sourceId}/${itemId}): no page carries a machine-assist translation ` +
        'label (engine/model/retrieved). The label is mandatory -- a translation may not be ' +
        'emitted unlabelled (FR-005, Principle III).',
    );
  }

  return {
    archiveRef,
    snapshotSourceId: sourceId,
    images,
    translation,
    ocrTranscription: null,
    framing: EVIDENCE_FRAMING,
  };
}

/**
 * The ENGLISH branch (spec 015, FR-013): no machine-assist label is expected
 * (no translation was performed) -- instead require an honest
 * OCR-transcription disclosure.
 */
function assembleEnglishColophon(
  sourceId: string,
  itemId: string,
  archiveRef: string,
  images: ColophonImage[],
  ocrTranscription: OcrTranscription | null,
): ColophonMeta {
  if (ocrTranscription === null || ocrTranscription.engineStatus.trim().length === 0) {
    throw new Error(
      `assembleColophon(${sourceId}/${itemId}): English source has no OCR-transcription ` +
        'disclosure (engine/status). The disclosure is mandatory -- an English edition may not ' +
        'be emitted with no honest account of how its reading recto was produced (FR-013, ' +
        'Principle V).',
    );
  }

  return {
    archiveRef,
    snapshotSourceId: sourceId,
    images,
    translation: null,
    ocrTranscription,
    framing: EVIDENCE_FRAMING,
  };
}

/**
 * Assemble the colophon. Throws on a missing pin ref; throws on a French
 * source with a total absence of machine-assist labels (spec-014 safety net);
 * throws on an English source with no OCR-transcription disclosure inputs
 * (see module doc).
 */
export function assembleColophon(input: ColophonInput): ColophonMeta {
  const { sourceId, itemId, archiveRef, pages, readingLanguage, ocrTranscription } = input;

  if (archiveRef.trim().length === 0) {
    throw new Error(
      `assembleColophon(${sourceId}/${itemId}): archiveRef is empty -- the pinned archive ` +
        'commit (site/data/archive-source.json `.ref`) is required; the build is not ' +
        'reproducible without it (data-model.md G-5).',
    );
  }

  const images: ColophonImage[] = pages.map((page) => ({
    folioId: page.folioId,
    objectStoreKey: page.objectStoreKey,
    sha256: page.sha256,
  }));

  return readingLanguage === 'english'
    ? assembleEnglishColophon(sourceId, itemId, archiveRef, images, ocrTranscription)
    : assembleFrenchColophon(sourceId, itemId, archiveRef, images, pages);
}
