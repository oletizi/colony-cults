# Contract: `RepositoryAdapter` + the gap-closure loop touchpoints

The single new seam. Everything else reuses shipped `bib` verbs (contracts in specs/006 + 007).

## `RepositoryAdapter` (injected interface — Principle VI)

A repository is usable by the program when an adapter implements:

```
interface RepositoryAdapter {
  readonly name: string;                       // "Gallica", "Trove/NLA", ...
  search(campaign: CampaignRef): Promise<DiscoveryCandidate[]>;   // may be manual-backed
  resolveIdentifier(c: DiscoveryCandidate): Promise<StableId>;    // fail loud if unverifiable
  determineRights(id: StableId): Promise<'public-domain' | 'restricted' | 'uncertain'>;
  acquire(id: StableId, opts: { objectStore: true }): Promise<AcquireResult>; // masters+provenance
}
```

- **`search`** returns candidates (never fabricated); a repository with no automated mechanism supplies a **manual-backed** adapter that records the operator's findings — the search-log entry is written either way.
- **`resolveIdentifier`** MUST fail loud on an ambiguous/unverifiable candidate (FR-008) — it never invents an ARK/OCLC/id.
- **`determineRights`** is the fail-closed gate (FR-007): only `public-domain` proceeds to `acquire`; `restricted`/`uncertain` block mirroring and the source stays cataloged.
- **`acquire`** writes masters + provenance to the object store; for Gallica it wraps the shipped fetcher; IIIF providers share an IIIF helper; non-IIIF are bespoke. Its result feeds `bib reconcile` (SSOT status advance).

**Errors (fail loud)**: unknown repository; unverifiable candidate; rights not public-domain (refused, cataloged); acquire mechanism absent (`none-yet` → surfaced as a capability gap, not a silent skip).

## The loop (composition of reused verbs + the adapter)

Per campaign, per repository, one iteration:

```
1. adapter.search(campaign)                → DiscoveryCandidate[]        (US1/US4)
2. append a SearchLogRecord                → search-log.yml (outcome: found|dry)   (US1)
3. for each candidate the researcher judges relevant:
     resolveIdentifier → bib inventory → bib verify-member → bib promote           (US4)
4. for each approved + public-domain member:
     adapter.acquire(--object-store) → bib reconcile                              (US3/US2)
5. bib coverage                            → re-measure; stop repo×campaign after 2 dry rounds (US7)
```

Reconcile-only closure (US2): for members already acquired out-of-band (masters in the object store), skip 1–4 and run `bib reconcile <id>` directly.

## Assertable invariants (test targets)

- **INV-1**: A search always yields a committed SearchLogRecord (even a `dry` one) — search history never silently stays empty (SC-001).
- **INV-2**: `resolveIdentifier` throws on an unverifiable candidate; no fabricated id is ever written (FR-008).
- **INV-3**: `acquire` is unreachable unless `determineRights` returned `public-domain` (FR-007 / Principle IV).
- **INV-4**: after `acquire` + `reconcile`, the member's RepositoryRecord is `collected`/`archived` and `bib coverage` reflects it (SC-003).
- **INV-5**: an adapter with `acquireMechanism: none-yet` produces a tracked capability gap, never a silently-skipped source (FR-013).
- **INV-6**: the loop never invokes `bib migrate` (FR-012).
