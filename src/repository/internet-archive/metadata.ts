/**
 * `fetchItemMetadata` -- the archive.org item metadata client + typed parse
 * for the Internet Archive acquisition adapter
 * (specs/013-archiveorg-acquisition-path). Fetches
 * `https://archive.org/metadata/<itemId>` via an injected minimal fetch
 * client and parses the response into a typed {@link ItemMetadata}.
 *
 * Fail-loud, no fabrication (Principle V, IA-INV-A): this module never
 * invents an item id, a title, or any other field. An empty/unparseable
 * response, an absent `metadata` object, or a `mediatype` other than
 * `'texts'` (the only media type this adapter handles) THROWS rather than
 * returning a partial or guessed result.
 */

/**
 * The minimal fetch surface this module depends on: fetch a resource as
 * text (the metadata JSON) or as bytes (asset downloads, used elsewhere by
 * the adapter, not here). `@/gallica/http-client`'s `HttpClient` satisfies
 * this structurally (Principle XII), so tests inject a fake and never touch
 * the network.
 */
export interface ArchiveHttpClient {
  /** Fetch a resource and return its body as text. */
  getText(url: string): Promise<string>;
  /** Fetch a resource and return its body as bytes. */
  getBytes(url: string): Promise<Uint8Array>;
}

/** One entry in an archive.org item's top-level `files[]` array. */
export interface ItemFile {
  name: string;
  format: string;
  source: string;
  size?: number;
  md5?: string;
  sha1?: string;
  original?: string;
  filecount?: number;
}

/** The parsed, typed result of `GET https://archive.org/metadata/<itemId>`. */
export interface ItemMetadata {
  identifier: string;
  mediatype: string;
  title: string;
  creator?: string;
  date?: string;
  year?: string;
  possibleCopyrightStatus?: string;
  scanner?: string;
  files: ItemFile[];
  detailsUrl: string;
  metadataEndpoint: string;
  raw: string;
}

/** The only mediatype this adapter handles (FR-002 / IA-INV-A). */
const HANDLED_MEDIATYPE = 'texts';

/** Shape-check helper: is `value` a non-null object (not an array)? */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse the raw JSON `metadata.files[]` entries into typed {@link ItemFile}s,
 * failing loud on a malformed entry rather than silently dropping it --
 * archive.org's numeric-looking fields (`size`, `filecount`) arrive as
 * strings, so they are coerced to numbers here (never left as unconverted
 * strings that would silently fail downstream numeric comparisons).
 */
function parseFiles(itemId: string, rawFiles: unknown): ItemFile[] {
  if (!Array.isArray(rawFiles)) {
    throw new Error(
      `fetchItemMetadata(${itemId}): expected a "files" array in the archive.org response, ` +
        `got ${typeof rawFiles}.`,
    );
  }
  return rawFiles.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new Error(
        `fetchItemMetadata(${itemId}): files[${index}] is not an object -- refusing to guess its shape.`,
      );
    }
    const name = entry.name;
    const format = entry.format;
    const source = entry.source;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(
        `fetchItemMetadata(${itemId}): files[${index}] is missing a non-empty "name".`,
      );
    }
    if (typeof format !== 'string' || format.length === 0) {
      throw new Error(
        `fetchItemMetadata(${itemId}): files[${index}] ("${name}") is missing a non-empty "format".`,
      );
    }
    if (typeof source !== 'string' || source.length === 0) {
      throw new Error(
        `fetchItemMetadata(${itemId}): files[${index}] ("${name}") is missing a non-empty "source".`,
      );
    }
    const file: ItemFile = { name, format, source };
    if (typeof entry.size === 'string' && entry.size.length > 0) {
      file.size = Number(entry.size);
    } else if (typeof entry.size === 'number') {
      file.size = entry.size;
    }
    if (typeof entry.md5 === 'string') {
      file.md5 = entry.md5;
    }
    if (typeof entry.sha1 === 'string') {
      file.sha1 = entry.sha1;
    }
    if (typeof entry.original === 'string') {
      file.original = entry.original;
    }
    if (typeof entry.filecount === 'string' && entry.filecount.length > 0) {
      file.filecount = Number(entry.filecount);
    } else if (typeof entry.filecount === 'number') {
      file.filecount = entry.filecount;
    }
    return file;
  });
}

