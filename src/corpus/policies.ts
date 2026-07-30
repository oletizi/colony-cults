import { tryLoadBrowserProfile } from '@/corpus/browser-profile';
import type { SelectedCorpus } from '@/corpus/select';
import {
  buildSourceFilenamePolicy,
  type SourceFilenamePolicy,
} from '@/corpus/source-filename-policy';
import { nonconformingSourceIds } from '@/corpus/validate-browser-defaults';
import { describePolicies } from '@/corpus/validate-existing-data';
import { deriveSourceLayout, type SourceLayout } from '@/archive/derive-layout';
import type { Source } from '@/model/source';

/**
 * Corpus config seam — NARROW per-seam policy derivation at the composition
 * root (T007). See specs/018-corpus-config-seam/spec.md (FR-004, FR-002b,
 * FR-017), data-model.md (§Narrow per-seam policies, §Archive-layout
 * resolution order), and contracts/corpus-seam.md (§Narrow policy
 * derivation).
 *
 * THE CENTRAL RULE (FR-004): each of the four hotspots — `bibliography/
 * scope.ts`, `sourcegroup/id-alloc.ts`, `archive/location.ts`, `browser/
 * config.ts` — receives ONLY its own narrow policy, never the manifest,
 * never a registry, never an omnibus corpus object. There is deliberately
 * NO exported "everything" type here. Every exposed collection is
 * `ReadonlySet` / `ReadonlyArray` / `ReadonlyMap`.
 *
 * INPUT TYPE — every function here takes the `SelectedCorpus` produced by
 * `@/corpus/select`'s `selectCorpus`, not a bare `CorpusManifest`. Two of
 * the four policies are pure functions of the manifest alone
 * (`deriveScopeContext`, `deriveSourceIdPolicy`); the other two need more:
 * `deriveBrowserProfile` must load a SIBLING file
 * (`<corporaRoot>/<id>.browser.yml`), and `corporaRoot` is an injected
 * composition-root value (FR-016) that must never be hardcoded here.
 * `SelectedCorpus` already carries `corporaRoot` alongside `manifest` for
 * exactly this reason (see `@/corpus/select`'s doc comment: "a later
 * composition-root step (narrow-policy derivation, including the
 * BrowserProfile...) has everything it needs without re-deriving or
 * re-injecting the root"). Taking the same input type on every function
 * here keeps the composition-root call site uniform: `const selected =
 * selectCorpus(...); const scope = deriveScopeContext(selected); ...`.
 *
 * PURE DERIVATION — none of these functions reads `process.env` or touches
 * ambient state. `deriveBrowserProfile`'s only I/O is the injected-root file
 * read via `tryLoadBrowserProfile`; the `CORPUS_SOURCES` env override is
 * read by the CALLER (a later composition-root task) and passed in as
 * `envOverride`.
 */

/** The narrow policy `bibliography/scope.ts` consumes (FR-004). */
export interface ScopeResolutionContext {
  /** Every case id this corpus declares. Immutable. */
  readonly validCaseIds: ReadonlySet<string>;
}

/**
 * Derive the scope-resolution policy from a selected corpus's manifest:
 * every declared case id, as an immutable set.
 */
export function deriveScopeContext(corpus: SelectedCorpus): ScopeResolutionContext {
  return { validCaseIds: new Set(corpus.manifest.cases) };
}

/**
 * The narrow policy `sourcegroup/id-alloc.ts` consumes (FR-004). SINGULAR —
 * unlike the manifest's `sourceIds` (a non-empty LIST of policies, FR-002b),
 * the allocator only ever allocates into ONE namespace, so this stays a
 * single `{ prefix, padWidth }` pair.
 */
export interface SourceIdPolicy {
  readonly prefix: string;
  readonly padWidth: number;
}

/**
 * Derive the SINGULAR allocator policy from a selected corpus's manifest:
 * the corpus's ONE `allocatable: true` `sourceIds` entry (FR-002b) — e.g.
 * for Port Breton, `PB-P`/pad 3, never the non-allocatable `PB-S`/pad 3
 * entry that exists purely for hand-authored secondary works.
 *
 * The manifest loader (`@/corpus/manifest`, via `@/corpus/manifest-source-
 * ids`) already guarantees exactly one allocatable policy exists on any
 * manifest that made it past `loadCorpusManifest`. If that invariant is
 * ever violated here, it is a PROGRAMMING error (a manifest reached this
 * function without going through the loader), not a data problem — so this
 * throws loud rather than silently picking one.
 */
