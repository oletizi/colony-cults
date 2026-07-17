/**
 * `collectRightsEvidence` -- Internet Archive rights-EVIDENCE proposal only,
 * never a verdict (specs/013-archiveorg-acquisition-path,
 * contracts/internet-archive-adapter.md `collectRightsEvidence` section,
 * FR-004 / FR-006).
 *
 * Archive.org's `possible-copyright-status` (e.g. "NOT_IN_COPYRIGHT") is a
 * repository-authored STATEMENT, not a legal determination -- it is
 * preserved verbatim as `rightsRaw` and NEVER translated into a rights
 * verdict. `RightsEvidence` has no `rightsStatus`/public-domain field at all;
 * the operator authors that judgment separately via the rights workflow
 * (INV-B). Any scanner/repository notice string is likewise preserved
 * verbatim, never declared legally void (FR-006).
 */

import type { RightsEvidence } from '@/repository/adapter';
import type { GroundedField } from '@/extraction/structured-extractor';
import type { ItemMetadata } from '@/repository/internet-archive/metadata';

/**
 * Build one grounded field from a mechanically-parsed archive.org item
 * metadata value.
 *
 * Type-fidelity gap (documented, NOT a fabrication of the grounding itself):
 * the shared {@link GroundedField} was authored for LLM PROSE extraction and
 * hard-codes `provenance.modelAssisted: true`. Archive.org's
 * `GET /metadata/<id>` response is a DETERMINISTIC JSON parse
 * (`fetchItemMetadata`), never a model call; `engine`/`model` below name the
 * deterministic mapping honestly rather than inventing a model. `value` is
 * the verbatim string archive.org returned for this field; `selector`
 * grounds it to the metadata endpoint it came from (mirrors Gallica's
 * `groundedFromDc` precedent in `src/repository/gallica/adapter.ts`).
 */
function groundedFromItemMetadata(
  value: string,
  interpretation: string,
  item: ItemMetadata,
): GroundedField<string> {
  return {
    value,
    evidence: {
      excerpt: value,
      selector: item.metadataEndpoint,
    },
    interpretation,
    provenance: {
      modelAssisted: true,
      engine: 'internet-archive-metadata',
      model: 'archive.org-metadata-json',
      promptVersion: 'ia-metadata-v1',
      at: new Date().toISOString(),
    },
  };
}

/**
 * Propose rights EVIDENCE from a resolved archive.org item's metadata.
 *
 * PROPOSES evidence only; never authors a rights judgment (INV-B). Sets no
 * rights verdict of any kind -- `RightsEvidence` has no such field, and this
 * function never fabricates one. `rightsRaw` preserves archive.org's
 * `possible-copyright-status` VERBATIM (never interpreted into a verdict);
 * `date` grounds `item.date` (falling back to `item.year` when `date` is
 * absent) and `creator` grounds `item.creator`, both tied to
 * `item.metadataEndpoint` as their origin.
 *
 * @param item Parsed archive.org item metadata (`fetchItemMetadata`'s result).
 * @returns Rights evidence, never a rights verdict.
 * @throws If `item` is not an object.
 */
export function collectRightsEvidence(item: ItemMetadata): RightsEvidence {
  if (item === null || typeof item !== 'object') {
    throw new Error('collectRightsEvidence: item is required.');
  }

  const evidence: RightsEvidence = {};

  if (typeof item.possibleCopyrightStatus === 'string') {
    evidence.rightsRaw = item.possibleCopyrightStatus;
  }

  const dateValue = item.date ?? item.year;
  if (typeof dateValue === 'string') {
    evidence.date = groundedFromItemMetadata(
      dateValue,
      'archive.org item metadata date (publication/creation year reported by ' +
        'the archive; a fact for the operator to weigh, not a legal ' +
        'determination of anything)',
      item,
    );
  }

  if (typeof item.creator === 'string') {
    evidence.creator = groundedFromItemMetadata(
      item.creator,
      'archive.org item metadata creator (as reported by the archive; not ' +
        'independently verified)',
      item,
    );
  }

  return evidence;
}
