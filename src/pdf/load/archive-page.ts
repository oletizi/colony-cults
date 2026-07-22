/**
 * Per-page content assembly for the archive-direct PDF reader (spec 014,
 * Decision 4 / FR-006/FR-007/FR-008/FR-011; spec 015 English-source routing,
 * FR-002/FR-003/FR-004/FR-007/FR-014).
 *
 * Given one {@link ArchivePageSource} (a folio at a known POSITION in its
 * source's sorted folio sequence) plus the source's already-split `issue.txt`
 * OCR segments, this branches on the source's {@link ReadingLanguage}:
 *
 *  - FRENCH path (unchanged from spec 014): reads the page's OCR French, its
 *    English translation, and the translation-provenance marker.
 *  - ENGLISH path (spec 015): reads the page's OCR text (corrected
 *    `pNNN.fr.txt` if present, else the positional `issue.txt` segment) as the
 *    reading recto -- `resolveTranslation` is never called, no `translation/`
 *    artifact is read. See `specs/015-english-source-pdf/contracts/
 *    reader-language-routing.md` for the field-placement contract.
 *
 * The load-bearing fix (spec 014): the page id (`pNNN`) is derived from the
 * folio's POSITION, never its absolute number -- so a page-range extract
 * (folios `f048..f050`) maps to `p001..p003`, resolving the mapping bug in
 * `@/browser/load/translation` (which keys `fNNN -> p<folioNum>`).
 *
 * Fail-loud, no fallbacks: on the FRENCH path, an absent translation artifact
 * or an inconsistent label/text pairing throws naming the page; empty OCR
 * throws too -- UNLESS the page is `untranslatable` (a blank/cover/plate page
 * has neither OCR nor translation, and renders as a blank recto). On the
 * ENGLISH path, empty/absent OCR throws naming the page -- UNLESS the folio's
 * provenance carries `blank_recto: true` (FR-014, the English analog of
 * `untranslatable`), in which case empty OCR is tolerated and the page
 * renders as a blank recto; a `blank_recto`-marked page with NON-empty OCR
 * throws instead (a page is a plate XOR a text page).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProvenanceFields } from '@/archive/provenance';
import { readProvenance } from '@/archive/provenance';
import type { ArchivePageSource, ReadingLanguage } from '@/pdf/load/archive-source';
import type { MachineAssistLabel } from '@/pdf/model';

/** The two provenance translation labels this reader understands (FR-007). */
type TranslationLabel = 'machine-assisted' | 'untranslatable';

/**
 * One page's assembled content -- the intermediate the edition assembler turns
 * into an `EditionPage` (its image is fetched separately from the folio's
 * `objectStoreKey`/`imageSha256`).
 */
export interface ArchivePageContent {
  /** Extract-safe page id: `p` + zero-padded POSITION (NOT the folio number). */
  pageId: string;
  /** Folio id as it appears in the sidecar filename, e.g. `f048`. */
  folioId: string;
  /**
   * FRENCH path: corrected French if present, else the position-th
   * `issue.txt` segment. Non-empty for a normal page; empty ONLY for an
   * `untranslatable` blank/cover page (which has neither OCR nor translation).
   *
   * ENGLISH path (spec 015): always `""` -- there is no French OCR on this
   * path, and the english-only Typst variant does not render this field.
   */
  ocrFrench: string;
  /**
   * FRENCH path: the English translation. Empty string ONLY for an
   * `untranslatable`-labeled page (the blank-column marker, FR-007);
   * non-empty otherwise.
   *
   * ENGLISH path (spec 015): the page's OCR text (corrected `pNNN.fr.txt` if
   * present, else the positional `issue.txt` segment) -- the reading recto.
   * This is the load-bearing placement: the english-only Typst variant
   * (`showFrench = false`) renders `english` as the single reading column, so
   * the English OCR MUST be carried here (never `ocrFrench`) to render.
   */
  english: string;
  /**
   * True for a blank-recto page (the blank-column marker). On the FRENCH path,
   * that is a page whose translation artifact is labeled `untranslatable`. On
   * the ENGLISH path (which has no translation dimension), it is a folio marked
   * `blank_recto` in its provenance -- an intentionally-blank plate/cover/blank
   * leaf (FR-014, T015); a normal English text page is `false`.
   */
  untranslatable: boolean;
  /**
   * The machine-assist label from the EN sidecar, or `null` (honest absence).
   * Always `null` on the ENGLISH path -- no translation is performed there.
   */
  machineAssist: MachineAssistLabel | null;
  /**
   * Surfaced OCR-condition apparatus note from the folio provenance, or
   * `null`. Carried through unchanged on both the FRENCH and ENGLISH paths.
   */
  ocrCondition: string | null;
}

