import type { CanonicalModel } from '@/bibliography/model';
import type { ValidationFinding } from '@/bibliography/validate';
import type { Source } from '@/model/source';

/**
 * Validation rules V3-V5 for the corpus-coverage-audit authored fields
 * (`Source.references[]`, `Source.knownExtent`, `Source.suspected[]`) --
 * see specs/007-corpus-coverage-audit/data-model.md § Validation rules. Split
 * out of `@/bibliography/validate-checks` to keep that file's total under the
 * repo's ~300-500-line-per-file guidance; composed into `validate()`
 * alongside the shipped checks the same way `validate-checks.ts`'s own
 * exports are.
 *
 * Scope note -- V1/V2 are deliberately NOT implemented here: `evidenceClass`
 * (V1) and `references[].citedKind` (V2) are both narrowed against their
 * closed vocabularies AT LOAD (`@/bibliography/load-coverage-fields`'s
 * `optionalEvidenceClass`/`validateReference`, via `isEvidenceClass`/
 * `isCitedKind`) -- an out-of-vocab value throws before a `CanonicalModel`
 * carrying it could ever exist, so a validate-checks finding for either would
 * be dead code. See `tests/unit/bibliography/load-coverage-fields.test.ts`
 * for the tests documenting that fail-loud boundary.
 */

/**
 * V3: every `references[].resolvedTo` MUST resolve to an existing `sourceId`
 * in the corpus (data-model). Unlike `citedKind` (V2, narrowed at load),
 * `resolvedTo` is a referential check across the whole loaded corpus -- it
 * cannot be checked file-by-file at load, only once every `Source` is
 * assembled into a `CanonicalModel`. Reports one `dangling-resolved-to`
 * finding per dangling reference, naming the owning Source and the missing
 * target.
 */
export function validateReferences(model: CanonicalModel): ValidationFinding[] {
  const sourceIds = new Set(model.sources.map((source) => source.sourceId));
  const findings: ValidationFinding[] = [];
  for (const source of model.sources) {
    for (const reference of source.references ?? []) {
      if (reference.resolvedTo === undefined || sourceIds.has(reference.resolvedTo)) {
        continue;
      }
      findings.push({
        kind: 'dangling-resolved-to',
        sourceId: source.sourceId,
        detail:
          `Source "${source.sourceId}" reference (citedAs: "${reference.citedAs}") has ` +
          `resolvedTo "${reference.resolvedTo}", which does not resolve to any existing sourceId`,
      });
    }
  }
  return findings;
}

/** One `group-only-field` finding naming the offending field + owning Source. */
function groupOnlyFinding(source: Source, field: string): ValidationFinding {
  return {
    kind: 'group-only-field',
    sourceId: source.sourceId,
    detail:
      `Source "${source.sourceId}" (kind: ${source.kind}) carries "${field}", which is valid ` +
      `only on kind: source-group`,
  };
}

/**
 * V4: `knownExtent` and `suspected[]` are valid ONLY on `kind:
 * 'source-group'` (data-model). Neither is enforced at load (`@/bibliography/
 * load-coverage-fields` parses either field's shape but does not know the
 * OWNING Source's `kind` -- that cross-field check belongs here). Reports one
 * `group-only-field` finding per offending field present on a non-group
 * Source.
 */
export function validateGroupOnlyFields(model: CanonicalModel): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const source of model.sources) {
    if (source.kind === 'source-group') {
      continue;
    }
    if (source.knownExtent !== undefined) {
      findings.push(groupOnlyFinding(source, 'knownExtent'));
    }
    if (source.suspected !== undefined) {
      findings.push(groupOnlyFinding(source, 'suspected'));
    }
  }
  return findings;
}

/**
 * V5: when present with `state: 'measured'`, `knownExtent.count` MUST be a
 * non-negative integer (data-model). The loader's `validateKnownExtent`
 * already narrows the field to the closed {@link KnownExtent} shape (`state`
 * in the closed vocab, `measured` carrying a `count` number + `basis`
 * string) -- but it deliberately accepts ANY number for `count`, including
 * negatives and non-integers (see its doc comment: "The non-negative-integer
 * refinement is a later validation task"). This check is that refinement;
 * `unexamined` and `irreducible` carry no count and are never flagged.
 * Reports one `invalid-known-member-count` finding per offending value,
 * independent of V4 (a negative count on a non-group Source yields both
 * findings, since they check different invariants).
 */
export function validateKnownExtentShape(model: CanonicalModel): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const source of model.sources) {
    const extent = source.knownExtent;
    if (extent === undefined || extent.state !== 'measured') {
      continue;
    }
    if (Number.isInteger(extent.count) && extent.count >= 0) {
      continue;
    }
    findings.push({
      kind: 'invalid-known-member-count',
      sourceId: source.sourceId,
      detail:
        `Source "${source.sourceId}" knownExtent.count ${extent.count} must be a ` +
        `non-negative integer`,
    });
  }
  return findings;
}

/**
 * Validate the corpus-coverage-audit authored fields (V3-V5, this module's
 * three model-only checks) -- composed into `@/bibliography/validate`'s
 * `validate()` alongside the shipped US2/US4/US5 checks. The search-log
 * SCOPE referential check (spec 010, replacing the retired campaign-based
 * V8/V9 check this module used to own) lives in `@/bibliography/
 * validate-search-log` (`validateSearchLogScopes`) and is composed
 * separately in `validate()`, since it needs the loaded search-log AND the
 * thread registry, not just the model.
 */
export function validateCoverageFields(model: CanonicalModel): ValidationFinding[] {
  return [
    ...validateReferences(model),
    ...validateGroupOnlyFields(model),
    ...validateKnownExtentShape(model),
  ];
}
