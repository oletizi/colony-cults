import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256OfBytes } from '@/archive/checksum';
import { companionYamlPath } from '@/archive/store';
import { readProvenance, type OcrQualityTier } from '@/archive/provenance';
import type { InputLayerOrigin } from '@/archive/provenance-blocks';
import { materializeIssueText } from '@/archive/issue-text-materialize';
import type { ObjectStore } from '@/archive/object-store';
import type { LoadedSource } from '@/bibliography/load';
import { hasDetachedOcrTextAsset, toMemberWithRecords } from '@/summarize/papers-past-input';

/**
 * One input companion consumed to build a summary, and its content sha256 at
 * selection time (research.md Decision 6). This is BOTH the shape fed into
 * `SummaryResult` generation (via {@link SelectedSummaryInput.text}) AND the
 * source of a summary provenance sidecar's `input_layers` (FR-005) -- the
 * idempotency key (Decision 4). `path` is relative to the issue directory
 * (e.g. `issue.txt`, `issue.en.txt`) -- for a source-group member (Papers
 * Past) the detached `ocr-text` asset is first materialized into that same
 * `issue.txt` by `materializeIssueText`, so the summarizer never references the
 * raw B2 object-store key. `origin` attributes the layer honestly (FR-021):
 * our own OCR/translation, or source-downloaded Papers Past OCR -- and is now
 * DERIVED from the materialized `issue.txt`'s companion `source_representation`
 * rather than a hardcoded source-family branch.
 */
export interface SelectedInputLayer {
  readonly path: string;
  readonly sha256: string;
  readonly origin: InputLayerOrigin;
  readonly sourceRepresentation?: string;
}

/**
 * Low-confidence input-quality note (FR-016), surfaced when the input OCR's
 * companion YAML records `ocr_quality.tier === 'low'`. Mirrors
 * `ProvenanceFields.input_quality` (`src/archive/provenance.ts`) so
 * `src/summarize/artifacts.ts` (T017) can pass this straight through into the
 * summary's provenance sidecar without re-shaping it.
 */
export interface SummaryInputQuality {
  readonly tier: OcrQualityTier;
  readonly note: string;
}

/**
 * The result of best-available-text selection for one issue (FR-002/FR-003):
 * the input companion(s) actually used (for provenance + idempotency), the
 * combined text to feed the summarizer, and an optional low-confidence note.
 */
export interface SelectedSummaryInput {
  /** Input companion(s) used, in the order concatenated into `text`. */
  readonly layers: readonly SelectedInputLayer[];
  /** The text to summarize -- either `issue.txt` alone, or both layers combined (see below). */
  readonly text: string;
  /** Present only when the input OCR's recorded quality tier is `low` (FR-016). */
  readonly inputQuality?: SummaryInputQuality;
}

const FRENCH_OCR_FILENAME = 'issue.txt';
const ENGLISH_TRANSLATION_FILENAME = 'issue.en.txt';

/**
 * Combined-text format when BOTH the French OCR and its English translation
 * are used as input (research.md Decision 6, AC-2): two clearly delimited
 * sections, French OCR first (the original-language source), then the
 * English translation, so a reader -- human or the summarization LLM -- can
 * unambiguously tell which section is which and never mistake one language
 * for the other. Mirrors the "BEGIN/END SOURCE DOCUMENT TEXT" delimiter
 * convention already used by `buildSummaryPrompt` (`src/summarize/prompt.ts`),
 * which wraps whatever text this function returns.
 */
function combineFrenchAndEnglish(frenchText: string, englishText: string): string {
  return (
    `=== FRENCH OCR TEXT (original-language source) ===\n${frenchText}\n\n` +
    `=== ENGLISH TRANSLATION (of the French OCR text above) ===\n${englishText}`
  );
}

/** Read a file's bytes and its sha256 in one pass (reuses the archive layer's sha helper). */
async function readWithSha(
  filePath: string,
): Promise<{ text: string; bytes: Uint8Array; sha256: string }> {
  const bytes = await readFile(filePath);
  return { text: bytes.toString('utf-8'), bytes, sha256: sha256OfBytes(bytes) };
}

/**
 * True when `text` has no non-whitespace content -- covers both a
 * truly-empty (0-byte) file and a whitespace-only one (spaces, tabs,
 * newlines left behind by a failed/truncated OCR or translation run).
 * A file in either state is an unusable text layer even though it exists.
 */
