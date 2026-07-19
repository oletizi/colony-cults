# Phase 0 Research: Papers Past Acquisition Adapter

Resolves the plan-level unknowns, including the research points deferred from the spec (image-CDN reachability; OCR-text handling) and the architecture-reuse decisions.

## R1 — Image fetch mechanism (spec research point 1)

**Finding (from the persisted capture).** The article facsimile is delivered as **N small GIF article-clip segments** at same-origin URLs of the form `https://paperspast.natlib.govt.nz/imageserver/newspapers/<base64>` (the base64 decodes to `oid=<article-id>&colours=32&ext=gif&area=<n>&width=<w>`). For `HNS18840103.2.19.3` there are 3 segments (area 1/2/3). Same origin as the Incapsula-WAF-gated article page.

**Decision — CONFIRMED (live `bib acquire`).** The stateless `HttpClient` fetch of a real `/imageserver/...` URL **FAILS** ("fetch failed"): the image CDN sits behind the same Incapsula WAF as the article page, so the stateless client is challenged/blocked, not served the GIF. The **hybrid stateless image path is therefore retired.** `acquire` now fetches each image's bytes **inside the WAF-cleared browser context** via `BrowserSession.fetchBytes(url)` — an in-page `fetch` (`credentials: 'include'`) that runs on the already-navigated article page (same origin), reusing the cleared browser's cookies/TLS/origin, marshalling the bytes back as base64. The session is opened ONCE and stays open across the page read AND every image byte fetch. The **fail-loud image-validity check is retained** — the fetched bytes MUST be a valid GIF (GIF87a/GIF89a magic-byte sniff); a WAF challenge page or any non-image response THROWS (never mirror a challenge page as a facsimile).

**Rationale.** Incapsula covers the `/imageserver/` asset origin too (not just HTML navigation), so only the WAF-cleared browser context is served the real bytes. Fetching them via the same open session keeps "no ad-hoc side channel" — one governed mechanism (the spec-014 browser) performs both the page read and the byte fetch.

**Alternatives considered.** The originally-planned hybrid (stateless `HttpClient` byte fetch guarded by the image-validity check) — retired: the live `bib acquire` proved the stateless origin is WAF-gated, so the documented R1 fallback (browser byte-fetch) is now the only path. Confirm-first (the operator declined pre-committing) is moot now that the outcome is confirmed.

## R2 — OCR-text handling (spec research point 2) — RESOLVED: OUT OF SCOPE

**Decision (operator, 2026-07-19).** OCR text is **out of scope as an acquired asset** for this adapter. The corpus already has an OCR + translation pipeline that produces OCR from the held page-image facsimile, so the adapter neither stores OCR as an `AcquiredAsset` nor adds an `'ocr-text'` role. The mechanical parse MAY expose the on-page OCR text as an OPTIONAL convenience field of its pure result type (`ParsedArticle.ocrText?`), best-effort and never fabricated, but it is not propagated to `acquire` and not persisted.

**Rationale.** OCR is a nice-to-have here, not a preservation deliverable: the page-image facsimile is the authoritative master, and OCR is generated downstream by the existing pipeline (single source of OCR truth, no duplicate/competing OCR path). This also avoids introducing a type-safe OCR carrier on the shared `ResolvedRepositoryItem` contract for an optional field (analyze finding H1). Rights statement + article date ride the existing `metadata` carrier (museum pattern), so no shared-contract change is needed.

**Alternatives considered (superseded).** Add an `'ocr-text'` role + store the OCR `.txt` as a first-class checksummed asset (rejected — duplicates the pipeline's job and forces an OCR carrier on the shared contract). Store OCR in the record `metadataSnapshot` (rejected — same duplication, and the adapter is not the OCR source of truth).

## R3 — Facsimile composition

**Decision.** A Papers Past article's facsimile is the ordered set of its `/imageserver/...&area=<n>` GIF segments. `acquire` mirrors **all** segments as sequenced `page-master` assets (sequence = `area` order); none is silently dropped (spec Edge Case). The article-id is stable in the `oid` param, so the object key is deterministic per segment.

## R4 — Adapter architecture (reuse)

**Decision.** Model the **New Italy Museum** adapter (`src/repository/new-italy-museum/adapter.ts`, ~465 lines, the single-asset template) rather than the IA pagination pipeline. Constructor DI: `{ browserSession, byteFetchClient (getBytes), objectStore, now }`. Implement the three `RepositoryAdapter` methods. Add `papers-past` to `RepositoryName` (`src/repository/adapter.ts`), to `CopyLevelIdentifierType` + `COPY_LEVEL_TYPES` (`src/model/identifiers.ts`), and one dispatch row to `IDENTIFIER_TYPE_REPOSITORY` (`src/repository/registry.ts`).

**Rationale.** Papers Past is single-item, single-(multi-segment)-asset, HTML-parse-driven — structurally the museum adapter, not IA's poppler/scandata/leaf-range machinery.

## R5 — Governed page read (reuse spec 014)

**Decision.** `resolve` reads the article page through the **spec-014 `BrowserSession`** (the real Playwright session that clears the Incapsula WAF — validated in SRCH-0018/0019), persisting the raw page via the spec-014 persistence before parsing (persist-before-analysis). The adapter depends on the `BrowserSession` interface (injected), so tests use a `FakeBrowserSession` scripting the persisted article HTML — no network, no host. Mechanical parse mirrors the shipped `papers-past-article` content-read config selectors (`h3` title, `#text-tab` OCR, `.imageserver` image URLs, the "No known copyright" rights block, `.article-preview__publication`/`__year` are search-page-only — article metadata comes from the breadcrumb/heading).

**Rationale.** The governance rule is one sanctioned read mechanism; spec 014 already ships it and it is the only thing that clears the WAF. Reuse, do not reinvent.

## R6 — Member acquirability (from the 2026-07-18 clarification)

**Decision.** The de Rays article `Source` (kind periodical, case `port-breton`) is made acquirable **as a member of a source-group** with `status: approved-for-acquisition`, flowing through the existing `runAcquire` member path unchanged. A minimal NZ-press source-group is created/reused for the port-breton case. The standalone-source approval path (TASK-27) is out of scope.

**Rationale.** Lowest-friction reuse of the shipped member-acquire path; the de Rays NZ press articles naturally form a group (as the Trove/press residuals do). Keeps this feature the adapter, not a second feature.

## R7 — Rights evidence → operator verdict

**Decision.** `collectRightsEvidence` maps NLNZ's verbatim "No known copyright (New Zealand)" into `RightsEvidence.rightsRaw` + `jurisdiction: NZ` + the grounded article date, with **no** status (evidence, not judgment — the adapter invariant). The operator authors the `RightsAssessment` (`rightsStatus: public-domain`, `rightsBasis` = the NLNZ statement, `rightsJurisdiction: NZ`) via the existing `bib rights-assess` flow; that gates `acquire` fail-closed. Mirrors the museum/IA precedent exactly.
