import { REPOSITORY_NAMES } from '@/repository/adapter';
import { registeredSourceQueryIds } from '@/sourcequery/source-config';
import type { InstalledCapabilities } from '@/corpus/validate-types';

/**
 * The INSTALLED CAPABILITY SET, read off the real registries (T018; spec.md
 * FR-008, contracts/corpus-seam.md § Config validator, INV-9).
 *
 * WHY THIS MODULE EXISTS AT ALL — and why it lives under `@/cli`:
 *
 * A corpus manifest NAMES capabilities (`requiredCapabilities`) but must
 * never own the registry (data-model.md § Invariants), so nothing under
 * `@/corpus` may import `@/repository/*` or `@/sourcequery/*`;
 * `InstalledCapabilities` is an injected parameter there. Somebody still has
 * to answer "what is actually installed", and that somebody is the
 * composition root. This module is that answer, kept separate from
 * `@/cli/composition-root` so the corpus seam's one dependency on the
 * capability registries is a single named file rather than an import buried
 * in the root.
 *
 * IT IS DERIVED, NEVER TRANSCRIBED. Both halves read the registration site
 * itself:
 *   - `repositories` ← `REPOSITORY_NAMES` in `@/repository/adapter`, which is
 *     now the runtime list the `RepositoryName` union is derived from. There
 *     is no process-global adapter registry to enumerate —
 *     `RepositoryAdapterRegistry` is constructed per call site with injected
 *     adapters (constructor DI) — so the name union IS the installation
 *     boundary: a repository this build has no adapter for cannot be named
 *     anywhere, and a fifth adapter cannot be added without extending that
 *     list.
 *   - `sourceQueries` ← `registeredSourceQueryIds()`, a genuine read of
 *     `@/sourcequery/source-config`'s live `sourceRegistry`, whose entries are
 *     added by `registerSource` at import time.
 * A literal list in this file would be a fourth copy of a fact the code
 * already states twice, and would silently go stale the first time an adapter
 * or source config was added.
 */
export function installedCapabilities(): InstalledCapabilities {
  return {
    repositories: [...REPOSITORY_NAMES],
    sourceQueries: registeredSourceQueryIds(),
  };
}