function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Best-effort read of the French-OCR companion's low-confidence quality note
 * (FR-016): returns `undefined` whenever there is nothing to surface --
 * `issue.txt` has no companion YAML yet, the companion is unreadable, it has
 * no `ocr_quality` block, or the tier is not `low`. This mirrors
 * `readProvenanceSafe` (`src/archive/store.ts`, not exported): a missing or
 * malformed sidecar here is NOT a fail-loud condition -- the low-confidence
 * note is a value-add annotation (FR-016), not a precondition for
 * summarization, which must proceed regardless of OCR quality.
 */
async function readInputQuality(frenchOcrPath: string): Promise<SummaryInputQuality | undefined> {
  const yamlPath = companionYamlPath(frenchOcrPath);
  if (!existsSync(yamlPath)) {
    return undefined;
  }
  try {
    const provenance = await readProvenance(yamlPath);
    if (provenance.ocr_quality?.tier !== 'low') {
      return undefined;
    }
    return {
      tier: provenance.ocr_quality.tier,
      note:
        `Input OCR quality is low (tier "${provenance.ocr_quality.tier}", ` +
        `real-word ratio ${provenance.ocr_quality.ratio}) -- this summary may inherit OCR errors.`,
    };
  } catch {
    return undefined;
  }
}

/**
 * Derive the honest FR-021 `origin` (and `source_representation`, when present)
 * for the single English-OCR `issue.txt` layer from its companion sidecar --
 * NOT from a hardcoded source-family branch. A source-group member (Papers
 * Past) whose detached ocr-text was just materialized carries
 * `source_representation: papers-past-text-tab` on `issue.txt.yml`, so its
 * layer is attributed as source-downloaded `papers-past-ocr` and that
 * representation is carried through; a project OCR (no such marker) attributes
 * `project-ocr`.
 *
 * Best-effort (never fail-loud): a missing or unreadable companion, or one
 * without a Papers Past `source_representation`, defaults to the conservative
 * honest `project-ocr` -- attribution is a value-add label, never a
 * precondition for summarization.
 */
async function deriveOcrLayerOrigin(
  frenchOcrPath: string,
): Promise<{ origin: InputLayerOrigin; sourceRepresentation?: string }> {
  const yamlPath = companionYamlPath(frenchOcrPath);
  if (!existsSync(yamlPath)) {
    return { origin: 'project-ocr' };
  }
  try {
    const provenance = await readProvenance(yamlPath);
    const representation = provenance.source_representation?.trim();
    if (representation !== undefined && representation.startsWith('papers-past')) {
      return { origin: 'papers-past-ocr', sourceRepresentation: representation };
    }
    return { origin: 'project-ocr' };
  } catch {
    return { origin: 'project-ocr' };
  }
}

/**
 * The source-aware input-selection request (FR-018): input resolution needs the
 * source's IDENTITY + LANGUAGE (the SSOT {@link LoadedSource}), not just a bare
 * `issueDir`, so it routes by source family and never guesses language from
 * which files happen to be present (the AUDIT-17 defect).
 *
 * `archiveRoot` + `objectStore` let a source-group MEMBER (Papers Past) have
 * its detached `ocr-text` asset MATERIALIZED into a standard `issue.txt` (+
 * full-`ProvenanceFields` sidecar) via the canonical `materializeIssueText`
 * mechanism before selection. `objectStore` is the injected reader that
 * fetches the asset's bytes; it is REQUIRED (fail loud) only when a member
 * actually needs materialization -- a Gallica source with an on-disk
 * `issue.txt` never touches it.
 */
export interface SummaryInputRequest {
  readonly issueDir: string;
  readonly source: LoadedSource;
  readonly archiveRoot: string;
  /** Reader `materializeIssueText` fetches a member's `ocr-text` asset through. */
  readonly objectStore?: ObjectStore;
}

/**
 * True when the source is KNOWN to be a non-English (French) work by its SSOT
 * language metadata -- the signal (FR-023 / AUDIT-17) that its raw OCR is NOT
 * English-native and MUST NOT be summarized without an English translation.
 * Absent/unknown language is NOT known-French (it falls through to the legacy
 * present-files behavior, e.g. a monograph whose SSOT omits `language`).
 */
