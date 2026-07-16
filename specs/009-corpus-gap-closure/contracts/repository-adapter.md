# Contract: `RepositoryAdapter` + the gap-closure loop touchpoints

The single new seam. Everything else reuses shipped `bib` verbs (contracts in specs/006 + 007).

## `RepositoryAdapter` (injected interface — Principle VI)

> **Canonical shape lives in `src/repository/adapter.ts`.** This section was
> written before the interface was built and originally sketched a
> `name/search/resolveIdentifier/determineRights/acquire` shape; the shipped
> adapter (proven by 006 Gallica + 011 New Italy Museum) is instead
> `repository/resolve/collectRightsEvidence/acquire`, with typed I/O.
> `specs/011-museum-acquisition-path/contracts/repository-adapter.md` carries
> the canonical typed refinement (its `ResolvedRepositoryItem`,
> `RightsEvidence`, `AcquisitionResult`); this doc is reconciled to match.
> Note especially: **there is no `search` adapter method** — discovery is a
> separate seam (a `DiscoveryMechanism` such as `bnf-catalogue-sru`, or a manual
> operator search); and rights is **evidence proposed by the adapter, judgment
> authored by the operator on the record**, gated at `acquire`.

A repository is usable by the program when an adapter implements (shipped shape):

```
interface RepositoryAdapter {
  readonly repository: RepositoryName;
  // Resolve an operator-supplied locator to a concrete item. Throws on any
  // unverifiable candidate; no identifier is ever invented.
  resolve(locator: RepositoryLocator, ctx: ResolutionContext): Promise<ResolvedRepositoryItem>;
  // PROPOSE rights evidence (grounded facts + raw repository statement);
  // NEVER authors the rights judgment.
  collectRightsEvidence(item: ResolvedRepositoryItem): Promise<RightsEvidence>;
  // Mirror masters + provenance. Only reachable when the record's authored
  // rightsAssessment.rightsStatus === 'public-domain'. Result feeds bib reconcile.
  acquire(record: RepositoryRecord, ctx: AcquisitionContext): Promise<AcquisitionResult>;
}
```

- **Discovery is not an adapter method.** A repository is searched by a separate
  `DiscoveryMechanism` (automated, e.g. `bnf-catalogue-sru`) or by a **manual**
  operator search; a `SearchLogRecord` is authored either way (INV-1). The
  operator then hands the surfaced locator to `resolve`.
- **`resolve`** MUST fail loud on an ambiguous/unverifiable locator (FR-008) — it
  never invents an ARK/accession/id.
- **`collectRightsEvidence`** PROPOSES evidence only (grounded `date`/`creator`,
  raw repository statement as `rightsRaw`, `publicationStatus`); it never authors
  the judgment. The operator records the authoritative `rightsAssessment`
  (`rightsStatus` + basis) on the `RepositoryRecord`.
- **`acquire`** is the fail-closed gate (FR-007): only a record whose authored
  `rightsAssessment.rightsStatus === 'public-domain'` may be acquired;
  `restricted`/`uncertain`/absent block mirroring and the source stays cataloged.
  It writes masters + provenance to the object store (Gallica wraps the shipped
  fetcher; IIIF providers share an IIIF helper; non-IIIF are bespoke) and its
  `AcquisitionResult` feeds `bib reconcile` (SSOT status advance).

**Errors (fail loud)**: unknown repository; unverifiable candidate; rights not public-domain (refused, cataloged); acquire mechanism absent (`none-yet` → surfaced as a capability gap, not a silent skip).

## The loop (composition of reused verbs + the adapter)

Per campaign, per repository, one iteration:

```
1. search the repository (DiscoveryMechanism or manual)     → candidates          (US1/US4)
2. append a SearchLogRecord                → search-log.yml (outcome: found|dry)   (US1)
3. for each candidate the researcher judges relevant:
     adapter.resolve → bib inventory → bib verify-member → bib promote             (US4)
     (adapter.collectRightsEvidence proposes; operator records the rightsAssessment)
4. for each approved member whose recorded rightsAssessment is public-domain:
     adapter.acquire(--object-store) → bib reconcile                              (US3/US2)
5. bib coverage                            → re-measure; stop repo×campaign after 2 dry rounds (US7)
```

Reconcile-only closure (US2): for members already acquired out-of-band (masters in the object store), skip 1–4 and run `bib reconcile <id>` directly.

## Assertable invariants (test targets)

- **INV-1**: A search always yields a committed SearchLogRecord (even a `dry` one) — search history never silently stays empty (SC-001).
- **INV-2**: `resolve` throws on an unverifiable candidate; no fabricated id is ever written (FR-008). (`collectRightsEvidence` proposes evidence only; it never authors a judgment.)
- **INV-3**: `acquire` is unreachable unless the record's authored `rightsAssessment.rightsStatus === 'public-domain'` (FR-007 / Principle IV / 011 INV-B).
- **INV-4**: after `acquire` + `reconcile`, the member's RepositoryRecord is `collected`/`archived` and `bib coverage` reflects it (SC-003).
- **INV-5**: an adapter with `acquireMechanism: none-yet` produces a tracked capability gap, never a silently-skipped source (FR-013).
- **INV-6**: the loop never invokes `bib migrate` (FR-012).
