import { layoutsEqual, type SourceLayout } from '@/archive/derive-layout';
import {
  composeArchiveLayoutPolicy,
  productionArchiveLayoutInputs,
} from '@/archive/layout-bootstrap';
import type { ArchiveLayoutOverride, ArchiveLayoutPolicy } from '@/corpus/policies';
import { OVERRIDE_PATH_SHAPE, parseOverridePath } from '@/corpus/validate-overrides';

/**
 * ARCHIVE-LAYOUT RESOLUTION (T013, spec 018-corpus-config-seam; FR-007,
 * FR-017, INV-4/14). This module owns the TOTAL resolution order that
 * replaced the retired static `SOURCE_LAYOUTS` map -- coupling point #4 of
 * five:
 *
 *   1. the corpus manifest's validated `archiveLayoutOverrides`
 *   2. the RUNTIME OVERLAY (`registerSourceLayout`) -- source-group members
 *      created mid-run by `bib inventory`, which no precomputed map can hold
 *   3. the PRECOMPUTED generic derivation (`policy.derived`)
 *   4. throw -- there is no default (Principle V)
 *
 * The policy itself is composed by `@/archive/layout-bootstrap` (see its doc
 * comment for WHY the composition is deferred to the first resolution rather
 * than done eagerly at the CLI composition root), or injected outright via
 * {@link installArchiveLayoutPolicy}.
 */

/** The explicitly injected policy, if a composition root installed one. */
let installedPolicy: ArchiveLayoutPolicy | null = null;
/** The memoized deferred composition, built on first use when none is installed. */
let composedPolicy: ArchiveLayoutPolicy | null = null;

/**
 * Install the archive-layout policy explicitly, PREEMPTING the deferred
 * composition from the committed manifests + SSOT. This is the seam's
 * injection point: a test (or an alternative composition root) points the
 * layout resolution at a fixture corpus with zero core edits (SC-003).
 *
 * Call it BEFORE any layout is resolved. A later call replaces the policy and
 * discards any memoized composition -- resolution always reflects the most
 * recently installed policy rather than silently keeping a stale one.
 */
export function installArchiveLayoutPolicy(policy: ArchiveLayoutPolicy): void {
  installedPolicy = policy;
  composedPolicy = null;
}

/** The policy in force: the installed one, else the memoized deferred composition. */
function activePolicy(): ArchiveLayoutPolicy {
  if (installedPolicy !== null) {
    return installedPolicy;
  }
  if (composedPolicy === null) {
    composedPolicy = composeArchiveLayoutPolicy(productionArchiveLayoutInputs());
  }
  return composedPolicy;
}

/**
 * Runtime overlay of source -> archive layout (FR-017 step 2). Exists so a
 * source-group member -- created at runtime by the acquisition pipeline
 * (`bib inventory`), and therefore absent from a policy composed earlier in
 * the same process -- can still resolve a layout when `bib acquire` drives it
 * through the shipped fetcher (which calls {@link sourceLayout} deep inside,
 * synchronously, sourceId-only). See {@link registerSourceLayout}.
 */
const runtimeLayoutOverlay = new Map<string, SourceLayout>();

/**
 * Register (or idempotently re-register) a source's archive layout in the
 * runtime overlay. Re-registering the SAME sourceId with an EQUAL layout is a
 * no-op (idempotent, so a retried `bib acquire` invocation does not fail); a
 * CONFLICTING re-registration (same id, different layout) throws -- fail
 * loud, since a source's archive location must never silently move under it.
 *
 * SEMANTICS UNCHANGED by T013 (FR-017): `@/archive/member-layout`'s
 * `ensureMemberLayoutRegistered` and the acquire pipeline depend on exactly
 * this behavior.
 */
export function registerSourceLayout(sourceId: string, layout: SourceLayout): void {
  const existing = runtimeLayoutOverlay.get(sourceId);
  if (existing !== undefined && !layoutsEqual(existing, layout)) {
    throw new Error(
      `registerSourceLayout: source "${sourceId}" is already registered with a different ` +
        `layout (existing: ${JSON.stringify(existing)}, attempted: ${JSON.stringify(layout)})`,
    );
  }
  runtimeLayoutOverlay.set(sourceId, layout);
}

