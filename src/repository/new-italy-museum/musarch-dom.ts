/**
 * Musarch DOM-direct mechanical-field pull for New Italy Museum item pages
 * (`https://newitaly.org.au/CAT/NNNNNN.htm`, exported by the "Museum Archive
 * software project" -- http://www.musarch.com).
 *
 * These pages are a FIXED, machine-generated IE8-era template: every detail
 * field is `<span class="data" id="objectXXX"> VALUE</span>` inside
 * `#objectdetails`, and the master image (when one exists) is the `href` of
 * `<a class="image_anchor" ...>` inside `#objectimages`. Because the template
 * is fixed, keying on those known ids/classes is DETERMINISTIC -- this is a
 * MECHANICAL field pull (FR-006), not a language-model extraction. Prose
 * dates embedded in the description (e.g. "Pioneers Group Photo 1890") are
 * NOT extracted here; that is T015's grounded LLM structured-extraction step.
 *
 * The markup is not well-formed XML (self-closing variance, unclosed `<img>`,
 * `<A>`/`<a>` case variance, entities), so this module does a targeted,
 * well-scoped regex extraction against the specific known ids/classes rather
 * than a general HTML/XML parse -- per the task brief, this is preferred over
 * a fragile general parse for a template this narrow. Every extraction is
 * fail-loud: a required field that is absent or empty throws rather than
 * fabricating a value.
 *
 * Known discrepancy vs `__fixtures__/STRUCTURE.md`: that doc (and the task
 * brief that cites it) describes fixture `musarch-000855.html` as having NO
 * `image_anchor` ("artist's impression, NO downloadable image"). The actual
 * captured fixture DOES contain two `<a class="image_anchor">` elements. This
 * module extracts mechanically from the real markup it is given -- it does
 * not special-case any particular object id -- so `parseMusarchItem` on the
 * real 000855 fixture returns a non-null `masterImageUrl`, honestly reflecting
 * what is actually in the page. The "no image_anchor -> null" branch is real
 * code (needed for genuinely image-less items) and is covered by a synthetic
 * fixture in the test suite. See the test file for the full discrepancy note.
 */

/** Mechanically extracted (non-LLM) fields from a single Musarch item page. */
export interface MusarchDomFields {
  /** `#objectid` -- the six-digit page id, e.g. "000844". */
  readonly objectId: string;
  /** `#objectaccession` -- the durable copy identity, e.g. "NIMI-0844". */
  readonly accession: string;
  /** `#objectdesc`, falling back to `<meta name="Description">` when blank. */
  readonly description: string;
  /**
   * The full-resolution master image URL (the `href` of
   * `<a class="image_anchor">`), resolved absolute against `pageUrl`. `null`
   * when the page has no `image_anchor` (an HTML-description-only item).
   * Never a `tn_`-prefixed thumbnail and never a template graphic.
   */
  readonly masterImageUrl: string | null;
  /**
   * `#objectdate`, verbatim. `null` when blank -- the real date is usually
   * prose inside `description` and is NOT extracted here (see T015).
   */
  readonly rawStructuredDate: string | null;
}

/**
 * Extract the trimmed text of `<span class="data" id="FIELD_ID">...</span>`.
 * Returns `null` when the span is not present in the markup at all (a
 * distinct case from "present but empty", which callers handle themselves).
 */
function extractDataSpan(html: string, fieldId: string): string | null {
  const pattern = new RegExp(`<span class="data" id="${fieldId}">([^<]*)</span>`);
  const match = pattern.exec(html);
  if (match === null) {
    return null;
  }
  return match[1].trim();
}

/** Extract `<meta name="Description" content="...">`'s trimmed content, or `null`. */
function extractMetaDescription(html: string): string | null {
  const match = /<meta\s+name="Description"\s+content="([^"]*)"/i.exec(html);
  if (match === null) {
    return null;
  }
  const value = match[1].trim();
  return value.length > 0 ? value : null;
}

/**
 * Find the first `<a ...class="image_anchor"...>` tag in the page and return
 * its `href` attribute value, verbatim (not yet resolved to absolute). `null`
 * when no such anchor exists (an image-less item, e.g. HTML-description-only).
 *
 * By construction this NEVER returns a thumbnail or template graphic: the
 * thumbnail is a plain `<img class="image" src="tn_...">` (never itself an
 * `<a>` tag with `class="image_anchor"`, it is the anchor's CHILD), and the
 * template graphics (`images/img000N.gif`, `little_logo.jpg`) are bare `<img>`
 * tags inside `<div id="wb_imgN">`, never wrapped in an `image_anchor` anchor.
 * This function only ever reads an `<a>` tag's own `href`, never any `<img
 * src>`, so a thumbnail/gif path can only reach the return value if the
 * source markup itself mis-tags one as the anchor -- {@link resolveMasterImageUrl}
 * defends against that with an explicit filename check.
 */
