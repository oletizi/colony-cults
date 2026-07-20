# Phase 0 Research: Source-Group Acquisition

All items below resolve a Technical-Context unknown or a spec decision. Format: Decision / Rationale / Alternatives considered.

## D-01 — CLI surface: `bib` subactions, not top-level commands

**Decision**: Add `inventory`, `verify-member`, `promote`, `exclude-member`, and `acquire` as subactions of the existing `bib` command (`bib inventory …`), dispatched through `runBibliography` in `src/index.ts`.

**Rationale**: They mutate the bibliography SSOT (`bibliography/sources/*.yml`), exactly like the existing `bib migrate` / `bib show`. Keeping them under `bib` matches the shipped help text ("Bibliography SSOT verbs (migrate, show, …)") and avoids polluting the top-level fetch-oriented command set.

**Alternatives considered**: top-level commands (rejected — splits SSOT operations across two dispatch surfaces, inconsistent with the shipped grouping).

## D-02 — Discovery mechanism is a gated spike; one mechanism, fail-loud

**Decision**: The first task is a **spike** that evaluates candidate discovery mechanisms and commits the feature to exactly one, behind a `DiscoveryMechanism` interface with a single implementation. Lead candidate: the **BnF general-catalogue SRU** (`catalogue.bnf.fr`), documented bibliographic search, distinct from the anti-bot-blocked Gallica web search. No runtime fallback chain; the helper fails loud when the mechanism is unavailable.

**Rationale**: FR-018/FR-020 and the project fail-loud principle. Gallica web search tripped anti-bot protection during the fetcher work; relevance is a human judgment, so full automation is out. The interface keeps the one implementation swappable without a fallback chain.

**Alternatives considered**: runtime SRU→Playwright→OAI-PMH fallback (rejected — violates fail-loud); Playwright browser automation as the primary (rejected — fragile). If the spike finds no reliable API, the feature accepts **operator-supplied candidate identifiers** (FR-019) rather than browser automation.

## D-03 — Repository verification is a pure deterministic function reused by promote

**Decision**: `verify-member` computes a `Verdict` from a member + selected RepositoryRecord via deterministic checks: identifier resolves (network resolve of the ARK to an OAI record), normalized rights permit acquisition, required metadata present, duplicate classification. `promote` calls the **same** verification function (rerun+record) before transitioning.

**Rationale**: FR-006–008, FR-010a. One code path for the checks means promote's gate and the standalone command can never diverge. Deterministic = no relevance judgment.