export function deriveSourceIdPolicy(corpus: SelectedCorpus): SourceIdPolicy {
  const allocatable = corpus.manifest.sourceIds.filter((policy) => policy.allocatable);
  if (allocatable.length !== 1) {
    throw new Error(
      `deriveSourceIdPolicy(${corpus.manifest.id}): expected exactly one allocatable ` +
        `sourceIds policy, found ${allocatable.length}. The manifest loader guarantees this ` +
        `invariant (FR-002b) — reaching this function with a manifest that violates it is a ` +
        `programming error, not a data problem.`,
    );
  }
  const { prefix, padWidth } = allocatable[0];
  return { prefix, padWidth };
}

/**
 * Derive the narrow policy `@/bibliography/load`'s `loadAllSources` consumes
 * (FR-004, FR-018): which filenames in a `bibliography/sources` directory are
 * this corpus's Source files.
 *
 * PLURAL, unlike {@link deriveSourceIdPolicy}. Allocation writes into exactly
 * ONE namespace, so the allocator's policy is singular; enumeration must
 * recognize EVERY namespace the corpus declares, so this is built from all of
 * `manifest.sourceIds`. For Port Breton that is `PB-P`/pad 3 AND `PB-S`/pad 3
 * — the two together reproduce the retired `^PB-[A-Z]?\d{3}\.yml$` pattern's
 * behavior over the shipped SSOT exactly (FR-010: 92 `PB-P###` + 2 `PB-S###`
 * = 94 records), which a singular allocatable-only policy would NOT (it would
 * silently drop the 2 hand-authored secondary works).
 *
 * The manifest loader (`@/corpus/manifest`) already guarantees `sourceIds` is
 * non-empty, so the empty-shape-list failure in `buildSourceFilenamePolicy`
 * is unreachable from here — it guards the other constructors (a union over
 * committed manifests, a hand-built test policy) that do not go through the
 * loader.
 */
export function deriveSourceFilenamePolicy(corpus: SelectedCorpus): SourceFilenamePolicy {
  return buildSourceFilenamePolicy(corpus.manifest.sourceIds);
}

/** One validated per-Source archive-layout override, carried unchanged from the manifest. */
export interface ArchiveLayoutOverride {
  readonly relativePath: string;
  readonly reason: string;
}

/**
 * The narrow policy `archive/location.ts` consumes (FR-004, FR-017). Holds the
 * FIRST and THIRD steps of the four-step resolution order — the runtime overlay
 * sits BETWEEN them, and the terminal throw follows:
 *
 *   1. `overrides` — the manifest's validated `archiveLayoutOverrides`,
 *      keyed by Source ID. Step 1: highest precedence.
 *   2. (runtime overlay — NOT part of this policy, see below.)
 *   3. `derived`   — the GENERIC derivation (`deriveSourceLayout`),
 *      PRECOMPUTED per Source ID at construction time (see
 *      {@link deriveArchiveLayoutPolicy}'s doc comment for why this cannot
 *      be computed lazily inside `sourceLayout`). Step 3: consulted only after
 *      the overlay misses, NOT before it — the generic rule is the LAST answer
 *      before the throw, so a member registered mid-run by
 *      `registerSourceLayout` outranks it. (Contract: overrides → runtime
 *      overlay → derived → throw, FR-017; asserted by name in
 *      `tests/unit/archive/layout-resolution-order.test.ts`.)
 *   4. throw — no default (Principle V).
 *
 * (The runtime overlay itself — `registerSourceLayout` — is NOT part of
 * this policy: it is mid-run, mutable state owned by `archive/location.ts`
 * itself, unrelated to the corpus config seam.)
 */
export interface ArchiveLayoutPolicy {
  readonly overrides: ReadonlyMap<string, ArchiveLayoutOverride>;
  readonly derived: ReadonlyMap<string, SourceLayout>;
}

