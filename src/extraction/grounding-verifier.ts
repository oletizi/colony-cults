/**
 * Deterministic grounding verifier (the security teeth of structured extraction).
 *
 * No model call, no I/O — a pure function over its inputs. It exists to catch
 * fabrication (FR-008) and mis-attribution (INV-2: no fabrication) before an
 * extracted field is ever trusted downstream.
 *
 * Rules:
 *  - Every field's `evidence.excerpt` must be a verbatim substring of the
 *    document's `bytes`, after whitespace normalization (collapse runs of
 *    whitespace to a single space, trim; applied identically to both sides).
 *  - Every rights-critical field's `evidence.excerpt` must additionally
 *    contain that field's `value` (in its string form), after the same
 *    normalization. This catches a real excerpt paired with a value that
 *    is not actually in it.
 *  - Any failure throws a descriptive Error naming the offending field.
 *    A passing extraction returns void. Inputs are never mutated.
 */

import type { FetchedDocument, GroundedExtraction } from '@/extraction/structured-extractor';

/**
 * Collapse runs of whitespace (spaces, tabs, newlines) to a single space
 * and trim leading/trailing whitespace. Applied identically to the page
 * bytes and to excerpts/values before every comparison so that grounding
 * checks are insensitive to incidental whitespace differences.
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Verify that every field in `extraction` is grounded in `doc.bytes`, and
 * that every rights-critical field's excerpt actually contains its value.
 *
 * Deterministic and side-effect-free: identical inputs always produce
 * identical results (either a silent return or the same thrown error).
 *
 * @throws Error describing the field and excerpt/value that failed to ground.
 */
export function verifyGrounded<T>(
  doc: FetchedDocument,
  extraction: GroundedExtraction<T>,
  rightsCriticalKeys: (keyof T)[],
): void {
  const normalizedPage = normalizeWhitespace(doc.bytes);
  const rightsCriticalSet = new Set<keyof T>(rightsCriticalKeys);

  for (const key in extraction) {
    const field = extraction[key];
    const normalizedExcerpt = normalizeWhitespace(field.evidence.excerpt);

    // An empty (or whitespace-only) excerpt is NOT grounding: `includes("")` is
    // vacuously true, so an empty excerpt would let a fabricated value slip
    // through the security teeth. Reject it explicitly (no fabrication, FR-008).
    if (normalizedExcerpt.length === 0) {
      throw new Error(
        `verifyGrounded: field "${String(key)}" has an empty evidence excerpt — ` +
          `an empty excerpt is not grounding (it cannot support any value). ` +
          `excerpt=${JSON.stringify(field.evidence.excerpt)}`,
      );
    }

    if (!normalizedPage.includes(normalizedExcerpt)) {
      throw new Error(
        `verifyGrounded: field "${String(key)}" is not grounded — its evidence excerpt ` +
          `does not appear (verbatim, whitespace-normalized) in the document bytes. ` +
          `excerpt=${JSON.stringify(field.evidence.excerpt)}`,
      );
    }

    if (rightsCriticalSet.has(key)) {
      const normalizedValue = normalizeWhitespace(String(field.value));

      if (!normalizedExcerpt.includes(normalizedValue)) {
        throw new Error(
          `verifyGrounded: rights-critical field "${String(key)}" is mis-attributed — ` +
            `its evidence excerpt does not contain its value. ` +
            `value=${JSON.stringify(String(field.value))} excerpt=${JSON.stringify(field.evidence.excerpt)}`,
        );
      }
    }
  }
}
