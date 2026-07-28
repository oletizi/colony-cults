import { existsSync } from 'node:fs';
import path from 'node:path';

import { loadAllSources } from '@/bibliography/load';
import { resolveCorporaRoot, resolveRepoRootUpward } from '@/cli/composition-root';
import { listCorpusManifests } from '@/corpus/manifest';
import {
  deriveArchiveLayoutPolicy,
  type ArchiveLayoutOverride,
  type ArchiveLayoutPolicy,
} from '@/corpus/policies';
import type { SourceLayout } from '@/archive/derive-layout';

/**
 * THE DEFERRED COMPOSITION ROOT for the archive-layout seam (T013, spec
 * 018-corpus-config-seam; FR-004, FR-010, FR-017).
 *
 * WHY THE POLICY IS COMPOSED HERE AND NOT AT THE CLI ROOT. `@/cli/
 * composition-root` deliberately does NOT derive an `ArchiveLayoutPolicy`
 * (see its own doc comment): `deriveArchiveLayoutPolicy` needs the corpus's
 * already-loaded `Source[]`, and loading the whole SSOT for EVERY command --
 * including the many that never resolve an archive layout -- would change
 * observable startup behavior (a malformed Source would suddenly fail
 * commands that never read one) and so violate FR-010. The alternative,
 * threading a policy parameter down to `sourceLayout`, is closed off by
 * FR-017's binding constraint: `sourceLayout(sourceId)` is sourceId-only and
 * SYNCHRONOUS, reached deep inside the fetcher via `resolveFetchedDir`.
 *
 * So the composition is DEFERRED rather than eager: it happens on the FIRST
 * archive-layout resolution of a process, and is memoized by
 * `@/archive/layout-resolve`. A command that never resolves a layout never
 * pays for it; a command that does pays exactly once. An explicit
 * `installArchiveLayoutPolicy` call PREEMPTS this entirely, which is how a
 * test (or any other composition root) injects a fixture corpus without
 * touching core code (SC-003).
 *
 * WHY IT UNIONS EVERY COMMITTED MANIFEST INSTEAD OF SELECTING ONE CORPUS.
 * The layout question this seam answers is keyed by a GLOBALLY UNIQUE Source
 * ID, not by the selected corpus, and the config validator already guarantees
 * the union is unambiguous: case ids are unique across the repository, every
 * Source declares exactly one case, and an override must name a Source in one
 * of its own corpus's cases. So no two manifests can claim one Source ID, and
 * a union cannot answer differently from a per-corpus selection. Doing it
 * this way keeps this module free of any ambient `--corpus`/`COLONY_CORPUS`
 * reading (Principle V; FR-003 puts selection at the composition root, once)
 * and mirrors the same choice already made for `@/bibliography/coverage/
 * load-coverage-report`. Cross-manifest collisions are not assumed away --
 * they throw here (fail loud), naming both claimants.
 *
 * NO CORPUS-SPECIFIC CONSTANT LIVES HERE (SC-004/INV-13): the corpora root
 * comes from `@/cli/composition-root`'s `resolveCorporaRoot`, the one place
 * permitted to name it.
 */

/** The two on-disk roots a layout policy is composed from. */
export interface ArchiveLayoutPolicyInputs {
  /** Directory holding the committed corpus manifests (`<repoRoot>/corpora`). */
  readonly corporaRoot: string;
  /** Directory holding the bibliography SSOT (`<repoRoot>/bibliography/sources`). */
  readonly sourcesDir: string;
}

/**
 * The production inputs, resolved depth-agnostically from this module's own
 * location (identically to `@/cli/composition-root`, so it is correct both
 * under `tsx` from `src/` and from the bundled `dist/`).
 */
export function productionArchiveLayoutInputs(): ArchiveLayoutPolicyInputs {
  const repoRoot = resolveRepoRootUpward();
  return {
    corporaRoot: resolveCorporaRoot(repoRoot),
    sourcesDir: path.join(repoRoot, 'bibliography', 'sources'),
  };
}

/** Fail loud with a message naming this module, never a silent empty policy. */
function fail(message: string): never {
  throw new Error(`composeArchiveLayoutPolicy: ${message}`);
}

/**
 * Compose the `ArchiveLayoutPolicy` for every committed corpus: the validated
 * `archiveLayoutOverrides` (FR-017 step 1) plus the PRECOMPUTED generic
 * derivation per Source ID (step 3), both keyed by Source ID.
 *
 * Fails loud on an absent corpora root, on a corpora root with no manifests,
 * and on any Source ID claimed by two manifests -- each of those is a config
 * defect that must not degrade into a silently thinner policy.
 */
export function composeArchiveLayoutPolicy(
  inputs: ArchiveLayoutPolicyInputs,
): ArchiveLayoutPolicy {
  const { corporaRoot, sourcesDir } = inputs;
  if (!existsSync(corporaRoot)) {
    fail(
      `no corpora directory at ${JSON.stringify(corporaRoot)} -- an archive layout cannot ` +
        'be resolved without at least one committed corpus manifest',
    );
  }
  const manifests = listCorpusManifests(corporaRoot);
  if (manifests.length === 0) {
    fail(
      `no corpus manifests under ${JSON.stringify(corporaRoot)} -- an archive layout cannot ` +
        'be resolved without at least one committed corpus manifest',
    );
  }

  const sources = loadAllSources(sourcesDir).map((loaded) => loaded.source);

  const overrides = new Map<string, ArchiveLayoutOverride>();
  const derived = new Map<string, SourceLayout>();
  /** sourceId -> the corpus id that already claimed it, for collision reporting. */
  const overrideOwner = new Map<string, string>();
  const derivedOwner = new Map<string, string>();

  for (const manifest of manifests) {
    const policy = deriveArchiveLayoutPolicy({ corporaRoot, manifest }, sources);

    for (const [sourceId, override] of policy.overrides) {
      const owner = overrideOwner.get(sourceId);
      if (owner !== undefined) {
        fail(
          `Source ${JSON.stringify(sourceId)} has an archiveLayoutOverride in BOTH corpus ` +
            `${JSON.stringify(owner)} and corpus ${JSON.stringify(manifest.id)} -- a Source ` +
            'belongs to exactly one corpus, so this is a manifest defect',
        );
      }
      overrideOwner.set(sourceId, manifest.id);
      overrides.set(sourceId, override);
    }

    for (const [sourceId, layout] of policy.derived) {
      const owner = derivedOwner.get(sourceId);
      if (owner !== undefined) {
        fail(
          `Source ${JSON.stringify(sourceId)} is claimed by BOTH corpus ` +
            `${JSON.stringify(owner)} and corpus ${JSON.stringify(manifest.id)} -- case ids ` +
            'must be unique across the repository, so this is a manifest defect',
        );
      }
      derivedOwner.set(sourceId, manifest.id);
      derived.set(sourceId, layout);
    }
  }

  return { overrides, derived };
}