/** `p` + the position zero-padded to three digits (`1 -> p001`, `48 -> p048`). */
function pageIdForPosition(position: number): string {
  return `p${String(position).padStart(3, '0')}`;
}

/** A non-empty, trimmed string, or `null` when absent/blank. */
function nonEmptyOrNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  return value.trim().length > 0 ? value : null;
}

/**
 * Machine-assist label from the EN sidecar provenance (honest absence): `null`
 * unless BOTH `engine` and `retrieved` are present, mirroring
 * `@/browser/load/translation` `loadMachineAssist` -- never fabricates a label.
 */
function deriveMachineAssist(prov: ProvenanceFields): MachineAssistLabel | null {
  const engine = nonEmptyOrNull(prov.engine);
  const retrieved = nonEmptyOrNull(prov.retrieved);
  if (engine === null || retrieved === null) {
    return null;
  }
  return { engine, model: nonEmptyOrNull(prov.model), retrieved };
}

/**
 * Surface an OCR apparatus note from the folio provenance: a failed OCR status
 * or a sub-`high` computed quality tier become a note; a clean OCR yields
 * `null`. No note is fabricated when the provenance carries no signal.
 */
function deriveOcrCondition(prov: ProvenanceFields): string | null {
  if (prov.ocr_status === 'failed') {
    return 'OCR failed';
  }
  const quality = prov.ocr_quality;
  if (quality !== undefined && quality.tier !== 'high') {
    return `OCR quality: ${quality.tier}`;
  }
  return null;
}

/**
 * Resolve the page's OCR text: corrected `pNNN.fr.txt` if present, else the
 * segment. Shared by both reading-language paths: the FRENCH path uses the
 * result as `ocrFrench`; the ENGLISH path (spec 015) uses the identical
 * corrected-then-positional resolution as the reading recto (`english`) --
 * see `resolveArchiveSource` FR-004.
 *
 * `allowEmpty` is true for an `untranslatable`-labeled page (FRENCH path
 * only): a blank / cover / plate page legitimately has NO OCR text (and no
 * translation), so an empty OCR is the blank-recto marker, not a gap. For a
 * `machine-assisted` page (real translated text) or any ENGLISH-path page,
 * empty OCR is a genuine gap and fails loud (FR-007).
 */
async function resolveOcrFrench(
  translationDir: string,
  pageId: string,
  folioId: string,
  segments: string[],
  position: number,
  allowEmpty: boolean,
): Promise<string> {
  const frTextPath = path.join(translationDir, `${pageId}.fr.txt`);
  const ocrFrench = existsSync(frTextPath)
    ? await readFile(frTextPath, 'utf-8')
    : segments[position - 1];

  if (ocrFrench === undefined || ocrFrench.trim().length === 0) {
    if (allowEmpty) {
      // Blank/untranslatable page: no OCR text, render an empty recto column.
      return '';
    }
    throw new Error(
      `loadArchivePage: no OCR French for page "${pageId}" (folio ${folioId}) -- ` +
        `neither ${frTextPath} nor issue.txt segment #${position} yielded text`,
    );
  }
  return ocrFrench;
}

/**
 * Resolve the English + untranslatable marker for a page from its `.en.txt`
 * and provenance sidecar (`.en.txt.yml`).
 *
 * @throws Error, naming the page, when the artifact is absent (FR-008), when
 *   the sidecar label is unrecognized, or when label and text disagree
 *   (the empty ⟺ untranslatable invariant).
 */
