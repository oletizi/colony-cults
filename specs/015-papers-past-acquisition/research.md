# Phase 0 Research: Papers Past Acquisition Adapter

Resolves the plan-level unknowns, including the two research points deferred from the spec (image-CDN reachability; OCR-text storage role) and the architecture-reuse decisions.

## R1 — Image fetch mechanism (spec research point 1)

**Finding (from the persisted capture).** The article facsimile is delivered as **N small GIF article-clip segments** at same-origin URLs of the form `https://paperspast.natlib.govt.nz/imageserver/newspapers/<base64>` (the base64 decodes to `oid=<article-id>&colours=32&ext=gif&area=<n>&width=<w>`). For `HNS18840103.2.19.3` there are 3 segments (area 1/2/3). Same origin as the Incapsula-WAF-gated article page.

**Decision.** Honor the operator's **hybrid** choice: `acquire` fetches each image via the polite bulk-acquisition `HttpClient`, **guarded by a fail-loud image-validity check** — the fetched bytes MUST be a valid image (content-type and/or magic-byte sniff); a WAF challenge page or any non-image response THROWS (never mirror a challenge page as if it were a facsimile). A dedicated verification task confirms reachability against a real `/imageserver/...` URL before the adapter is trusted end-to-end.

**Fallback (documented).** If verification shows the image origin is JS-challenged too (the stateless client gets a challenge, not a GIF), the resolution is to extend the spec-014 `BrowserSession` with a byte-fetch that runs inside the WAF-cleared browser context and fetch images there. This keeps "no ad-hoc side channel" — both paths are governed mechanisms.

**Rationale.** Incapsula commonly challenges HTML navigation (JS/cookie) but serves static assets without a JS challenge, so the stateless image fetch *may* work; the guard makes the wrong outcome loud, and the verification task decides definitively without pre-committing.

**Alternatives considered.** All-browser byte-fetch from the start (safest, but extends the browser before it is known to be necessary — the operator chose hybrid). Confirm-first (the operator declined pre-committing to it).

## R2 — OCR-text storage (spec research point 2)

**Decision.** Add an **`ocr-text`** role to the `AcquiredAsset` role union and store the article's OCR text as a **separate object** (a `.txt`) under `archive/papers-past/<article-id>/`, checksummed and provenanced exactly like the `page-master` images.

**Rationale.** The OCR is held corpus content — searchable, citable, first-class — not mere retrieval metadata. Treating it as an `AcquiredAsset` (its own object key + checksum + provenance) makes it durable and grep-traceable, consistent with how the corpus treats acquired content. It is a companion to the page-image master (which remains the authoritative facsimile).

**Alternatives considered.** Store the OCR in the record's `metadataSnapshot` (lighter, but the OCR is then not a first-class held/searchable asset and lacks its own checksum/provenance). Store as an untyped page-master-adjacent file (ambiguous role, breaks the typed roles union).

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
