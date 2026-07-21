# Design: Source-agnostic discovery + governed Papers Past mechanism (census Phase 1)

**Date**: 2026-07-19
**Origin**: spec-015 follow-on (TASK-39 vein); SRCH-0018 (695 raw Papers Past "Marquis de Rays" hits); PB-P061 acquired end-to-end via the shipped Papers Past adapter.
**Status**: Approved design (brainstormed 2026-07-19; third-party design review incorporated 2026-07-19 — refinements 1–5 below), pending `/stack-control:define` as spec 016.

## Purpose

Turn the Papers Past de Rays vein from 1 acquired article into a *measured* vein: run a **bounded, governed census** of the ~695-hit "Marquis de Rays" search, deduplicate to distinct articles, and produce candidates that feed the existing promote→acquire pipeline. The acquisition-scope decision (Phase 2) is made *after* the census, from real data.

This is deliberately **census-first**: reading all 695 articles would *be* the acquisition. The census is metadata-only (search rows), bounded to a sample (`--limit`), and writes no B2 objects.

## Context — what already exists (do NOT rebuild)

The corpus already has a discovery framework, and the census must reuse it rather than build a parallel census module:

- **`DiscoveryCandidate`** = `{ identifier, titleHint?, creatorHint?, dateHint?, endpoint }` — exactly a census row.
- **`DiscoveryMechanism`** interface (`search(query, {maxResults?, startRecord?})`) + **`DiscoveryDispatcher`**.
- **`bib discover`** verb → the **discover → promote → acquire** flow (candidates become `discovered` members; `promote` advances them to `approved-for-acquisition`; `acquire` mirrors bytes).
- A `data/census/` artifact convention (e.g. the Gallica periodical census `data/census/PB-P001-la-nouvelle-france.json`).

**Two real gaps** the census exposes (confirmed in code):
1. **Not source-agnostic.** `DiscoveryDispatcher` is "backed by exactly one mechanism"; `DiscoveryEndpoint = 'bnf-catalogue-sru' | 'operator-supplied'`. Single-source by design.
2. **Not on the governed source-query envelope.** `BnfSruDiscoveryMechanism` calls `HttpClient.getText()` directly against the BnF SRU endpoint — polite (rate-limit/backoff) but **not persist-before-analysis** and not the spec-014 governed client. So existing discovery sits outside the full Principle XII / fetching-online-sources envelope.

## Design decisions (from brainstorming, 2026-07-19)

1. **Census-first, bounded sample.** Phase 1 enumerates a bounded sample of the search (via `--limit`), dedups, and classifies coarsely from search metadata; Phase 2 (acquisition scope) is decided from the catalog. Chosen over exhaustive-all-695 (heavy source load) and hand-picked-subset (leaves the vein unmeasured).
2. **Reuse the discovery framework.** The census output is `DiscoveryCandidate`s via `bib discover` — NOT a new census module or catalog format. Candidates flow through the existing promote→acquire pipeline.
3. **Bounded sample sidesteps WAF resilience.** A bounded page walk fits in one governed session, so no mid-walk auto-refresh (TASK-44) is needed. (Full-695 exhaustive walk + auto-refresh is a later option, not this feature.)
4. **Generalize + govern Papers Past; capture the BnF gap.** Make the dispatcher source-agnostic (mechanism registry keyed by source) and route the Papers Past mechanism through the governed browser `SourceQueryClient`. Leave BnF SRU as the polite-HTTP mechanism it is; capture a backlog item to bring it under persist-first governance later.
5. **Governance is per-transport, not "browser everything."** The spec-014 infrastructure is a real browser — correct for a WAF-gated web search (Papers Past), wrong for a clean XML API (BnF SRU; a browser at an API is heavier, not more CDN-friendly). The unifying thing is Principle XII's envelope (polite + persist-first + fail-loud grounding + sanctioned channel), applied via the appropriate transport (browser for WAF web, governed-HTTP for APIs).

## Components

### 1. Source-agnostic dispatcher
Generalize `DiscoveryDispatcher` from single-mechanism to a **registry keyed by source/endpoint**. Extend `DiscoveryEndpoint` to include `'papers-past'`. `bib discover --source <endpoint>` selects the mechanism; the default stays `bnf-catalogue-sru` (back-compatible with the current no-flag behavior). Fail-loud (never silent fallback) on an unknown source or an unavailable mechanism (`isAvailable()` false).

### 2. Bounded multi-page walk (spec-014 `SourceQueryClient` enhancement)
Implement the `pages > 1` path (currently throws as "a later enhancement"): walk pages 1..K **within one governed browser session**, paced by the existing `PolitenessPolicy` (min inter-navigation interval), persist-before-analysis on **each** page, and aggregate the per-row candidates across pages. Bounded by the caller's limit → a handful of paced fetches, comfortably inside one session. Fail-loud on a WAF challenge / grounding failure (the raw page is already persisted).

