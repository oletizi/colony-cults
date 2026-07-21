/**
 * Deterministic object-store key + provenance-path helpers for the Papers Past
 * adapter (T010, specs/015-papers-past-acquisition). Mirrors the New Italy
 * Museum key convention (`@/repository/new-italy-museum/adapter`'s
 * `objectKeyForMaster`/`provenancePathForMaster`): a stable `KEY_PREFIX`, the
 * sanitized durable identifier, then the content sha256 -- so the same bytes for
 * the same article always map to the same key (the identity the idempotency seam
 * keys its skip on). Papers Past segments are always GIFs (the `/imageserver/`
 * `ext=gif` facsimile), so the extension is fixed rather than derived.
 */

/** The stable object-store key prefix all Papers Past page-master segments live under. */
const KEY_PREFIX = 'archive/papers-past';

/**
 * Sanitize a Papers Past article code (`oid`, e.g. `HNS18840103.2.19.3`) into a
 * path-safe segment: lowercased, with any character outside `[a-z0-9._-]`
 * replaced by `-`. The dot-separated article code survives intact (dots are
 * allowed), so `HNS18840103.2.19.3` -> `hns18840103.2.19.3`.
 */
function sanitizeArticleId(articleId: string): string {
  return articleId.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

/**
 * The deterministic object-store key for one page-master GIF segment, derived
 * from the sanitized article code and the content sha256. Always `.gif` (the
 * Papers Past `/imageserver/` facsimile is a GIF).
 */
export function objectKeyForSegment(articleId: string, sha256Hex: string): string {
  return `${KEY_PREFIX}/${sanitizeArticleId(articleId)}/${sha256Hex}.gif`;
}

/**
 * The companion provenance path for a page-master segment (mirrors the object
 * key, `.yml`) -- the New Italy Museum `provenancePathForMaster` convention.
 */
export function provenancePathForSegment(articleId: string, sha256Hex: string): string {
  return `${KEY_PREFIX}/${sanitizeArticleId(articleId)}/${sha256Hex}.yml`;
}

/**
 * The deterministic object-store key for the source-OCR text asset extracted
 * from an article's `#text-tab` panel, derived from the sanitized article code
 * and the content sha256. Always `.txt` (the OCR is stored as faithful plain
 * text, not a facsimile image).
 */
export function objectKeyForOcr(articleId: string, sha256Hex: string): string {
  return `${KEY_PREFIX}/${sanitizeArticleId(articleId)}/${sha256Hex}.txt`;
}

/**
 * The companion provenance path for the source-OCR text asset (mirrors the
 * object key, `.yml`) -- the same convention as `provenancePathForSegment`.
 */
export function provenancePathForOcr(articleId: string, sha256Hex: string): string {
  return `${KEY_PREFIX}/${sanitizeArticleId(articleId)}/${sha256Hex}.yml`;
}
