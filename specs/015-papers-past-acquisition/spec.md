# Feature Specification: Papers Past Acquisition Adapter

**Feature Branch**: `feature/corpus-gap-closure` (numbered spec dir; one-long-lived-branch model)
**Created**: 2026-07-18
**Status**: Draft
**Origin**: backlog thread TASK-39 (NZ press discovery); design at `docs/superpowers/specs/2026-07-18-papers-past-acquisition-adapter-design.md`
**Input**: Add a repository adapter for Papers Past (NLNZ) so `bib acquire` can mirror one discrete public-domain Papers Past newspaper article — its page-image facsimile(s) plus OCR text — into the corpus archive and B2, end-to-end, parallel to the Gallica / New Italy Museum / Internet Archive adapters.

## Context

Search-log SRCH-0018/0019 established a live, high-yield, previously-untried discovery axis: the de Rays / Port-Breton affair is reported in **695 discrete Papers Past (National Library of New Zealand) newspaper articles**, and one was validated end-to-end through the governed query client — article `HNS18840103.2.19.3` ("CONVICTION OF MARQUIS DE RAYS", Hawera & Normanby Star, 3 January 1884), carrying NLNZ's explicit **"No known copyright (New Zealand)"** rights statement, with OCR text and page-image scans captured. The corpus can now *query* Papers Past but cannot *acquire* from it: `bib acquire` dispatches strictly on copy kind (Gallica ark, museum accession, Internet-Archive item), and Papers Past is none of these. This feature adds the missing acquisition adapter so a discrete public-domain Papers Past article can be mirrored into the held corpus.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Acquire one public-domain Papers Past article end-to-end (Priority: P1) 🎯 MVP

An operator has a corpus Source for a discrete Papers Past article (identified by its article code, e.g. `HNS18840103.2.19.3`) with an operator-authored public-domain rights assessment. They run `bib acquire` for it. The system resolves the article, mirrors its page-image facsimile(s) and OCR text into the corpus archive and B2 object store, and records the acquired assets + provenance on the copy record — with the same idempotency, dry-run safety, and fail-loud guarantees as the existing adapters.

**Why this priority**: This is the whole point of the feature — turning the validated, high-yield Papers Past vein from queryable into acquirable. Everything else (rights gating, fetch mechanics) exists to make this one acquisition correct and safe.

**Independent Test**: With a fake browser session (scripting the persisted article HTML), a fake byte-fetch client, and a fake object store, drive `acquire` on a record carrying a public-domain assessment; confirm the page-image asset(s) + OCR companion are put to the object store under `archive/papers-past/<id>/…`, the assets + provenance are recorded, a re-run is idempotent (no duplicate write), and a dry run performs no object-store write.

**Acceptance Scenarios**:

1. **Given** a Source + `papers-past` copy record with a public-domain rights assessment and the article's persisted page, **When** `bib acquire` runs, **Then** the adapter resolves the article (title, page-image URLs, OCR text, metadata), fetches each page-image, computes its checksum, puts it to the object store under a deterministic `archive/papers-past/<id>/<sha256>.<ext>` key with `role: page-master` (sequenced), stores the OCR text as a companion, and records the `AcquiredAsset`s + provenance on the record.
2. **Given** an article already acquired (assets present in the object store at the same checksum), **When** `bib acquire` re-runs, **Then** no duplicate object-store write occurs and the result converges on the existing assets (idempotent by object key + checksum).
3. **Given** `--dry-run`, **When** `bib acquire` runs, **Then** the item is validated read-only and NO object-store write and NO record mutation occur.
4. **Given** the remote article page or image has changed since resolution (checksum/identity mismatch), **When** acquisition proceeds, **Then** the run fails loud rather than silently mirroring changed bytes.

---

### User Story 2 - Rights are evidence-first, operator-gated, and fail-closed (Priority: P2)

