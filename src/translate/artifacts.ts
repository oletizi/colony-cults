import path from 'node:path';
import type { ProvenanceFields } from '@/archive/provenance';

/** Target language of a translation artifact. */
export type ArtifactLanguage = 'fr' | 'en';

/** Which pass produced a {@link ProvenanceFields}-bearing artifact (data-model.md TranslationArtifact.kind). */
export type TranslationKind = 'corrected-french' | 'english';

/**
 * Absolute path of the whole-issue assembled artifact:
 * `<issueDir>/issue.fr.txt` or `<issueDir>/issue.en.txt`
 * (data-model.md "Whole-issue assembly").
 */
export function issueArtifactPath(issueDir: string, lang: ArtifactLanguage): string {
  return path.join(issueDir, `issue.${lang}.txt`);
}

/**
 * Absolute path of one page's per-page intermediate artifact:
 * `<issueDir>/translation/pNNN.fr.txt` or `.../pNNN.en.txt`, where `NNN` is
 * `pageNumber` zero-padded to 3 digits (page 1 -> `p001`, page 12 -> `p012`).
 * Page numbers of 1000+ are NOT truncated -- padding is a minimum width, so
 * e.g. page 1234 -> `p1234` (data-model.md PageChunk.pageNumber is 1-based
 * and unbounded; the archive's page counts never approach 4 digits in
 * practice, but this keeps the helper honest rather than silently
 * corrupting a path).
 */
export function pageArtifactPath(
  issueDir: string,
  pageNumber: number,
  lang: ArtifactLanguage,
): string {
  const padded = String(pageNumber).padStart(3, '0');
  return path.join(issueDir, 'translation', `p${padded}.${lang}.txt`);
}

/**
 * Build a NEW {@link ProvenanceFields} record for a translation artifact
 * (data-model.md "Provenance additions (translation-specific)"), derived from
 * the source page's provenance `base` without mutating it.
 *
 * Field-by-field mapping:
 * - `engine`: the selected engine's provenance label (`engineName`), passed in
 *   by the caller (e.g. `'claude-code-cli'`, `'codex-cli'`) so the record names
 *   the engine that actually ran, not a hardcoded constant.
 * - `translation`: constant `'machine-assisted'` (FR-007).
 * - `model` / `retrieved`: the run's resolved `--model` and injected clock,
 *   passed in by the caller (never read from `base`, which describes the
 *   SOURCE page fetch, not this derived artifact).
 * - `type`: `'corrected-french-text'` or `'english-translation'` per `kind`.
 * - `format`: fixed `'text/plain'` (these are text artifacts, never images).
 * - `language`: for `'corrected-french'` the text is still in the source
 *   language, so it is carried from `base.language` (e.g. `'French'`); for
 *   `'english'` it is always overridden to `'English'`.
 * - `title` / `catalog_url`: the original-language citation, carried
 *   verbatim from `base` (data-model.md table).
 * - `rights_status`: copied from `base` -- the caller is responsible for
 *   refusing the run when this is not `'public-domain'` (FR-008); this
 *   function only carries the value through, it does not enforce the gate.
 * - `id` / `case` / `source_archive` / `original_url` / `notes` /
 *   `rights_raw`: carried as-is from `base` -- there is no separate identity
 *   for a derived text artifact, so it inherits the source page's.
 * - `local_path` / `sha256`: carried from `base` as PLACEHOLDERS ONLY.
 *   `storeAsset` (src/archive/store.ts) always overwrites both from the
 *   actual bytes and target path at write time, so whatever is set here is
 *   never what ends up on disk -- callers must go through `storeAsset`
 *   rather than trusting these two fields from this function's return value.
 * - `ocr_status`: carried from `base` (the source page's OCR outcome, e.g.
 *   `'searchable'`); there is no separate OCR step for a translation
 *   artifact, so the source page's status is the only meaningful value to
 *   propagate.
 */
export function buildTranslationProvenance(
  base: ProvenanceFields,
  kind: TranslationKind,
  engineName: string,
  model: string,
  retrieved: string,
): ProvenanceFields {
  return {
    id: base.id,
    title: base.title,
    type: kind === 'corrected-french' ? 'corrected-french-text' : 'english-translation',
    case: base.case,
    language: kind === 'corrected-french' ? base.language : 'English',
    source_archive: base.source_archive,
    catalog_url: base.catalog_url,
    original_url: base.original_url,
    rights_status: base.rights_status,
    retrieved,
    local_path: base.local_path,
    sha256: base.sha256,
    format: 'text/plain',
    ocr_status: base.ocr_status,
    engine: engineName,
    model,
    translation: 'machine-assisted',
    notes: base.notes,
    rights_raw: base.rights_raw,
  };
}