function isKnownFrench(source: LoadedSource): boolean {
  const language = source.source.language?.trim();
  return language !== undefined && language.length > 0 && language !== 'English';
}

/**
 * Select the best-available acquired text for one issue and build the combined
 * summarizer input, SOURCE-AWARE per research.md Decision 6/8 / spec.md
 * FR-002/FR-018..FR-023:
 *
 * 0. **Source-group MEMBER** (a detached `ocr-text` asset AND no on-disk
 *    `issue.txt`, e.g. Papers Past): MATERIALIZE `issue.txt` (+ its full
 *    `ProvenanceFields` sidecar) from the `ocr-text` asset via the canonical
 *    {@link materializeIssueText} mechanism (idempotent, crash-safe,
 *    fail-loud), then fall through to the NORMAL path below. The member's
 *    language is English (the `ocr-text` IS the English OCR; there is no
 *    translation), so it lands in case 4. This replaces the interim Papers
 *    Past adapter that pre-fetched the `.txt` itself: "downstream readers do
 *    not need to know which path produced it."
 * 1. **Translation present** (`issue.en.txt`): use BOTH `issue.txt` (the French
 *    OCR) and `issue.en.txt` -- the {@link combineFrenchAndEnglish} format,
 *    attributed to the project (`project-ocr` + `project-translation`).
 * 2. **Known-French source, translation ABSENT**: FAIL LOUD ("translation
 *    pending") -- never summarize raw French OCR as if English-native (FR-023).
 * 3. **English-native / member / unknown-language source**: `issue.txt` alone,
 *    with the layer `origin` DERIVED from `issue.txt`'s companion
 *    `source_representation` (FR-021) -- `papers-past-text-tab` ->
 *    `papers-past-ocr` (source-downloaded), otherwise `project-ocr`.
 * 4. Else FAIL LOUD (FR-003) -- no usable text layer, no fabricated summary.
 *
 * The member branch WRITES `issue.txt` (+ sidecar) via `materializeIssueText`;
 * every other branch only reads already-acquired inputs from disk.
 */
