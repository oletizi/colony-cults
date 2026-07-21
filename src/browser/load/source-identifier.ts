/**
 * The archival source identifier for a folio, derived from its sidecar
 * `catalog_url`.
 *
 * A Gallica `catalog_url` (`https://gallica.bnf.fr/ark:/12148/bpt6k58039518`)
 * carries an `ark:/…` -- the compact archival identifier. A non-Gallica archive
 * (e.g. the Internet Archive, `https://archive.org/details/<id>`) has no ark, so
 * the `catalog_url` itself IS the identifier.
 *
 * Either way every page image is served from OUR archive via its `object_store`
 * key through the CDN (the `b2-cdn` provider), so this identifier is provenance
 * only -- never an image-resolution dependency. Because we no longer resolve
 * images from the ark, a source without a Gallica ark is fully browsable; this
 * function is therefore TOTAL (never throws) where the old ark-only parse failed
 * loud on any non-Gallica archive.
 *
 * Deterministic: the same `catalog_url` always yields the same identifier, so
 * the resolved book/issue identifier and the per-page provenance identifier
 * (both derived from the same sidecar `catalog_url`) always agree.
 */
export function parseSourceIdentifier(catalogUrl: string): string {
  const ark = catalogUrl.match(/ark:\/\S+/);
  return ark !== null ? ark[0] : catalogUrl;
}
