/**
 * A Gallica-held work being mirrored.
 *
 * See specs/001-gallica-fetcher/data-model.md § Source.
 */
export interface Source {
  /** Colony Cults ID, e.g. `PB-P001`. */
  sourceId: string;
  /** Human title, e.g. `La Nouvelle France`. */
  title: string;
  /** Periodical ark (`cb…`) or monograph ark (`bpt6k…`). */
  gallicaArk: string;
  /** Determines whether a census is built. */
  kind: 'periodical' | 'monograph';
}
