/**
 * The Scope model: `ScopeRef` (a discriminated reference, NOT a persisted
 * entity) plus its fail-loud resolution, and the single `isFetchableWork`
 * predicate every approval/acquisition/counting consumer calls.
 *
 * See specs/010-corpus-model-coherence/data-model.md § ScopeRef (the
 * resolution table is authoritative) and contracts/scope-model.md (INV-1,
 * INV-3). All resolution errors are fail-loud (Principle V): kind/referent
 * agreement is CHECKED, never assumed, and there is no transitional/alias form
 * (FR-013).
 */

import type { Source } from '@/model/source';

/**
 * A Source's primary-key id (`Source.sourceId`). Semantic alias matching the
 * spec's `ScopeRef` signature; a `sourceId` is a plain string on-disk.
 */
export type SourceId = string;

/**
 * True when a Source is a fetchable work (a `monograph`/`periodical`), false
 * when it is a work-bundle container (`kind: 'source-group'`). This is the
 * single predicate every approval/acquisition/counting consumer calls -- never
 * re-derived inline (INV-3). A source-group holds no repository records and is
 * never fetchable.
 */
export function isFetchableWork(source: Source): boolean {
  return source.kind !== 'source-group';
}

/**
 * A discriminated reference to a scope of research work. NOT persisted as an
 * entity: it is a `{ kind, id }` pointer validated against a corpus by
 * {@link resolveScopeRef}. The `id`'s meaning is determined by `kind` (see the
 * resolution table in the data-model).
 */
export type ScopeRef =
  | { kind: 'case'; id: string }
  | { kind: 'thread'; id: string }
  | { kind: 'work-bundle'; id: SourceId }
  | { kind: 'work'; id: SourceId };

/**
 * The injected context {@link resolveScopeRef} resolves a {@link ScopeRef}
 * against (Principle VI: composition/DI -- this module imports no file loader;
 * consumers supply the corpus + thread registry).
 */
export interface ScopeResolutionContext {
  /** The corpus Sources a `work`/`work-bundle` id is looked up in. */
  readonly sources: readonly Source[];
  /** The registered thread ids (from `bibliography/scopes.yml`) a `thread` id must be present in. */
  readonly threadIds: ReadonlySet<string>;
  /**
   * Every case id the SELECTED corpus declares (its manifest's `cases:`,
   * derived by `@/corpus/policies`' `deriveScopeContext` and carried on
   * `CorpusComposition.scope`, `@/cli/composition-root`). A `{ kind: 'case' }`
   * ScopeRef whose id is not a member of this set is rejected loud (INV-1).
   * Injected -- this module names no corpus-specific case id itself (FR-004).
   */
  readonly validCaseIds: ReadonlySet<string>;
}

/**
 * The result of a successful {@link resolveScopeRef}: the original `ref` plus,
 * for the Source-backed kinds (`work`/`work-bundle`), the resolved `source`.
 * `case`/`thread` refs carry no `source`.
 */
export interface ResolvedScope {
  readonly ref: ScopeRef;
  /** The resolved Source -- present only for `work` and `work-bundle` refs. */
  readonly source?: Source;
}

/** Finds a Source by id, or throws a descriptive error naming the missing id. */
function requireSource(id: SourceId, kind: ScopeRef['kind'], ctx: ScopeResolutionContext): Source {
  const source = ctx.sources.find((candidate) => candidate.sourceId === id);
  if (source === undefined) {
    throw new Error(
      `resolveScopeRef: ${kind} ref id "${id}" resolves to no Source in the corpus`,
    );
  }
  return source;
}

/**
 * Validates fail-loud that `ref.id` resolves UNDER `ref.kind`, per the
 * data-model resolution table, and returns a {@link ResolvedScope} on success.
 * Throws a descriptive Error on any kind/referent mismatch (INV-1):
 *
 * - `case`        -> id MUST be one of `ctx.validCaseIds`.
 * - `thread`      -> id MUST be a registered thread id.
 * - `work-bundle` -> id MUST resolve to a `kind: 'source-group'` Source.
 * - `work`        -> id MUST resolve to a fetchable (non-group) Source.
 */
export function resolveScopeRef(ref: ScopeRef, ctx: ScopeResolutionContext): ResolvedScope {
  switch (ref.kind) {
    case 'case': {
      if (!ctx.validCaseIds.has(ref.id)) {
        const validIds = [...ctx.validCaseIds].sort().join(', ') || '(none configured)';
        throw new Error(
          `resolveScopeRef: case ref id "${ref.id}" is not a valid case id for this corpus ` +
            `(valid ids: ${validIds})`,
        );
      }
      return { ref };
    }
    case 'thread': {
      if (!ctx.threadIds.has(ref.id)) {
        throw new Error(
          `resolveScopeRef: thread ref id "${ref.id}" is not a registered thread id ` +
            `(absent from bibliography/scopes.yml)`,
        );
      }
      return { ref };
    }
    case 'work-bundle': {
      const source = requireSource(ref.id, ref.kind, ctx);
      if (isFetchableWork(source)) {
        throw new Error(
          `resolveScopeRef: work-bundle ref id "${ref.id}" resolves to a Source of kind ` +
            `"${source.kind}", not a source-group (a work-bundle MUST be a source-group)`,
        );
      }
      return { ref, source };
    }
    case 'work': {
      const source = requireSource(ref.id, ref.kind, ctx);
      if (!isFetchableWork(source)) {
        throw new Error(
          `resolveScopeRef: work ref id "${ref.id}" resolves to a source-group; a work MUST be ` +
            `a fetchable Source (kind != source-group)`,
        );
      }
      return { ref, source };
    }
  }
}
