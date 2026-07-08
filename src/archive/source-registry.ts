/**
 * Per-source provenance metadata that is NOT derivable from the host response
 * or the on-disk layout: the human title, primary language, and the holding
 * archive label recorded in every asset's companion YAML (FR-007).
 *
 * The archive directory layout (case / type / slug) lives in
 * `@/archive/location`; this registry carries only the descriptive fields.
 * Extended per source as new sources are onboarded. An unregistered source ID
 * throws (fail loud) -- there is no default metadata.
 */

export interface SourceMeta {
  /** Human title of the source, e.g. La Nouvelle France's full masthead. */
  title: string;
  /** Primary language, e.g. `French`. */
  language: string;
  /** Holding digital archive label, e.g. `Gallica / BnF`. */
  sourceArchive: string;
}

const SOURCE_META: Readonly<Record<string, SourceMeta>> = {
  'PB-P001': {
    title:
      'La Nouvelle France : journal de la colonie libre de Port-Breton, Océanie',
    language: 'French',
    sourceArchive: 'Gallica / BnF',
  },
  'PB-P002': {
    title: 'Nouvelle-France : Colonie libre de Port-Breton, Océanie',
    language: 'French',
    sourceArchive: 'Gallica / BnF',
  },
  'PB-P003': {
    title:
      "L'aventure de Port-Breton et la colonie libre dite Nouvelle-France",
    language: 'French',
    sourceArchive: 'Gallica / BnF',
  },
};

/** Descriptive provenance metadata for a source ID (throws if unregistered). */
export function sourceMeta(sourceId: string): SourceMeta {
  const meta = SOURCE_META[sourceId];
  if (meta === undefined) {
    throw new Error(
      `sourceMeta: no provenance metadata registered for source "${sourceId}"`,
    );
  }
  return meta;
}
