/**
 * Assemble the {@link ColophonMeta} back matter for one Edition (T012, spec
 * 007): the reproducibility record (pinned archive ref + per-image
 * key/checksum), the mandatory machine-assist translation label, and the fixed
 * critical-framing statement.
 *
 * Fail-loud (data-model.md G-5 / FR-005, Principle III):
 *  - `archiveRef` must be non-empty (a build with no pin is not reproducible).
 *  - at least one page must carry a machine-assist translation label -- the
 *    label is mandatory, so an item whose pages carry none throws rather than
 *    emitting an unlabelled translation.
 *
 * Pure data assembly -- no image bytes, no I/O.
 */

import type { ColophonImage, ColophonMeta, MachineAssistLabel } from '@/pdf/model';

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
}

/**
 * Assemble the colophon. Throws on a missing pin ref or a total absence of
 * machine-assist labels (see module doc).
 */
export function assembleColophon(input: ColophonInput): ColophonMeta {
  const { sourceId, itemId, archiveRef, pages } = input;

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
    framing: EVIDENCE_FRAMING,
  };
}