### 3. `PapersPastDiscoveryMechanism` (implements `DiscoveryMechanism`)
`endpoint: 'papers-past'`. `search(query, {maxResults})` drives the governed browser `SourceQueryClient` (bounded multi-page walk) and maps each result row → `DiscoveryCandidate`: `identifier` = the article code extracted from the row `ref` (the `oid`, e.g. `HNS18840103.2.19.3`), `titleHint` = the row title, `dateHint` = newspaper + date. `isAvailable()` reflects the browser client's readiness. Constructor-injected `SourceQueryClient` (composition/DI; a fake in tests → no network).

**Deduplication is repository-scoped, NOT work-level identity (review refinement 1).** The mechanism dedups by article code *within one Papers Past census* — the article code is a *repository* identifier, not an intellectual-work identifier. Repository-level dedup during discovery does NOT imply work-level identity: a Papers Past article, a Trove article, and a British Newspaper Archive article may be the same intellectual work. Concluding that — and attaching an additional `RepositoryRecord` to an existing `Source` rather than creating a duplicate `Source` — remains the job of **promotion**, where research judgment enters the model. The census never asserts work identity.

**`DiscoveryCandidate` carries discovery provenance (review refinement 2).** Beyond `identifier`/`titleHint`/`dateHint`, each candidate preserves enough to make later investigation deterministic and to record research history when multiple searches surface the same article — e.g. `repositoryIdentifier`, `searchQuery`, `searchPage`, `searchRank`, and `capturedFrom` (the search-log id, e.g. SRCH-00NN). This is provenance describing *how* the candidate entered the corpus (Principle III), not a duplicate of the persisted HTML. These fields are additive/optional on the shared type so existing mechanisms (BnF SRU) remain valid.

**Classification is advisory only (review refinement 3).** Any coarse "substantial vs passing mention" label the census derives is heuristic, metadata-derived, and **advisory** — for reporting and prioritization. It MUST NOT feed promotion or acquisition automatically. Promotion remains the authoritative point where research judgment enters the corpus (Principle I: evidence and interpretation kept visibly separate).

### 4. Search-log record (SRCH-00NN)
Document the census run per the "always record the find" rule: query, pages/limit sampled, raw hits, distinct-after-dedup, coarse (advisory) classification counts, an extrapolation to the full 695, and the persisted captures. No corpus member is created by the census itself (candidates are surfaced for the operator to curate/promote).

- **Version the census algorithm (review refinement 4).** Record `censusVersion: 1` so a later change to the dedup or classification logic is reproducible and distinguishable — "the corpus changed" vs "the census became better."
- **Extrapolation is informational (review refinement 5).** The extrapolation to ~695 is a **planning estimate**, never a corpus fact. It MUST NOT appear in coverage metrics as known inventory. The only canonical facts are the sampled results, the discovered candidates, and (later) the promoted `Source`s.

### 5. Backlog (deferred follow-on)
Capture: "bring BnF SRU discovery under persist-first governance" (a governed-HTTP transport that persists the SRU response before parsing, so every discovery mechanism honors the full Principle XII envelope uniformly).

## Governance

Every Papers Past fetch goes through the governed browser `SourceQueryClient` (Principle XII / `fetching-online-sources`): polite (paced), persist-before-analysis, WAF-clearing, one sanctioned channel — no ad-hoc `curl`/`WebFetch`/raw browser. The bounded sample keeps source load minimal. The census writes no B2 objects and creates no corpus members; it only surfaces candidates.

## Flow (reuses the existing pipeline)

```
bib discover --source papers-past --query "Marquis de Rays" --limit N
  → PapersPastDiscoveryMechanism.search → governed bounded page walk → DiscoveryCandidate[] (deduped by code)
  → [operator curates]
  → candidates become `discovered` source-group members
  → bib promote   (discovered → approved-for-acquisition; verification arm already wired for papers-past)
  → bib acquire   (Phase 2 — the shipped Papers Past adapter: WAF-cleared browser byte-fetch → B2)
  → bib reconcile (→ status: archived, masters confirmed in object store)
```

## Out of scope

- Acquisition of the discovered candidates (Phase 2 — separate, uses the shipped adapter).
- The full-695 exhaustive walk + mid-walk WAF auto-refresh (TASK-44).
- Per-article content reads during the census (metadata-only).
- Retrofitting BnF SRU discovery onto persist-first governance (backlogged).

## Constraints

TypeScript ESM, `@/` imports, no `any`/`as`/`@ts-ignore`; composition + constructor DI (no inheritance); files ≤ 500 lines; fail-loud everywhere (Principle V); governed source access only (Principle XII); spec-driven through the stack-control front door (Principle VIII).