async function resolveTranslation(
  translationDir: string,
  pageId: string,
  folioId: string,
): Promise<{ english: string; untranslatable: boolean; provenance: ProvenanceFields }> {
  const enTextPath = path.join(translationDir, `${pageId}.en.txt`);
  const enSidecarPath = path.join(translationDir, `${pageId}.en.txt.yml`);

  if (!existsSync(enTextPath) || !existsSync(enSidecarPath)) {
    throw new Error(
      `loadArchivePage: no translation artifact for page "${pageId}" (folio ${folioId}) -- ` +
        `expected ${enTextPath} and ${enSidecarPath} (FR-008 translation gap)`,
    );
  }

  const rawEnglish = await readFile(enTextPath, 'utf-8');
  const provenance = await readProvenance(enSidecarPath);
  const label = provenance.translation;
  const isEmpty = rawEnglish.trim().length === 0;

  if (label !== 'machine-assisted' && label !== 'untranslatable') {
    throw new Error(
      `loadArchivePage: page "${pageId}" (folio ${folioId}) has an unrecognized or absent ` +
        `translation label ${JSON.stringify(label ?? null)} in ${enSidecarPath} ` +
        `(expected "machine-assisted" or "untranslatable")`,
    );
  }

  return interpretLabel(label, isEmpty, rawEnglish, pageId, folioId, enTextPath, provenance);
}

/** Apply the empty ⟺ untranslatable invariant, failing loud on disagreement. */
function interpretLabel(
  label: TranslationLabel,
  isEmpty: boolean,
  rawEnglish: string,
  pageId: string,
  folioId: string,
  enTextPath: string,
  provenance: ProvenanceFields,
): { english: string; untranslatable: boolean; provenance: ProvenanceFields } {
  if (label === 'untranslatable') {
    if (!isEmpty) {
      throw new Error(
        `loadArchivePage: inconsistent translation for page "${pageId}" (folio ${folioId}) -- ` +
          `labeled "untranslatable" but ${enTextPath} is non-empty (empty ⟺ untranslatable invariant)`,
      );
    }
    return { english: '', untranslatable: true, provenance };
  }

  if (isEmpty) {
    throw new Error(
      `loadArchivePage: inconsistent translation for page "${pageId}" (folio ${folioId}) -- ` +
        `labeled "machine-assisted" but ${enTextPath} is empty (empty ⟺ untranslatable invariant)`,
    );
  }
  return { english: rawEnglish, untranslatable: false, provenance };
}

/**
 * Read the folio sidecar's provenance (`fNNN.yml`), or `null` when absent.
 * Shared read for both reading-language paths -- the ENGLISH path (spec 015,
 * FR-014) also needs `blank_recto` off this same record, so it reads the
 * sidecar once and derives both `ocrCondition` and the blank/plate marker
 * from it (see {@link loadEnglishPage}), rather than reading it twice.
 */
async function readFolioProvenance(page: ArchivePageSource): Promise<ProvenanceFields | null> {
  const folioSidecarPath = path.join(page.pageDir, `${page.folioId}.yml`);
  return existsSync(folioSidecarPath) ? readProvenance(folioSidecarPath) : null;
}

/** The folio's surfaced OCR-condition apparatus note, derived from an already-read provenance (or `null`). */
function ocrConditionOf(provenance: ProvenanceFields | null): string | null {
  return provenance === null ? null : deriveOcrCondition(provenance);
}

/** The folio's surfaced OCR-condition apparatus note, shared by both reading-language paths. */
async function resolveOcrCondition(page: ArchivePageSource): Promise<string | null> {
  return ocrConditionOf(await readFolioProvenance(page));
}

/**
 * FRENCH path (spec 014, unchanged): FR-OCR left column, required EN
 * translation right column.
 *
 * @throws Error, naming the page, on an absent translation artifact (FR-008),
 *   an inconsistent label/text pairing, or empty OCR French.
 */
async function loadFrenchPage(
  pageId: string,
  page: ArchivePageSource,
  translationDir: string,
  issueOcrSegments: string[],
): Promise<ArchivePageContent> {
  // Resolve the translation FIRST: an `untranslatable` page (a blank/cover/plate)
  // legitimately has no OCR either, so its untranslatable status governs whether
  // an empty OCR is tolerated (blank recto) or a fail-loud gap.
  const { english, untranslatable, provenance } = await resolveTranslation(
    translationDir,
    pageId,
    page.folioId,
  );

  const ocrFrench = await resolveOcrFrench(
    translationDir,
    pageId,
    page.folioId,
    issueOcrSegments,
    page.position,
    untranslatable,
  );

  return {
    pageId,
    folioId: page.folioId,
    ocrFrench,
    english,
    untranslatable,
    machineAssist: deriveMachineAssist(provenance),
    ocrCondition: await resolveOcrCondition(page),
  };
}

