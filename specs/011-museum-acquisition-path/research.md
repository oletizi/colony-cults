# Phase 0 Research: New Italy Museum acquisition path

All Technical Context unknowns were resolved during the design phase (design record + third-party review + operator clarifications). No open `NEEDS CLARIFICATION` remains. This consolidates the load-bearing decisions.

## R1 — Adapter seam: extract now, full cutover

- **Decision**: Implement 009's `RepositoryAdapter` interface; refactor the shipped Gallica path into a `GallicaAdapter` and **remove** the hardwired `ark → runFetchSource` path (`src/sourcegroup/acquire.ts:184-210`). No dual path / alias / shim.
- **Rationale**: The museum is the 2nd acquisition repository — the exact trigger 009 (R4/R7) named for pulling the shared seam (T003); the contract is already written. Full cutover matches the project's clean-break rule; safety comes from characterization tests, not from keeping the old path alive.
- **Alternatives**: (A) bespoke type-branch, no shared interface — rejected (seam stays implicit, branch accretes); (C) separate museum tool — rejected (parallel-pipeline drift 009/010 fought).

## R2 — Museum extraction: layered hybrid over the reused engine seam

- **Decision**: Fetch via the existing rate-limit-safe HTTP client. DOM-direct pull for mechanical fields (asset URL, accession id). Prose fields via a `StructuredExtractor` over `createEngine` (`src/engine/factory.ts`), **codex backend by default, model configurable**. A deterministic verifier asserts each field's evidence excerpt is verbatim on the fetched page (and a rights-critical date's excerpt contains its value); ungrounded → fail loud. Persist the excerpt in provenance.
- **Rationale**: Reuse the shipped coding-agent callout (operator steer: no new callout code, no hand-rolled parser). The security/reproducibility axis is handled by the deterministic verifier + persisted evidence, not by choosing a parser. The verifier kills fabrication; operator rights-confirmation backstops mis-attribution; the excerpt makes the record re-verifiable without re-running the model.
- **Alternatives**: pure LLM (rejected — non-deterministic source-of-truth for a rights-critical field); deterministic template parser (rejected by operator — brittle for a volunteer-museum static export; kept as documented fallback); bare `TranslationEngine.run→string` (rejected — pushes fragile text-to-field parsing into the adapter).

## R3 — Adapter dispatch: deterministic + explicit, no sniffing

- **Decision**: Where a `RepositoryRecord` exists (acquire/verify), dispatch by its copy-identifier type (`ark`→Gallica, `accession`→museum). Where the operator supplies a raw locator (inventory), require an explicit `--repository <name>`. Ambiguous/unresolvable → fail loud.
- **Rationale**: Deterministic and testable; no locator-shape sniffing (fragile, against fail-loud). The record already carries its identifier type, so acquire dispatch is a pure function of stored data.
- **Alternatives**: uniform `--repository` everywhere (rejected — needless typing when the record is unambiguous); infer from URL shape (rejected — sniffing).

## R4 — Honest structural kind for museum objects

- **Decision**: Add `kind: 'archival-item'` (a discrete non-serial archival work or object) to `src/model/source.ts` (currently `periodical | monograph | source-group`). Source/asset boundary: one photo/letter = one Source; a multi-page work = one Source, multiple assets; multiple scans/thumb+full of one object = assets of one `RepositoryRecord`.
- **Rationale**: A photograph is not a monograph; mis-typing to pass validation is the dishonest modeling spec 010 removed. `archival-item` chosen over the design's `item` (2nd spec review): grep-safe and unambiguous in logs/errors/APIs, where bare `item` is generic.
- **Alternatives**: `item` (rejected — too generic, ambiguous in logs/APIs); `artifact` / `object` (rejected — "object" collides with the museum's physical artifacts, which we do NOT mirror). Re-use `monograph` (rejected — dishonest).

## R5 — Museum copy identity

- **Decision**: Add `accession` to `CopyLevelIdentifierType` (`src/model/identifiers.ts:12`, currently `ark | iiif-manifest | scan-doi`). The `RepositoryRecord` carries the accession as copy identity + a `sourceUrl` locator; detail-page/asset URLs are locators, not identity.
- **Rationale**: The Musarch accession is durable; export URLs can change across rebuilds. Museum analog of Gallica's ark.
- **Alternatives**: URL as identity (rejected — non-durable); IIIF manifest (rejected — the museum is not IIIF).

## R6 — Rights: fail-closed, operator-recorded via a dedicated step

- **Decision**: Extend `src/model/rights.ts` (`Rights`) with `rightsRaw`, `rightsStatus`, `rightsBasis`, `rightsJurisdiction`, `assessedBy`, `assessedAt`. A dedicated rights-assessment step (a `bib` verb in `src/rights/` + `src/cli/bib-sourcegroup.ts`) surfaces the adapter's collected evidence and writes the fields on operator confirmation. `adapter.collectRightsEvidence` proposes; it never authors the judgment. Acquire enforces a recorded `public-domain` state.
- **Rationale**: Copyright fail-closed (Principle IV); the human judges against the shown evidence excerpt (backstops mis-attribution). A dedicated step is auditable and testable vs a manual YAML edit.
- **Alternatives**: fold into `promote` (rejected — couples rights to promotion); manual YAML edit (rejected — unguided, unauditable).

## R7 — Coverage model: resolution + three-state extent

- **Decision**: Add `resolution` (vocab `unexamined | identified | inventoried | excluded | unavailable` + structured payload) to `suspected[]`; extend `SUSPECTED_KEYS` (`src/bibliography/load-coverage-fields.ts:30`). Replace `knownMemberCount: number | 'unknown'` with `number | 'unexamined' | 'irreducible'` (`validateKnownMemberCount`, same file `:121-133`); `extentBasis` required for a number and `irreducible`. Render both distinctly (`coverage-render.ts`). Remove the bare `'unknown'` literal (fail loud).
- **Rationale**: 009 already specified these (`data-model.md`); PB-P006 proves them. Closes SC-004 and the bare-`unknown` gap.
- **Alternatives**: free-text notes (status quo — rejected, invisible to the audit); full transition-history subsystem (deferred at n=1).

## R8 — Idempotent acquisition + Gallica characterization tests

- **Decision**: Convergent acquire (resolve → confirm rights → fetch metadata → compare identity/expected assets → write missing → verify checksums → write provenance/manifest → reconcile), reusing the fetcher's already-checksummed-asset skip + `--checkpoint`. Remote content changed since inventory → fail loud or version, never silent replace. Gate the Gallica cutover with characterization tests capturing pre-cutover behavior (inventory/verify/acquire/reconcile, archive layout, object-store keys+checksums, source-group guardrails).
- **Rationale**: Preservation integrity + a safe clean cutover. Characterization tests are how "no back-compat" stays non-reckless.
- **Alternatives**: keep the old Gallica path as a safety net (rejected — that IS back-compat); no idempotency (rejected — partial-failure corruption).