/**
 * True when a layout is resolvable for `sourceId` by ANY step of the
 * resolution order -- i.e. the non-throwing predicate form of
 * {@link sourceLayout}. Used by the member-layout bridge to skip re-deriving
 * a source that is already known, so a source the corpus already places is
 * never re-registered under a divergent derived slug.
 */
export function isSourceLayoutRegistered(sourceId: string): boolean {
  const policy = activePolicy();
  return (
    policy.overrides.has(sourceId) ||
    runtimeLayoutOverlay.has(sourceId) ||
    policy.derived.has(sourceId)
  );
}

/**
 * Turn a validated manifest override into a {@link SourceLayout}.
 *
 * The manifest expresses an override as an archive-root-relative PATH
 * (FR-007), which is the shape the config validator checks (relative, no
 * `..` escape, no two Sources to one location). Every consumer of a
 * `SourceLayout` builds `<archiveRoot>/archive/cases/<case>/<type>/<slug>`,
 * so the path is parsed back into those three components -- strictly, failing
 * loud on any other shape rather than guessing at a partial match.
 *
 * `kind` is NOT encoded in the path (it is a resolution strategy -- dated
 * issue dirs vs one flat directory -- not a directory name), so it comes from
 * the Source's own generic derivation. An override therefore relocates a
 * Source without being able to silently change how its directory is walked.
 * A Source with an override but no derivation is a manifest/SSOT
 * inconsistency the config validator already rejects (the override must name
 * a Source in one of the corpus's own cases), so it throws here too.
 */
function layoutFromOverride(
  sourceId: string,
  override: ArchiveLayoutOverride,
  policy: ArchiveLayoutPolicy,
): SourceLayout {
  // The shape parse is SHARED with the config validator (AUDIT-05): since
  // `override-path-malformed` now rejects a bad shape at validation time, this
  // throw is the last line of defense for a hand-built policy that never went
  // through `bib validate-config`, not the first place the problem is seen.
  const parsed = parseOverridePath(override.relativePath);
  if (parsed === null) {
    throw new Error(
      `sourceLayout: archiveLayoutOverride for source "${sourceId}" has relativePath ` +
        `${JSON.stringify(override.relativePath)}, which is not of the required form ` +
        `"${OVERRIDE_PATH_SHAPE}"`,
    );
  }
  const derived = policy.derived.get(sourceId);
  if (derived === undefined) {
    throw new Error(
      `sourceLayout: archiveLayoutOverride for source "${sourceId}" cannot be applied -- no ` +
        'Source with that id belongs to any committed corpus, so the override has no generic ' +
        'derivation to take its layout kind from',
    );
  }
  return { case: parsed.caseId, type: parsed.type, slug: parsed.slug, kind: derived.kind };
}

/**
 * Resolve the archive layout (case / type / slug / kind) for a source ID, in
 * the total order documented at the top of this module: manifest override ->
 * runtime overlay -> precomputed generic derivation -> throw. Shared by
 * `issueDir`, `monographDir`, `sourceRootDir`, `findIssueDir`,
 * `resolveFetchedDir` and the provenance layer.
 */
export function sourceLayout(sourceId: string): SourceLayout {
  const policy = activePolicy();

  const override = policy.overrides.get(sourceId);
  if (override !== undefined) {
    return layoutFromOverride(sourceId, override, policy);
  }

  const overlayLayout = runtimeLayoutOverlay.get(sourceId);
  if (overlayLayout !== undefined) {
    return overlayLayout;
  }

  const derivedLayout = policy.derived.get(sourceId);
  if (derivedLayout !== undefined) {
    return derivedLayout;
  }

  throw new Error(
    `sourceLayout: no archive layout registered for source "${sourceId}"`,
  );
}