/**
 * ENGLISH path (spec 015, FR-002/FR-003/FR-004): the page's OCR text IS the
 * reading recto -- `resolveTranslation` is never called, no `translation/
 * pNNN.en.txt` is read. The English OCR is carried in `english` (not
 * `ocrFrench`), since the english-only Typst variant renders `english` as the
 * single reading column (see `ArchivePageContent.english` doc).
 *
 * Blank/plate marker (FR-014, contract C10): the folio's provenance
 * (`fNNN.yml`) is read ONCE here and used for both `ocrCondition` and the
 * `blank_recto` marker. A `blank_recto: true` folio TOLERATES empty OCR
 * (`allowEmpty = true` on the shared OCR resolution) and produces the SAME
 * blank-recto content the FRENCH `untranslatable` page produces
 * (`untranslatable = true`, `english = ''`), reusing spec 014's existing
 * blank-recto rendering with no template change. An UNMARKED page is
 * unchanged: `allowEmpty = false`, so empty/absent OCR still fails loud
 * (FR-007).
 *
 * @throws Error, naming the page, when:
 *   - the page is UNMARKED and the resolved English OCR is empty/absent
 *     (FR-007 / contract C5) -- no `untranslatable` dimension applies here;
 *   - the page IS `blank_recto`-marked but its resolved OCR is NON-empty (a
 *     page is a plate XOR a text page, FR-014 / contract C10).
 */
async function loadEnglishPage(
  pageId: string,
  page: ArchivePageSource,
  translationDir: string,
  issueOcrSegments: string[],
): Promise<ArchivePageContent> {
  const folioProvenance = await readFolioProvenance(page);
  const ocrCondition = ocrConditionOf(folioProvenance);
  const blankRecto = folioProvenance?.blank_recto === true;

  const english = await resolveOcrFrench(
    translationDir,
    pageId,
    page.folioId,
    issueOcrSegments,
    page.position,
    blankRecto, // allowEmpty: true ONLY for a blank_recto-marked plate (FR-014); FR-007 unchanged otherwise.
  );

  if (blankRecto) {
    if (english.trim().length > 0) {
      throw new Error(
        `loadArchivePage: inconsistent blank_recto for page "${pageId}" (folio ${page.folioId}) -- ` +
          `marked blank_recto but OCR is non-empty (a page is a plate XOR a text page, FR-014)`,
      );
    }
    return {
      pageId,
      folioId: page.folioId,
      ocrFrench: '',
      english: '',
      untranslatable: true,
      machineAssist: null,
      ocrCondition,
    };
  }

  return {
    pageId,
    folioId: page.folioId,
    ocrFrench: '',
    english,
    untranslatable: false,
    machineAssist: null,
    ocrCondition,
  };
}

/**
 * Assemble one page's content, keyed by the folio's POSITION, branching on
 * the source's {@link ReadingLanguage} (spec 015, FR-001/FR-002/FR-005).
 *
 * @param page - the folio source (carries `position`, `folioId`, `pageDir`).
 * @param issueOcrSegments - the source's `issue.txt` split ONCE by the caller
 *   (`splitIssueOcr(...).map(p => p.ocrFrench)`); the `position`-th segment is
 *   the OCR fallback when no corrected `pNNN.fr.txt` exists.
 * @param readingLanguage - the source's resolved reading-language path
 *   (`resolveArchiveSource`'s `readingLanguage`). Required -- no default, so a
 *   caller can never silently fall onto one path.
 *
 * @throws Error, naming the page, on a FRENCH-path absent translation
 *   artifact (FR-008), an inconsistent label/text pairing, or empty OCR
 *   French; or on an ENGLISH-path page with empty/absent OCR (FR-007).
 */
export async function loadArchivePage(
  page: ArchivePageSource,
  issueOcrSegments: string[],
  readingLanguage: ReadingLanguage,
): Promise<ArchivePageContent> {
  const pageId = pageIdForPosition(page.position);
  const translationDir = path.join(page.pageDir, 'translation');

  return readingLanguage === 'english'
    ? loadEnglishPage(pageId, page, translationDir, issueOcrSegments)
    : loadFrenchPage(pageId, page, translationDir, issueOcrSegments);
}