/**
 * Derive the archive-layout policy from a selected corpus's manifest AND its
 * already-loaded Sources.
 *
 * WHY `sources` IS A SEPARATE PARAMETER, NOT LOADED HERE: this module is a
 * PURE derivation over typed data (see the module doc comment) — it does
 * not read `bibliography/sources` itself. Enumerating "every Source that
 * belongs to this corpus" from disk is a distinct concern, and since T023 it
 * has its own narrow policy: `@/bibliography/load`'s `loadAllSources` takes
 * the injected {@link deriveSourceFilenamePolicy} result (FR-018) in place of
 * the retired hardcoded pattern. The composition root — for this seam,
 * `@/archive/layout-bootstrap` — does the loading and passes the Sources in
 * here.
 *
 * WHY THE `derived` MAP IS PRECOMPUTED HERE, NOT LAZILY INSIDE
 * `sourceLayout` (FR-017): `sourceLayout(sourceId)` (in `@/archive/
 * location`) is sourceId-only and SYNCHRONOUS — it is reached deep inside
 * the fetcher via `resolveFetchedDir` — while the generic derivation,
 * `deriveSourceLayout(source, fallbackCase)`, needs a full `Source` object.
 * `sourceLayout` therefore cannot look up a `Source` and derive on demand;
 * the derivation must happen up front, HERE, at the composition root, where
 * the corpus's Sources are already loaded — and be looked up by sourceId
 * from the precomputed `derived` map at layout-resolution time instead.
 * `deriveSourceLayout` itself is reused UNCHANGED (no slug-derivation logic
 * is reimplemented here).
 *
 * SCOPING: a Source is included in `derived` only when its OWN `case` field
 * is one of this corpus's declared `cases` — filtered here defensively, so
 * callers may pass either a pre-filtered Source list or a wider one (e.g.
 * "every Source in the repository") without over-including another corpus's
 * layouts. A Source with no `case` at all (never true for a standalone
 * top-level Source in the shipped SSOT; only possible for a source-group
 * MEMBER that inherits its case from its group) is correctly excluded here
 * — such a member is created/discovered mid-run and resolves instead via
 * the runtime overlay (`registerSourceLayout`, step 2 of the FR-017 order,
 * unchanged by this seam).
 *
 * ALSO EXCLUDED (T024 regression fix): any Source whose OWN `kind` is
 * `source-group`. A source-group is a CONTAINER, not a fetchable work — it
 * has no archive location of its own, only its members do. Precomputing a
 * generic layout for it would fabricate a phantom directory that nothing
 * ever writes to, and would silence `sourceLayout`'s terminal throw (FR-017
 * step 4: "no default") for a group id, which is the fail-loud guard every
 * caller of `hasArchiveLayout`-style code relies on. This mirrors
 * `@/archive/member-layout`'s `ensureMemberLayoutRegistered`, which
 * deliberately early-returns on `member.kind === 'source-group'` for the
 * same reason: containers are layout-less by design, not by omission.
 */
export function deriveArchiveLayoutPolicy(
  corpus: SelectedCorpus,
  sources: readonly Source[],
): ArchiveLayoutPolicy {
  const overrides = new Map<string, ArchiveLayoutOverride>(
    Object.entries(corpus.manifest.archiveLayoutOverrides ?? {}),
  );

  const caseIds = new Set(corpus.manifest.cases);
  const derived = new Map<string, SourceLayout>();
  for (const source of sources) {
    if (source.case === undefined || !caseIds.has(source.case)) {
      continue;
    }
    if (source.kind === 'source-group') {
      continue;
    }
    derived.set(source.sourceId, deriveSourceLayout(source));
  }

  return { overrides, derived };
}

/**
 * The narrow policy `browser/config.ts` consumes (FR-004, FR-005) — a
 * DELIBERATELY NARROWER shape than the `@/corpus/browser-profile` loader's
 * `BrowserProfile` (which also carries `schemaVersion`/`id`, loader
 * bookkeeping the browser build has no use for). Named distinctly
 * (`BrowserDefaultsPolicy`, not `BrowserProfile`) to avoid colliding with
 * that loader type while importing both in the same composition root.
 */
export interface BrowserDefaultsPolicy {
  /** The corpus this policy belongs to (the manifest's `id`). */
  readonly corpus: string;
  /** Browser default Source IDs. Immutable. */
  readonly defaultSources: ReadonlyArray<string>;
}

