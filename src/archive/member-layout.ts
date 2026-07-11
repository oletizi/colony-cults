import { loadAllSources } from '@/bibliography/load';
import {
  deriveSourceLayout,
  isSourceLayoutRegistered,
  registerSourceLayout,
} from '@/archive/location';

/**
 * Ensure a source-group MEMBER's archive layout is registered in the runtime
 * overlay so `sourceLayout(sourceId)` -- reached by `ocr`/`translate`/
 * `restore-images` via `resolveFetchedDir` -- resolves it. This is the
 * reverse-lookup counterpart to what `bib acquire` does before FETCHING a
 * member (`registerMemberArchiveLayout`): a member created by `bib inventory`
 * is never hand-added to the static `SOURCE_LAYOUTS` registry, so every command
 * that must locate its files has to derive+register the same layout first.
 *
 * Deriving (rather than hardcoding) guarantees these commands resolve the SAME
 * slug `bib acquire` fetched into -- a hand-added static entry could silently
 * diverge from the derived slug and point at the wrong directory.
 *
 * No-op (returns) when:
 *  - a layout is already known (static registry OR already-registered overlay),
 *    so a static source (PB-P001..PB-P003) is never re-derived under a
 *    divergent slug;
 *  - `sourceId` is not a registered source at all, or is itself a source-group
 *    (which has no archival object) -- those cases are left for the caller's
 *    own resolution to reject with its clearer, command-specific error.
 *
 * Fails loud only if a genuine member's layout cannot be derived (e.g. no case
 * and no owning-group case) -- a layout cannot be placed in the archive tree
 * from nothing.
 */
export function ensureMemberLayoutRegistered(
  sourceId: string,
  sourcesDir: string,
): void {
  if (isSourceLayoutRegistered(sourceId)) {
    return;
  }
  const loaded = loadAllSources(sourcesDir);
  const memberEntry = loaded.find((entry) => entry.source.sourceId === sourceId);
  if (memberEntry === undefined) {
    return;
  }
  const member = memberEntry.source;
  if (member.kind === 'source-group') {
    return;
  }
  let groupCase: string | undefined;
  if (member.partOf !== undefined) {
    const groupEntry = loaded.find(
      (entry) => entry.source.sourceId === member.partOf,
    );
    groupCase = groupEntry?.source.case;
  }
  registerSourceLayout(sourceId, deriveSourceLayout(member, groupCase));
}