The adapter surfaces the rights **evidence** it reads on the article page (NLNZ's "No known copyright (New Zealand)" statement, verbatim, plus jurisdiction and date) but never authors a rights **verdict**. Acquisition is refused unless an operator has authored a public-domain rights assessment on the record — no bytes are mirrored on an unassessed or non-public-domain record.

**Why this priority**: Mirroring copyrighted material is the cardinal risk. The evidence/verdict separation and the fail-closed gate are the safety property that makes acquisition trustworthy; they are second only to the acquisition itself.

**Independent Test**: Call `collectRightsEvidence` on a resolved article and confirm it returns the NLNZ statement as raw evidence with NZ jurisdiction and no status field. Then call `acquire` on a record with no assessment, and on one assessed non-public-domain: both refuse fail-loud before any fetch or object-store write.

**Acceptance Scenarios**:

1. **Given** a resolved article carrying "No known copyright (New Zealand)", **When** `collectRightsEvidence` runs, **Then** it returns that text verbatim as raw rights evidence + `jurisdiction: NZ` + the article's grounded date, and carries NO rights-status verdict.
2. **Given** a record with no rights assessment (or one assessed `restricted`/`uncertain`), **When** `acquire` runs, **Then** it refuses fail-loud BEFORE any page fetch or object-store write (0 bytes mirrored).
3. **Given** a record the operator has assessed `public-domain` (basis = the NLNZ statement), **When** `acquire` runs, **Then** acquisition proceeds.

---

### User Story 3 - Governed hybrid fetch clears the WAF without off-roading (Priority: P3)

Papers Past sits behind an Incapsula WAF that the corpus's stateless HTTP client cannot clear, but the shipped real-browser query client can. The adapter reads the article page through the governed real-browser session (persist-before-analysis) and fetches the image bytes through the polite bulk-acquisition client — one discovery/read mechanism, one bulk-bytes mechanism, no ad-hoc side channel.

**Why this priority**: Without a WAF-clearing read path the adapter cannot function at all; and the read path must stay inside the sanctioned governance (no curl/WebFetch/ad-hoc browser). It is P3 only because it is the transport under US1/US2, not a separately shippable outcome.

**Independent Test**: Confirm the adapter's page read is performed via the injected governed browser session (a fake in tests, never the real host), that the raw page is persisted before it is parsed, and that image bytes are fetched via the injected byte-fetch client. No test path touches the network or the real host.

**Acceptance Scenarios**:

1. **Given** an article page behind the WAF, **When** the adapter resolves it, **Then** the page is read through the governed real-browser session and the raw page is persisted before any parsing.
2. **Given** resolved image URLs, **When** the adapter acquires, **Then** the image bytes are fetched through the polite bulk-acquisition client (the shipped, Principle-XII-governed acquisition path), not an ad-hoc fetch.

---

### Edge Cases

- **Image CDN also WAF-gated**: if the page-image URLs are not reachable by the stateless byte-fetch client (Incapsula covers them too), the adapter MUST fail loud with a clear diagnostic rather than mirror a challenge page as if it were an image; the resolution (browser byte-fetch) is a documented follow-up decided in the research phase.
- **Article with multiple page-images**: a single article can span multiple image scans; all are acquired as sequenced `page-master` assets, none silently dropped.
- **OCR text absent or empty**: if the article page has no OCR text panel, the page-image facsimile is still the master; the missing OCR is recorded honestly, not fabricated.
- **Non-public-domain / unassessed record**: acquisition refuses fail-loud with zero side effects (US2).
- **Remote change between resolve and acquire**: identity/checksum mismatch fails loud (US1 scenario 4); no silent mirror of changed bytes.
- **Not an article page** (wrong code, a search or error page): resolution fails loud rather than fabricating identifiers or assets.

## Requirements *(mandatory)*

### Functional Requirements

**Repository model + dispatch**

- **FR-001**: The system MUST add a `papers-past` copy kind to the copy-level identifier vocabulary, whose value is the Papers Past article code (e.g. `HNS18840103.2.19.3`).
- **FR-002**: The system MUST add `papers-past` to the repository-name vocabulary and MUST add exactly one identifier→repository dispatch row so a `papers-past` copy routes to the new adapter; a copy of another kind MUST NOT route to it.

**Adapter contract**

- **FR-003**: The system MUST provide a Papers Past repository adapter implementing the existing `RepositoryAdapter` contract (`resolve`, `collectRightsEvidence`, `acquire`) with constructor-injected dependencies (a governed browser session, a byte-fetch client, an object store, an injectable clock) so the adapter is unit-testable with no network and no host mutation.
- **FR-004**: `resolve` MUST read the article page through the governed real-browser session, persist the raw page before any parsing, and mechanically parse the article title, the page-image asset URL(s), the OCR text, the newspaper/date/page metadata, and the rights statement. It MUST fail loud when the article code or the page-image URL(s) are absent (never fabricate an identifier or asset — resolve-fail-loud).
- **FR-005**: `collectRightsEvidence` MUST surface the article's rights statement ("No known copyright (New Zealand)") verbatim as raw rights evidence, with NZ jurisdiction and the grounded article date, and MUST NOT carry any rights-status verdict (evidence, not judgment).
- **FR-006**: `acquire` MUST refuse fail-loud, before any page fetch or object-store write, unless the record carries an operator-authored public-domain rights assessment (fail-closed rights gate).
- **FR-007**: `acquire` MUST fetch each page-image via the polite bulk-acquisition byte-fetch client, compute a content checksum, and put each to the object store under a deterministic `archive/papers-past/<article-id>/<sha256>.<ext>` key with `role: page-master` and a stable sequence, and MUST persist the article's OCR text as a companion of the acquired record.
- **FR-008**: `acquire` MUST be idempotent by object key + checksum — a re-run of an already-mirrored article MUST NOT write a duplicate — and MUST fail loud on a remote-change / identity mismatch rather than mirror changed bytes.
- **FR-009**: Under dry-run, `acquire` MUST perform read-only validation with NO object-store write and NO record mutation.
- **FR-010**: `acquire` MUST return a typed acquisition result (assets + metadata snapshot + completeness) that the persistence layer records on the copy record, so a subsequent `bib show`/coverage reflects the held facsimile + OCR.

**CLI + member integration**

- **FR-011**: The `bib acquire` CLI MUST build and dispatch the Papers Past adapter for a member whose selected copy is `papers-past` (mirroring the museum/IA adapter-builders), and MUST NOT pay the adapter's construction cost for a non-papers-past copy.
- **FR-012**: The `bib inventory` repository allowlist (and any repository enumeration the CLI surfaces) MUST recognize `papers-past` as a supported repository.
- **FR-013**: The feature MUST provide a corpus Source for the validated de Rays article (kind periodical, case `port-breton`) plus its `papers-past` copy record, made acquirable through the existing member-acquire path.

**Governance + provenance**

- **FR-014**: Article-page reads MUST go through the governed real-browser session (the `fetching-online-sources` sanctioned client) — never curl / WebFetch / raw HTTP / an ad-hoc browser call. Image-byte fetches MUST go through the shipped bulk-acquisition client (the separately-Principle-XII-governed acquisition path).
- **FR-015**: The Papers Past code path (page read, byte fetch, object-store write, host state) MUST be exercised in automated tests ONLY through injected fakes; it MUST NEVER hit the network or mutate the real object store / host during the test suite.

### Key Entities *(include if data involved)*

- **PapersPastCopy**: a copy record of kind `papers-past` whose identifier value is the article code; carries the operator rights assessment, the source (article) URL, and the acquired assets.
- **ResolvedArticle**: the mechanically-parsed article — identifiers, title, page-image asset locators, OCR text, newspaper/date/page metadata — produced by `resolve`.
- **RightsEvidence (NZ)**: the verbatim NLNZ "No known copyright (New Zealand)" statement + jurisdiction + grounded date, with no verdict.
- **AcquiredAsset (page-master / OCR companion)**: the mirrored page-image facsimile(s) and the OCR text, each with object-store key, checksum, byte length, role, and provenance path.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can acquire the validated de Rays Papers Past article end-to-end with a single `bib acquire` invocation, and its page-image facsimile + OCR text are held in the corpus archive + B2 with recorded provenance.
- **SC-002**: 0 acquisitions occur on an unassessed or non-public-domain record — every mirrored article is preceded by an operator public-domain rights assessment (fail-closed).
- **SC-003**: A re-run of an already-acquired article performs 0 duplicate object-store writes (idempotent), and a dry run performs 0 writes.
- **SC-004**: 0 rights verdicts are authored by the adapter — every rights judgment in the record is operator-authored; the adapter contributes evidence only.
- **SC-005**: The full Papers Past acquisition code path passes its automated tests with injected fakes, with 0 network calls and 0 real object-store / host mutations in the suite.
- **SC-006**: Acquiring a Papers Past article requires no tool-choice decision beyond `bib acquire` — the article-page read and the byte fetch both go through the shipped sanctioned mechanisms (no ad-hoc channel).

## Assumptions

- The shipped real-browser query client (spec 014) is reusable as the governed page-read transport for the adapter (its `BrowserSession` boundary is injectable and clears the Incapsula WAF, as validated in SRCH-0018/0019).
- Papers Past newspaper content in the target era is public-domain in New Zealand and carries NLNZ's "No known copyright (New Zealand)" statement; the operator authors the corresponding rights assessment.
- The corpus archive root and B2 object-store credentials are configured for a real acquisition run (per the per-session-archive-clone policy); the adapter itself needs no credentials for resolve-only use.
- MVP scope is one-article acquisition. Batch acquisition of many articles, a deduplicated discrete-item census of the 695, whole-page / whole-issue acquisition, and the US (Chronicling America) / Italian (Camera dei Deputati) axes are explicit follow-ons, out of scope here.
- Three points are deferred to the plan's research phase: (1) whether the Papers Past image CDN is reachable statelessly or is WAF-gated (fallback: browser byte-fetch); (2) OCR-text storage as a new `ocr-text` asset role vs the metadata snapshot; (3) member acquirability via source-group membership vs the standalone-source approval path (TASK-27).