/**
 * Derive the browser-defaults policy for a selected corpus.
 *
 * ABSENCE (FR-005): a BrowserProfile is deployment config, required only by
 * browser-deploy / browser-default-consuming commands. When no
 * `envOverride` is supplied AND no `<corporaRoot>/<id>.browser.yml` file
 * exists for this corpus, this returns `null` rather than throwing — the
 * caller (a browser-default-consuming command) is responsible for treating
 * `null` as its own "no defaults configured" failure; every OTHER command
 * must simply not require this policy at all. A profile that EXISTS but is
 * malformed still throws loud (via `tryLoadBrowserProfile`) — only ABSENCE
 * is tolerated, never invalid data.
 *
 * `CORPUS_SOURCES` OVERRIDE (FR-005): applied HERE, at the composition
 * root — this module never reads `process.env` itself (see the module doc
 * comment). `envOverride` is the ALREADY-PARSED list of Source IDs (the
 * caller owns splitting the raw `CORPUS_SOURCES` string, since the
 * delimiter/format is a CLI-input concern, not a policy-derivation one).
 * When supplied, it wins outright — even when no on-disk profile exists for
 * this corpus at all, since the override fully specifies the defaults and
 * needs no file to fall back to. This is why the function does not throw
 * merely because both the profile is absent and no corpus-specific browser
 * profile was ever authored: an operator can run a browser build for ANY
 * selected corpus purely via `CORPUS_SOURCES`, with no `<id>.browser.yml`
 * required.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE `CORPUS_SOURCES` OVERRIDE IS VALIDATED (AUDIT-24)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This function used to return `{ defaultSources: [...envOverride] }` with ZERO
 * checks, so `CORPUS_SOURCES=ZZ-99999,QQ-1` against Port Breton resolved to
 * exactly those two ids and the browser build went on to produce a page set
 * from nothing.
 *
 * The decision taken, DELIBERATELY, is to VALIDATE it — override ids must
 * conform to at least one of the SELECTED corpus's `sourceIds` policies
 * (FR-002b), and a violation throws loud naming every offending id.
 *
 * The case for leaving it unchecked was that `CORPUS_SOURCES` is an OPERATOR
 * ESCAPE HATCH, and a validated escape hatch is a smaller hatch. That is
 * outweighed, on two grounds:
 *
 *   1. IT IS NOT AN OVERRIDE OF WHAT AN ID MEANS, only of WHICH ids to build.
 *      An id conforming to no policy of the selected corpus cannot name a
 *      Source of that corpus at all, so there is no legitimate operator intent
 *      the check refuses. The realistic reachable case is precisely the one
 *      worth catching: a `CORPUS_SOURCES` exported for corpus A, left in the
 *      shell or in CI, and then used with corpus B selected. Unchecked, that
 *      does not fail — it produces a plausible-looking build of the wrong
 *      thing, which is the quiet-wrong-answer failure Principle V exists to
 *      forbid.
 *   2. THE HATCH IS UNNARROWED IN THE DIMENSION THAT MATTERS. Any subset,
 *      superset, reordering or hand-picked selection of the corpus's own
 *      namespaces still passes, including ids that are not in the committed
 *      `<id>.browser.yml` and ids for which no record exists yet. What is
 *      refused is only "ids this corpus could never own".
 *
 * SCOPE OF THE CHECK — CONFORMANCE ONLY, NOT EXISTENCE. This module is a pure
 * derivation over typed data (see the module doc comment); it holds no
 * bibliography index and must not grow one. Conformance is decidable from the
 * manifest alone, so it is decided here. "Does this id name a real record" is
 * the config validator's `profile-unknown-default-source` rule, which has the
 * global identity index — see `@/corpus/validate-browser-defaults`.
 *
 * THE FILE-LOADED DEFAULTS GET THE SAME CHECK, on purpose: an escape hatch
 * that is STRICTER than the committed config would be backwards, and the
 * browser/site-build entrypoint (`@/browser/config`) does not run startup
 * validation, so without it AUDIT-10's committed-profile hole would stay open
 * on the one path that actually consumes the defaults. Both go through
 * `nonconformingSourceIds`, so there is one definition of conformance shared
 * with the validator rather than a second copy to drift.
 */
export function deriveBrowserProfile(
  corpus: SelectedCorpus,
  envOverride?: readonly string[],
): BrowserDefaultsPolicy | null {
  if (envOverride !== undefined) {
    assertDefaultSourcesConform(corpus, envOverride, 'the CORPUS_SOURCES override');
    return { corpus: corpus.manifest.id, defaultSources: [...envOverride] };
  }

  const profile = tryLoadBrowserProfile(corpus.corporaRoot, corpus.manifest.id);
  if (profile === null) {
    return null;
  }

  assertDefaultSourcesConform(
    corpus,
    profile.defaultSources,
    `${corpus.manifest.id}.browser.yml`,
  );
  return { corpus: corpus.manifest.id, defaultSources: [...profile.defaultSources] };
}

/**
 * Throw naming EVERY offending id when `defaultSources` contains an id that
 * conforms to none of `corpus`'s `sourceIds` policies (AUDIT-24).
 *
 * One id per line would send the operator through N fix-and-rerun cycles, so
 * all of them are listed, alongside the namespaces that were actually tried —
 * the message has to be enough to fix the env var or the file without reading
 * the manifest.
 */
function assertDefaultSourcesConform(
  corpus: SelectedCorpus,
  defaultSources: readonly string[],
  origin: string,
): void {
  const offending = nonconformingSourceIds(defaultSources, corpus.manifest.sourceIds);
  if (offending.length === 0) {
    return;
  }

  const policies = corpus.manifest.sourceIds.length;
  throw new Error(
    `deriveBrowserProfile(${corpus.manifest.id}): ${origin} names ${offending.length} browser ` +
      `default Source ID(s) that conform to NONE of corpus ` +
      `${JSON.stringify(corpus.manifest.id)}'s ${policies} ID ` +
      `${policies === 1 ? 'policy' : 'policies'}: ` +
      `${offending.map((id) => JSON.stringify(id)).join(', ')}. ` +
      `Policies tried: ${describePolicies(corpus.manifest.sourceIds)}. ` +
      'An id this corpus could never own names no Source of it, so a build from these defaults ' +
      'would silently produce the wrong page set (FR-002b, FR-005).',
  );
}
