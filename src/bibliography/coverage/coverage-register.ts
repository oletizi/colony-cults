import type { LoadedSource } from '@/bibliography/load';
import type { CoverageRegister, RegisterEntry } from '@/bibliography/coverage/coverage-model';

/**
 * The unresolved-references register (T016 references + T019 suspected + the
 * ungrouped bucket, FR-012). A PURE projection over the already-loaded sources:
 *
 * - Every `references[]` entry with NO `resolvedTo` (the referenced-but-
 *   unidentified population) contributes one `kind: 'reference'` entry, owned by
 *   the citing `Source`. A RESOLVED reference is provenance, not a gap, and is
 *   omitted.
 * - Every `suspected[]` entry on a source-group contributes one
 *   `kind: 'suspected'` entry, owned by the group.
 * - References + suspected are grouped by campaign (a member via `partOf`, or the
 *   group `Source` itself). References on a `Source` with NO campaign (no
 *   `partOf` and not itself a group) fall into the explicit `ungrouped` bucket so
 *   no known gap is silently dropped.
 */

/** Unresolved-reference entries mined FROM one source (resolved refs excluded). */
function unresolvedReferenceEntries(loaded: LoadedSource): RegisterEntry[] {
  const owner = loaded.source.sourceId;
  const entries: RegisterEntry[] = [];
  for (const reference of loaded.source.references ?? []) {
    if (reference.resolvedTo !== undefined) {
      continue;
    }
    const entry: RegisterEntry = { kind: 'reference', citedAs: reference.citedAs, owner };
    if (reference.basis !== undefined) {
      entry.basis = reference.basis;
    }
    entries.push(entry);
  }
  return entries;
}

/** Suspected-gap entries authored on one source-group. */
function suspectedEntries(group: LoadedSource): RegisterEntry[] {
  const owner = group.source.sourceId;
  return (group.source.suspected ?? []).map((gap) => ({
    kind: 'suspected',
    description: gap.description,
    basis: gap.basis,
    owner,
  }));
}

/** True when `loaded` belongs to campaign `campaignId` (a member, or the group itself). */
function belongsToCampaign(loaded: LoadedSource, campaignId: string): boolean {
  return loaded.source.partOf === campaignId || loaded.source.sourceId === campaignId;
}

/** True when `loaded` has no campaign at all (no `partOf` and not itself a group). */
function hasNoCampaign(loaded: LoadedSource): boolean {
  return loaded.source.partOf === undefined && loaded.source.kind !== 'source-group';
}

/**
 * Build the {@link CoverageRegister}. `sources` is iterated in its given
 * (sorted) order throughout, so the output is deterministic. Within a campaign,
 * unresolved references (in source order) precede the group's suspected gaps.
 */
export function buildRegister(
  sources: readonly LoadedSource[],
  campaigns: readonly LoadedSource[],
): CoverageRegister {
  const byCampaign = campaigns.map((group) => {
    const campaignId = group.source.sourceId;
    const members = sources.filter((loaded) => belongsToCampaign(loaded, campaignId));
    const references = members.flatMap(unresolvedReferenceEntries);
    const suspected = suspectedEntries(group);
    return { campaign: campaignId, entries: [...references, ...suspected] };
  });

  const ungrouped = sources.filter(hasNoCampaign).flatMap(unresolvedReferenceEntries);

  return { byCampaign, ungrouped };
}