**Alternatives considered**: persist a verdict at verify-member time and have promote trust it (rejected by operator — staleness risk if metadata changes between verify and promote; console-only output can't enforce SC-004).

## D-04 — Duplicate classification uses the shipped `(sourceId, sourceArchive)` key

**Decision**: Hard duplicate = same ARK within the same `sourceArchive` (a key collision on `(sourceId, sourceArchive)` copies, or the same ARK already present on another member of the group's archive). Possible duplicate = matching normalized title/creator/date with a different ARK (flagged for review, not a hard fail). A different archive's copy of an existing work attaches a **new RepositoryRecord to the existing Source**.

**Rationale**: FR-008/FR-009. The shipped `RepositoryRecord` is keyed by `(sourceId, sourceArchive)` (`src/model/repository-record.ts:7-9`), so archive is the natural copy discriminator; two copies at the same archive can't both be records under one source.

**Alternatives considered**: title-only matching (rejected — titles vary); ARK-only within-source (insufficient — misses cross-member archive collisions).

## D-05 — RepositoryRecord selection via `--archive <sourceArchive>`

**Decision**: `verify-member` / `promote` / `acquire` accept `--archive <sourceArchive>` to select the target copy. When the member has exactly one RepositoryRecord, the selector may be omitted; when more than one exists and no selector is given, fail loud (FR-009a).

**Rationale**: The shipped composite key `(sourceId, sourceArchive)` already uniquely identifies a copy — no new `RepositoryRecord` id is warranted. Infer-one keeps the common single-copy path ergonomic; fail-loud-on-ambiguity prevents acting on the wrong copy.

**Alternatives considered**: a new synthetic `RR-###` id (rejected — redundant with the existing key, new surface to persist); auto-select a "preferred" record (rejected — silent, violates fail-loud).

## D-06 — Atomic id allocation: exclusive-create + retry, no counter

**Decision**: Allocate the next-free `PB-P###` by scanning `bibliography/sources/` for the max numeric suffix in the `PB-P` namespace, then attempting an **exclusive create** (`wx`) of the target file; on `EEXIST`, rescan and retry.

**Rationale**: FR-001. The SSOT is one-file-per-source; exclusive create is the atomic primitive the filesystem already offers. No mutable counter means nothing to corrupt or de-sync, and the flat namespace is preserved.

**Alternatives considered**: a mutable `next-id` counter file (rejected — a second source of truth that can de-sync from the actual files); a lock file (rejected — heavier, and exclusive-create already gives atomicity); scan-then-write without exclusivity (rejected — the race in the spec).

## D-07 — Raw-metadata: separate immutable snapshot; additive model fields (open operator item)

**Decision (default)**: Preserve each raw repository response as an **immutable acquisition snapshot** file, referenced from the RepositoryRecord by an additive optional field (`metadataSnapshot` → path/retrievedAt/endpoint/normalizationVersion). Re-inventory appends a new snapshot; originals are never overwritten. Rights are stored as `rightsRaw` (evidence) + `rightsStatus` (normalized). The verification verdict is likewise an additive optional field.

**Open operator item**: whether these additive fields are recorded as an explicit **amendment to `specs/004-canonical-source-metadata`** or kept feature-local. Default: keep them as additive optional fields on the shipped interfaces and cross-reference 004; surface the amendment question in tasks for an explicit call. Either way the fields are additive (no breaking change).

**Rationale**: approval clarification 3 + spec-review issue 2. Immutable snapshots keep the canonical record readable while retaining full upstream evidence and supporting later re-normalization. Additive optional fields avoid a breaking model change.

**Alternatives considered**: embed the raw response inline in the RepositoryRecord (rejected — bloats the readable SSOT); store raw only in the private archive with a bare reference (viable, kept as a variant if snapshot-in-SSOT proves heavy).

## D-08 — Acquire wraps the shipped fetcher; no new fetch code

**Decision**: `acquire` resolves the ARK from the selected RepositoryRecord and calls the shipped `runFetchSource` with `--source-id <member> --object-store`. It performs no downloading itself.

**Rationale**: FR-014/FR-015. The shipped fetcher already handles page images → B2, OCR, provenance, and carries the source-group guardrail (blocks the group, not members). Reuse avoids a second fetch implementation.

**Alternatives considered**: metadata-driven fetcher resolution (`fetch-source <id> --repository`) — a stated **target**, out of v1 scope because it is new fetch code (spec Assumptions). v1 resolves the ARK in the acquire wrapper and passes it to the unchanged fetcher.

## D-09 — Testing: vitest, co-located, TDD; network mocked in unit, live in a gated integration path

**Decision**: Unit-test each pipeline stage with the network boundary injected (a `DiscoveryMechanism` / resolver interface), TDD-first. A gated integration test exercises the real BnF mechanism and the real fetcher against a known public-domain ARK; the PB-P004 end-to-end run is the acceptance.

**Rationale**: deterministic unit tests without hitting the archive on every run; one gated live path proves the real integration (SC-001/SC-002). Mock data lives only in tests (project rule).

**Alternatives considered**: live network in all tests (rejected — flaky, anti-bot risk); no live test (rejected — wouldn't prove SC-002).

## Spike outcome (T004)

**Decision: USE the BnF general-catalogue SRU as the single discovery mechanism.**

The spike (T004) evaluated whether the BnF general-catalogue SRU at `catalogue.bnf.fr` is a reliable, documented, programmatically-callable search endpoint — distinct from the Gallica web search (`gallica.bnf.fr` SRU) that tripped anti-bot protection during the fetcher work. It is.

### Evidence

- **Documented public API.** BnF publishes the "API SRU Catalogue général" with a 17-page PDF spec (service_sru_bnf.pdf, 2019-04). The service is SRU **version 1.2**, accessible without authentication, callable over HTTP GET or POST, and explicitly intended for integration into code (RESTful web service). Sources: [api.bnf.fr — API SRU Catalogue général](https://api.bnf.fr/fr/api-sru-catalogue-general), [bnf.fr — Service SRU Catalogue général](https://www.bnf.fr/fr/service-sru-catalogue-general-de-la-bnf), [Service SRU de la BnF — Documentation générale (PDF)](https://www.bnf.fr/sites/default/files/2019-04/service_sru_bnf.pdf).
- **Distinct host from the blocked Gallica search.** This is the bibliographic *catalogue* (`catalogue.bnf.fr/api/SRU`), not the Gallica digitized-object search that was anti-bot-blocked. Different service, different host.
- **Live probe succeeded.** A single `searchRetrieve` probe for `bib.anywhere all "Marquis de Rays"` returned a well-formed `srw:searchRetrieveResponse` with `numberOfRecords = 18`, including an 1858 publication authored by the Marquis de Rays — i.e. real, relevant candidate records, no diagnostic, no anti-bot challenge.

### Chosen endpoint and documented query shape

- **Base URL:** `https://catalogue.bnf.fr/api/SRU`
- **Fixed parameters:** `operation=searchRetrieve`, `version=1.2`
- **Query:** `query=<CQL>` — CQL syntax. Useful bibliographic indexes: `bib.anywhere`, `bib.title`, `bib.author`, `bib.subject`, `bib.persistentid` (ARK), `bib.recordid`, `bib.publicationdate`. Example clause: `bib.anywhere all "Marquis de Rays"`.
- **Record schema:** `recordSchema=` one of `unimarcXchange` (default), `unimarcXchange-anl`, `intermarcXchange`, `intermarcXchange-anl`, `dublincore` (bibliographic records only — the lightest to map to `DiscoveryCandidate` hints).
- **Pagination:** `startRecord` (1-based), `maximumRecords`.
- **Concrete example (from BnF docs):**
  `https://catalogue.bnf.fr/api/SRU?version=1.2&operation=searchRetrieve&query=bib.anywhere%20all%20%22julien%20gracq%22&startRecord=1&maximumRecords=100&recordSchema=unimarcXchange`

### Consequence for the `discover` verb

The `discover` verb **will be shipped**, backed by exactly one `DiscoveryMechanism` — a BnF-general-catalogue-SRU client (concrete network client is task T033; T005 scaffolds only the interface, types, and fail-loud dispatcher). There is **no runtime fallback chain**: when the single configured mechanism is unavailable the dispatcher throws a clear error (project fail-loud principle, FR-018/FR-020). The operator-supplied-candidate-identifiers path (FR-019) remains available as an *explicit operator input*, not as an automatic fallback the software silently selects. Relevance judgment (original court record vs. later historical account) stays a human/agent decision; the SRU mechanism only surfaces candidates.