function extractMasterImageHref(html: string): string | null {
  const anchorTags = html.match(/<a\s[^>]*>/gi) ?? [];
  const imageAnchorTag = anchorTags.find((tag) => tag.includes('class="image_anchor"'));
  if (imageAnchorTag === undefined) {
    return null;
  }
  const hrefMatch = /href="([^"]*)"/.exec(imageAnchorTag);
  if (hrefMatch === null) {
    throw new Error(
      'parseMusarchItem: found <a class="image_anchor"> with no href attribute -- ' +
        'malformed markup, refusing to guess a master image URL.',
    );
  }
  return hrefMatch[1];
}

/**
 * Resolve the master image URL absolute against `pageUrl`, or `null` when the
 * page has no `image_anchor`. Fails loud (rather than silently mirroring a
 * thumbnail or template graphic) if the resolved filename looks like one --
 * a defensive check for markup this parser does not understand, per the task
 * brief's hard requirement that a thumbnail/gif is NEVER selected as master.
 */
function resolveMasterImageUrl(html: string, pageUrl: string): string | null {
  const href = extractMasterImageHref(html);
  if (href === null) {
    return null;
  }
  const resolved = new URL(href, pageUrl).toString();
  const basename = resolved.split('/').pop() ?? '';
  if (basename.toLowerCase().startsWith('tn_')) {
    throw new Error(
      `parseMusarchItem: master image resolution selected a thumbnail ("${basename}") ` +
        'on page ' +
        `${pageUrl} -- refusing to mirror a thumbnail as the master.`,
    );
  }
  if (/^img\d+\.gif$/i.test(basename) || basename.toLowerCase() === 'little_logo.jpg') {
    throw new Error(
      `parseMusarchItem: master image resolution selected a template graphic ` +
        `("${basename}") on page ${pageUrl} -- this is not an item image, refusing to ` +
        'mirror it as the master.',
    );
  }
  return resolved;
}

/**
 * Parse the mechanical (non-LLM) fields out of a single Musarch item page.
 *
 * @param html    The raw item-page HTML (as captured; may be malformed XML).
 * @param pageUrl The item page's own URL, used to resolve `masterImageUrl`
 *                absolute. Also named in error messages.
 * @throws If `html`/`pageUrl` are missing, or if a REQUIRED field
 *         (`#objectid`, `#objectaccession`, or a description) is absent or
 *         empty -- never fabricates a value.
 */
export function parseMusarchItem(html: string, pageUrl: string): MusarchDomFields {
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('parseMusarchItem: html is required and must be non-empty.');
  }
  if (typeof pageUrl !== 'string' || pageUrl.trim().length === 0) {
    throw new Error('parseMusarchItem: pageUrl is required and must be non-empty.');
  }

  const objectId = extractDataSpan(html, 'objectid');
  if (objectId === null || objectId.length === 0) {
    throw new Error(
      `parseMusarchItem: required field #objectid is missing or empty on page ${pageUrl} -- ` +
        'refusing to fabricate an object id.',
    );
  }

  const accession = extractDataSpan(html, 'objectaccession');
  if (accession === null || accession.length === 0) {
    throw new Error(
      `parseMusarchItem: required field #objectaccession is missing or empty on page ` +
        `${pageUrl} -- refusing to fabricate the durable copy identity.`,
    );
  }

  const descriptionSpan = extractDataSpan(html, 'objectdesc');
  const metaDescription = extractMetaDescription(html);
  const description =
    descriptionSpan !== null && descriptionSpan.length > 0 ? descriptionSpan : metaDescription;
  if (description === null || description.length === 0) {
    throw new Error(
      `parseMusarchItem: no description found (#objectdesc is empty and no ` +
        `<meta name="Description"> is present) on page ${pageUrl}.`,
    );
  }

  const rawDateSpan = extractDataSpan(html, 'objectdate');
  const rawStructuredDate = rawDateSpan !== null && rawDateSpan.length > 0 ? rawDateSpan : null;

  const masterImageUrl = resolveMasterImageUrl(html, pageUrl);

  return { objectId, accession, description, masterImageUrl, rawStructuredDate };
}
