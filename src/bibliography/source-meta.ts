import path from 'node:path';
import { loadSourceFile } from '@/bibliography/load';

/**
 * Holding archive label of the Gallica copy record (FR-007's `source_archive`
 * for the Gallica fetch pipeline). The fetch core only ever acquires pages
 * from Gallica, so `sourceDescriptor` always resolves this specific copy's
 * label rather than an arbitrary repository record.
 */
const GALLICA_ARCHIVE_LABEL = 'Gallica / BnF';

/**
 * Descriptive provenance metadata for one source, sourced from the SSOT
 * (`bibliography/sources/<sourceId>.yml`) rather than the hardcoded per-source
 * map this replaces (T029).
 */
export interface SourceDescriptor {
  /** The source's canonical title (falls back to its first title). */
  title: string;
  /** Primary language, e.g. `French`. */
  language: string;
  /** Holding archive label of the Gallica copy, e.g. `Gallica / BnF`. */
  sourceArchive: string;
}

/**
 * Resolve the descriptive provenance fields (title / language / holding
 * archive) the Gallica fetch pipeline stamps into every asset's companion
 * YAML (FR-007), reading the SSOT instead of a hardcoded registry.
 *
 * Fails loud (throws), matching the retired registry's posture -- there is
 * no fallback or default:
 * - the SSOT file itself is unreadable/malformed (via {@link loadSourceFile}),
 * - the source has no titles (already enforced by {@link loadSourceFile}
 *   rule 2, but guarded here too since `.find`'s result is not narrowed),
 * - the source has no `language`,
 * - the source has no `Gallica / BnF` repository record.
 */
export function sourceDescriptor(repoRoot: string, sourceId: string): SourceDescriptor {
  const filePath = path.join(repoRoot, 'bibliography', 'sources', `${sourceId}.yml`);
  const { source, records } = loadSourceFile(filePath);

  const canonicalTitle =
    source.titles.find((title) => title.role === 'canonical') ?? source.titles[0];
  if (canonicalTitle === undefined) {
    throw new Error(`sourceDescriptor(${sourceId}): source has no titles`);
  }

  if (source.language === undefined) {
    throw new Error(`sourceDescriptor(${sourceId}): source has no language`);
  }

  const gallicaRecord = records.find((record) => record.sourceArchive === GALLICA_ARCHIVE_LABEL);
  if (gallicaRecord === undefined) {
    throw new Error(
      `sourceDescriptor(${sourceId}): no "${GALLICA_ARCHIVE_LABEL}" repository record`,
    );
  }

  return {
    title: canonicalTitle.text,
    language: source.language,
    sourceArchive: gallicaRecord.sourceArchive,
  };
}