/**
 * Fetch and parse an archive.org item's metadata from
 * `https://archive.org/metadata/<itemId>` via the injected client.
 *
 * Throws (never returns a partial/guessed result) when:
 * - the response body is empty or not valid JSON;
 * - the top-level `metadata` object is absent;
 * - `metadata.mediatype` is not `'texts'` (this adapter handles no other
 *   media type -- FR-002 / IA-INV-A);
 * - `metadata.identifier` or `metadata.title` is missing (an id is NEVER
 *   fabricated from the requested `itemId` -- it must come from the
 *   response itself).
 */
export async function fetchItemMetadata(
  itemId: string,
  client: ArchiveHttpClient,
): Promise<ItemMetadata> {
  if (typeof itemId !== 'string' || itemId.trim().length === 0) {
    throw new Error('fetchItemMetadata: itemId is required.');
  }
  if (client === null || typeof client !== 'object') {
    throw new Error('fetchItemMetadata: client is required.');
  }

  const metadataEndpoint = `https://archive.org/metadata/${itemId}`;
  const raw = await client.getText(metadataEndpoint);

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(
      `fetchItemMetadata(${itemId}): the response from ${metadataEndpoint} was empty.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `fetchItemMetadata(${itemId}): the response from ${metadataEndpoint} was not valid JSON: ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      `fetchItemMetadata(${itemId}): the response from ${metadataEndpoint} did not parse to an object.`,
    );
  }

  const rawMetadata = parsed.metadata;
  if (!isPlainObject(rawMetadata)) {
    throw new Error(
      `fetchItemMetadata(${itemId}): the response from ${metadataEndpoint} has no "metadata" object -- ` +
        'the item may not exist.',
    );
  }

  const identifier = rawMetadata.identifier;
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error(
      `fetchItemMetadata(${itemId}): metadata.identifier is missing -- refusing to fabricate an id.`,
    );
  }

  const mediatype = rawMetadata.mediatype;
  if (typeof mediatype !== 'string' || mediatype.length === 0) {
    throw new Error(
      `fetchItemMetadata(${itemId}): metadata.mediatype is missing.`,
    );
  }
  if (mediatype !== HANDLED_MEDIATYPE) {
    throw new Error(
      `fetchItemMetadata(${itemId}): item "${identifier}" has mediatype "${mediatype}" -- ` +
        `this adapter only handles "${HANDLED_MEDIATYPE}".`,
    );
  }

  const title = rawMetadata.title;
  if (typeof title !== 'string' || title.length === 0) {
    throw new Error(
      `fetchItemMetadata(${itemId}): metadata.title is missing for item "${identifier}".`,
    );
  }

  const files = parseFiles(itemId, parsed.files);

  const result: ItemMetadata = {
    identifier,
    mediatype,
    title,
    files,
    detailsUrl: `https://archive.org/details/${itemId}`,
    metadataEndpoint,
    raw,
  };

  if (typeof rawMetadata.creator === 'string') {
    result.creator = rawMetadata.creator;
  }
  if (typeof rawMetadata.date === 'string') {
    result.date = rawMetadata.date;
  }
  if (typeof rawMetadata.year === 'string') {
    result.year = rawMetadata.year;
  }
  if (typeof rawMetadata['possible-copyright-status'] === 'string') {
    result.possibleCopyrightStatus = rawMetadata['possible-copyright-status'];
  }
  if (typeof rawMetadata.scanner === 'string') {
    result.scanner = rawMetadata.scanner;
  }

  return result;
}
