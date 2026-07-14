# Contract: RepositoryAdapter (refined from 009)

Injected interface (Principle VI). Refines 009's `contracts/repository-adapter.md` to canonical I/O + typed results (third-party review §3).

```ts
export interface RepositoryAdapter {
  readonly repository: RepositoryName;                 // 'gallica' | 'new-italy-museum'
  resolve(locator: RepositoryLocator, ctx: ResolutionContext): Promise<ResolvedRepositoryItem>;
  collectRightsEvidence(item: ResolvedRepositoryItem): Promise<RightsEvidence>; // PROPOSES; never decides
  acquire(record: RepositoryRecord, ctx: AcquisitionContext): Promise<AcquisitionResult>;
}

export interface ResolvedRepositoryItem {
  repository: RepositoryName;
  identifiers: CopyIdentifier[];       // e.g. { type: 'accession', value } — never fabricated
  sourceUrl: string;                   // detail-page locator
  assetLocators: AssetLocator[];       // downloadable asset URLs (mechanical, DOM-direct)
  metadata: GroundedExtraction<MuseumItemFields>; // prose fields, each grounded (see structured-extractor)
}

export interface RightsEvidence {
  rightsRaw?: string; date?: GroundedField<string>; creator?: GroundedField<string>;
  publicationStatus?: string; repositoryPolicy?: string; jurisdiction?: string;
}

export interface AcquisitionResult {
  repositoryRecordId: string;
  assets: AcquiredAsset[];             // per-asset: sourceUrl, mediaType, objectStoreKey, checksum, byteLength, provenancePath, role?, sequence?
  metadataSnapshot: MetadataSnapshot;  // what the repository returned at acquire time
  complete: boolean;
  reconciliationRequired: boolean;
}
```

## Invariants (test targets — reuse 009 INV-1..6 where applicable)

- **INV-A (resolve, no fabrication)**: `resolve` throws on an unverifiable candidate; no ARK/accession is ever invented (009 INV-2, Principle V).
- **INV-B (rights fail-closed)**: `acquire` is unreachable unless the record's `rights.rightsStatus === 'public-domain'` was operator-recorded; `collectRightsEvidence` never sets it (Principle IV; 009 INV-3).
- **INV-C (typed result)**: `acquire` returns an `AcquisitionResult`; callers never infer success from side effects. After acquire+reconcile the record is `collected`/`archived` and coverage reflects it (009 INV-4).
- **INV-D (dispatch)**: adapter selection is deterministic by copy-identifier type where a record exists, else explicit `--repository`; ambiguous → throw (no sniffing).
- **INV-E (idempotent)**: re-`acquire` continues from recorded state; no duplicate object; a remote content change → throw or new version, never silent replace.
- **INV-F (never `bib migrate`)**: the loop never invokes `bib migrate` (009 INV-6).

## GallicaAdapter (the cutover)

Wraps the shipped `src/gallica` fetcher behind this interface. The hardwired `ark → runFetchSource` path in `src/sourcegroup/acquire.ts` is REMOVED; acquire routes through the registry → `GallicaAdapter.acquire`. Gated by characterization tests (see quickstart) proving identical ARK inventory / PD verify / archive layout / object-store keys+checksums / source-group guardrails / reconcile transitions.

## NewItalyMuseumAdapter

`resolve` fetches the Musarch detail page (rate-limit-safe HTTP client) → DOM-direct `assetLocators` + `accession`, prose fields via the structured extractor. `collectRightsEvidence` returns the grounded date + stated credit. `acquire` downloads the chosen best-representation asset(s), writes master+provenance to B2, returns the typed result.