export async function selectSummaryInput(req: SummaryInputRequest): Promise<SelectedSummaryInput> {
  const { issueDir, source, archiveRoot, objectStore } = req;

  const frenchOcrPath = path.join(issueDir, FRENCH_OCR_FILENAME);
  const translationPath = path.join(issueDir, ENGLISH_TRANSLATION_FILENAME);

  // (0) Source-group MEMBER (Papers Past): its reading text is a detached
  // `ocr-text` asset, not an on-disk issue.txt. Rehydrate it into a standard
  // issue.txt (+ full-ProvenanceFields sidecar) via the CANONICAL mechanism,
  // THEN select via the normal path below. materializeIssueText writes into
  // the member's flat archive dir which -- by the registered layout -- IS this
  // `issueDir` (verified by the dir-match test); it is idempotent, crash-safe,
  // and fail-loud (missing/ambiguous ocr-text asset or checksum mismatch all
  // throw naming the member). The `!existsSync(frenchOcrPath)` guard keeps it a
  // no-op once materialized and never disturbs a source that already has an
  // on-disk issue.txt.
  if (!existsSync(frenchOcrPath) && hasDetachedOcrTextAsset(source)) {
    if (objectStore === undefined) {
      throw new Error(
        `selectSummaryInput: source ${source.source.sourceId} carries a detached ocr-text ` +
          `asset that must be materialized into issue.txt, but no ObjectStore was provided to ` +
          `fetch its bytes -- inject an ObjectStore (tests) or run through the CLI, whose ` +
          `buildSummarizeCliDeps constructs one from the B2 config (no silent skip).`,
      );
    }
    await materializeIssueText(toMemberWithRecords(source), archiveRoot, objectStore);
  }

  const hasTranslation = existsSync(translationPath);
  const hasFrenchOcr = existsSync(frenchOcrPath);

  // (2) Translation present -> combined French OCR + English translation.
  if (hasTranslation) {
    if (!hasFrenchOcr) {
      throw new Error(
        `selectSummaryInput: ${ENGLISH_TRANSLATION_FILENAME} exists in ${issueDir} but its ` +
          `source ${FRENCH_OCR_FILENAME} is missing -- a translation cannot be summarized ` +
          `without the OCR it was derived from`,
      );
    }
    const [french, english] = await Promise.all([
      readWithSha(frenchOcrPath),
      readWithSha(translationPath),
    ]);
    const frenchBlank = isBlank(french.text);
    const englishBlank = isBlank(english.text);
    if (frenchBlank || englishBlank) {
      // Both layers are selected together here (FR-002 Decision 6): a blank
      // half is a broken acquisition, not a usable one-sided fallback -- fail
      // loud rather than silently summarizing from a half-empty combined
      // text (or from an empty text plus the delimiters/instructions alone).
      const reasons: string[] = [];
      if (frenchBlank) {
        reasons.push(`${FRENCH_OCR_FILENAME} (OCR) is present but empty/whitespace-only`);
      }
      if (englishBlank) {
        reasons.push(
          `${ENGLISH_TRANSLATION_FILENAME} (English translation) is present but empty/whitespace-only`,
        );
      }
      throw new Error(
        `selectSummaryInput: no usable text layer found in ${issueDir} -- ${reasons.join(
          ' and ',
        )}; a blank layer indicates failed/truncated OCR or translation -- re-run OCR ` +
          `(and/or translation) for this issue before summarizing (FR-003, fail loud)`,
      );
    }
    const inputQuality = await readInputQuality(frenchOcrPath);
    return {
      layers: [
        { path: FRENCH_OCR_FILENAME, sha256: french.sha256, origin: 'project-ocr' },
        {
          path: ENGLISH_TRANSLATION_FILENAME,
          sha256: english.sha256,
          origin: 'project-translation',
        },
      ],
      text: combineFrenchAndEnglish(french.text, english.text),
      ...(inputQuality !== undefined ? { inputQuality } : {}),
    };
  }

  // (3) AUDIT-17 / FR-023: a KNOWN-FRENCH source with no translation must fail
  // loud -- never fall through to summarizing the raw French OCR as English.
  if (isKnownFrench(source)) {
    throw new Error(
      `selectSummaryInput: source ${source.source.sourceId} is a known-French source but its ` +
        `English translation (${ENGLISH_TRANSLATION_FILENAME}) is absent in ${issueDir} -- ` +
        'translation pending -- cannot summarize a French source without its English ' +
        'translation (FR-023). Run translation for this issue before summarizing.',
    );
  }

  // (4) English-native / MEMBER / unknown-language source: issue.txt (English
  // OCR) alone. For a materialized Papers Past member this issue.txt IS the
  // rehydrated ocr-text; its origin is DERIVED from the companion sidecar's
  // source_representation (FR-021), so the attribution comes from the real
  // record rather than a hardcoded source-family branch.
  if (hasFrenchOcr) {
    const ocr = await readWithSha(frenchOcrPath);
    if (isBlank(ocr.text)) {
      throw new Error(
        `selectSummaryInput: no usable text layer found in ${issueDir} -- ` +
          `${FRENCH_OCR_FILENAME} (OCR) is present but empty/whitespace-only, and ` +
          `${ENGLISH_TRANSLATION_FILENAME} (English translation) is missing; a blank OCR layer ` +
          `indicates failed/truncated OCR -- re-run OCR for this issue before summarizing ` +
          `(FR-003, fail loud)`,
      );
    }
    const inputQuality = await readInputQuality(frenchOcrPath);
    const attribution = await deriveOcrLayerOrigin(frenchOcrPath);
    return {
      layers: [
        {
          path: FRENCH_OCR_FILENAME,
          sha256: ocr.sha256,
          origin: attribution.origin,
          ...(attribution.sourceRepresentation !== undefined
            ? { sourceRepresentation: attribution.sourceRepresentation }
            : {}),
        },
      ],
      text: ocr.text,
      ...(inputQuality !== undefined ? { inputQuality } : {}),
    };
  }

  throw new Error(
    `selectSummaryInput: no usable text layer found in ${issueDir} -- missing both ` +
      `${FRENCH_OCR_FILENAME} (OCR) and ${ENGLISH_TRANSLATION_FILENAME} (English translation); ` +
      `run OCR (and/or translation) for this issue before summarizing (FR-003, fail loud)`,
  );
}
