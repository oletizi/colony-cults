# Feature Specification: Corpus Browser

**Feature Branch**: `feature/corpus-browser`

**Created**: 2026-07-09

**Status**: Draft

**Roadmap item**: `impl:feature/corpus-browser`

**Design record**: [docs/superpowers/specs/2026-07-09-corpus-browser-design.md](../../docs/superpowers/specs/2026-07-09-corpus-browser-design.md) (approved) · reading-view mockup: [docs/superpowers/specs/2026-07-09-corpus-browser-reading-view-mockup.html](../../docs/superpowers/specs/2026-07-09-corpus-browser-reading-view-mockup.html)

**Input**: Author a static website to browse the historical corpus so a human can hold a source page, its French words, and an English translation at once, inside an archival frame that never lets the propaganda pass for truth. v1 target: source PB-P001 (*La Nouvelle France*, 78 issues), with the data layer generalized so other sources slot in.

---

## Overview

The corpus — page-image masters (in the archive object store), OCR issue text, corrected-French and English translations, census data, and canonical source metadata — is not readable by a human without a purpose-built surface. This feature delivers a **static, build-time-generated website** that presents each source page as a **facsimile beside its parallel text** (French OCR + English translation), inside a cool archival frame whose signature is a monospace **provenance rail** — the archive's hand on the propaganda.

The audience is **public-reader, internal-first**: the build reads the private archive locally to generate the site; publishing to a public host is a **deliberate, separate export** of public-domain text and images (a later decision, designed-for but not foreclosed here).

> **UX/UI gate (project commandment — Constitution Principle I):** All user-facing design work for this feature — the reading view, navigation surfaces, search UI, and the "Prospectus/Dossier" visual identity — MUST be carried out through the `/frontend-design:frontend-design` skill. No off-road UI implementation. The reading-view mockup referenced above was itself produced under that skill and is the design reference.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read a page as facsimile & parallel text (Priority: P1)

A reader opens a specific page of a source issue and sees the authoritative page scan in a deep-zoom viewer leading the layout, with the page's French OCR and the English translation stacked beside it. They can zoom and pan the scan to inspect the original, and read the French and English alongside it.

**Why this priority**: This is the core value and the MVP — holding the scan, the French, and the English together. It is the reason the site exists. Every other story orbits it. Delivering only this story (for even one page) already produces a usable reading surface.

**Independent Test**: Build the site for a single known PB-P001 page and open its page route; confirm the scan renders in a zoom/pan viewer, the French OCR text for that page is shown, and the English translation is shown alongside, with no server required.

**Acceptance Scenarios**:

1. **Given** a corpus containing PB-P001 issue and page data, **When** the reader opens a page route, **Then** the page's master scan is displayed in a deep-zoom viewer that supports zoom and pan, with the French OCR text and the English translation presented alongside it.
2. **Given** a page whose OCR carries a low-quality/condition note (e.g. "Contraste insuffisant"), **When** the reader views that page, **Then** the noisy nature of the OCR is visibly framed (the scan remains authoritative and prominent) rather than the OCR being presented as clean truth.
3. **Given** the corpus is missing a required field for a page (e.g. no scan handle or no OCR), **When** the site is built, **Then** the build fails loud with a clear error identifying the source/issue/page and the missing data — it does not silently substitute a fallback or placeholder.

---

### User Story 2 - Navigate the corpus: source → issue → page (Priority: P1)

A reader moves through the corpus along its natural structure: from a source, to one of its issues, to a page within that issue, and forward/back through pages within the issue.

**Why this priority**: Reading (US1) is only reachable if the reader can get to a page. Source/issue/page routing and within-issue page navigation are the connective tissue that makes the reading view usable across the 78 issues of PB-P001.

**Independent Test**: Build the site and confirm a reader can start at a source, select an issue, land on a page, and page forward/back within that issue, with each hop producing a stable, linkable route.

**Acceptance Scenarios**:

1. **Given** a built site, **When** the reader visits a source, **Then** they see the source's issues and can select one.
2. **Given** an issue with N pages, **When** the reader is on page k, **Then** they can navigate to page k+1 and k−1 within the issue, and each page has its own stable route.
3. **Given** any page route, **When** the reader copies/shares the URL, **Then** the same page reading view is reproduced (routes are stable and deep-linkable).

---

### User Story 3 - Search across OCR and translation text (Priority: P2)

A reader enters a query and finds occurrences across the corpus's OCR and translation text, then jumps from a result to the corresponding page reading view.

**Why this priority**: Search turns the browser from linear reading into research. It depends on the reading view and navigation existing (US1/US2) but materially increases the site's value for finding content across 78 issues.

**Independent Test**: Build the site with the search index enabled, run a query known to appear in PB-P001 text, and confirm results appear client-side (no server) and link to the correct page.

**Acceptance Scenarios**:

1. **Given** a built site with a client-side search index over OCR + translation text, **When** the reader searches for a term present in the corpus, **Then** matching results are returned in the browser without a server round-trip.
2. **Given** a search result, **When** the reader selects it, **Then** they are taken to the reading view of the page (or issue) that contains the match.
3. **Given** a term present only in the English translation (or only in the French text), **When** the reader searches for it, **Then** it is found (both language layers are indexed).

---

### User Story 4 - The archival frame & provenance rail (Priority: P2)

A reader experiences the "Prospectus/Dossier" visual identity: a swindle's glowing prospectus held inside a cool archival dossier, with a signature monospace **provenance rail** exposing each page's identifying facts (source id, ARK, date, rights, page, sha256) so the archive's hand is always visible on the propaganda.

**Why this priority**: The framing is not decoration — it is the editorial thesis (never let the propaganda pass for truth) made visible. It rides on top of the reading view; the reading view is legible without it, but the feature's purpose is only fully met with it.

**Independent Test**: Open a page reading view and confirm the provenance rail is present and populated from the page's real metadata, and that the visual system distinguishes the source's voice from the critical apparatus's voice.

**Acceptance Scenarios**:

1. **Given** a page reading view, **When** it renders, **Then** a monospace provenance rail displays the page's source id, ARK, date, rights, page identifier, and sha256, populated from the canonical metadata.
2. **Given** the visual identity, **When** a reader compares the source text to the critical apparatus/English translation, **Then** the two are visually distinguished (a warm serif/Didone voice for the source vs a cool grotesque/monospace voice for the apparatus), and critical marks (OCR-condition note, rights stamp) are the only elements using the oxide stamp-red accent.
3. **Given** the site is deployed to a host with a strict content-security policy, **When** a page renders, **Then** the display typeface is present without loading from an external font host (the face is embedded).

---

### User Story 5 - Configurable image-source provider (Priority: P3)

An operator configures where page images come from — either building image URLs from the source's archival identifier (e.g. a IIIF/image service such as Gallica) or from the archive object-store key plus a CDN base — without changing the viewer or the reading view.

**Why this priority**: It makes the browser resilient to where images live and supports the public-vs-internal image story. The reading view works with a single provider; the second provider is what makes the site portable and public-deployable, so it is important but not first.

**Independent Test**: Build the site twice with the two provider configurations and confirm the same page reading view renders correct image URLs from each provider, with the viewer unchanged.

**Acceptance Scenarios**:

1. **Given** the provider is set to the source-archive identifier mode, **When** the site is built, **Then** page image URLs are derived from the source's archival identifier and the viewer displays them.
2. **Given** the provider is set to the object-store + CDN mode, **When** the site is built, **Then** page image URLs are derived from the object-store key and the configured CDN base, and the viewer displays them.
3. **Given** either provider, **When** the reading view renders, **Then** the deep-zoom viewer behaves identically (the viewer is provider-agnostic).
4. **Given** a provider is selected but its required configuration is missing (e.g. no CDN base, or no archival identifier for the source), **When** the site is built, **Then** the build fails loud identifying the missing configuration — no fallback provider is silently used.

---

### User Story 6 - Deliberate public export (Priority: P3)

A maintainer produces a public deployment that contains only public-domain text and images, as a deliberate export step distinct from the internal build that reads the private archive.

**Why this priority**: The audience decision is public-reader, internal-first. The internal build is the substrate (P1); the public export is a designed-for, deliberate later action. Capturing it now keeps the internal/public boundary explicit rather than accidental, but it is not required to make the internal reading surface usable.

**Independent Test**: Confirm that producing a public deployment is a distinct, deliberate operation and that its output excludes non-public-domain material, without weakening the internal build.

**Acceptance Scenarios**:

1. **Given** the internal build reads private archive data, **When** a public deployment is produced, **Then** it is the result of an explicit export action, not an incidental side effect of the internal build.
2. **Given** a public deployment, **When** it is inspected, **Then** it contains only public-domain text and images intended for public release.

---

### Edge Cases

- **Missing/inconsistent corpus data** (no scan handle, no OCR, no translation, mismatched issue/page counts): the build MUST fail loud identifying the offending source/issue/page — never silently placeholder or skip (no fallbacks).
- **Issue-level vs page-level translation**: the English translation is currently issue-level while OCR is page-level. The reading view must present translation coherently against page-level OCR (exact alignment strategy is an open question below).
- **Noisy OCR**: pages whose OCR is degraded ("Contraste insuffisant") must keep the scan authoritative and not present OCR as clean text.
- **Strict CSP on the public host**: external font/asset hosts are blocked; the display face and any required assets must be embedded (e.g. inlined) rather than fetched from a CDN.
- **A source with no archival identifier** under the source-identifier image provider, or **no CDN base** under the object-store provider: build fails loud (US5 AS4).
- **Very large scans / deep zoom performance**: the viewer must remain responsive for high-resolution masters (exact tiling vs full-image strategy for the object-store provider is an open question below).

## Requirements *(mandatory)*

### Functional Requirements

**Corpus ingestion (build-time)**

- **FR-001**: The build MUST read the corpus — page-image handles, OCR issue text, corrected-French and English translations, census data, and canonical source metadata — and normalize it into a **Source → Issue → Page** model.
- **FR-002**: The build MUST **fail loud** on missing or inconsistent corpus data, identifying the specific source/issue/page and the missing/invalid field. It MUST NOT substitute mock data, placeholders, or silent fallbacks.
- **FR-003**: The data layer MUST be **generalized** so sources other than PB-P001 can be added without rework, while v1 content is PB-P001 (*La Nouvelle France*, 78 issues).

**Reading & navigation**

- **FR-004**: The site MUST render **stable, deep-linkable routes** for each source, each issue, and each page.
- **FR-005**: Each page reading view MUST present the page's **master scan in a deep-zoom viewer** (zoom + pan) as the leading element, with the page's **French OCR** and **English translation** presented alongside it (layout ① "Facsimile & parallel text").
- **FR-006**: The reader MUST be able to **navigate forward and backward through pages within an issue**, and from a source to its issues to a page.
- **FR-007**: The reading view MUST keep the **scan authoritative** — noisy/degraded OCR must be framed as such, not presented as clean truth.

**Search**

- **FR-008**: The site MUST provide **client-side search** (no server) over the corpus's **OCR and translation text**, indexed at build time.
- **FR-009**: Search results MUST **link to the reading view** of the page (or issue) containing the match.
- **FR-010**: Search MUST cover **both language layers** (French and English) as configured (granularity — per-page vs per-issue — is an open question below).

**Image-source provider**

- **FR-011**: The site MUST support a **configurable image-source provider** selected by a flag, with a single provider interface and two backends: (a) **source-identifier** — build image URLs from the source's archival identifier (e.g. a IIIF/image service such as Gallica); (b) **object-store + CDN** — build image URLs from the archive object-store key plus a configured CDN base.
- **FR-012**: The deep-zoom viewer MUST be **provider-agnostic** — the same reading view works regardless of which provider is selected.
- **FR-013**: The build MUST **fail loud** when the selected provider's required configuration is missing (US5 AS4); it MUST NOT silently fall back to the other provider.

**Visual identity — "Prospectus/Dossier"**

- **FR-014**: Each page reading view MUST display a **monospace provenance rail** populated from canonical metadata: source id, ARK, date, rights, page identifier, and sha256.
- **FR-015**: The visual system MUST **distinguish the source's voice from the critical apparatus's voice** (a warm serif/Didone voice for the source vs a cool grotesque/monospace voice for the apparatus + English translation) and MUST reserve the oxide stamp-red accent for **critical marks only** (OCR-condition note, rights stamp).
- **FR-016**: The site MUST use a **single (archival, light) theme** and MUST embed the display typeface so it renders under a **strict content-security policy** without fetching from an external font host.
- **FR-017**: All UX/UI implementation for this feature (reading view, navigation, search UI, visual identity) MUST be produced through the `/frontend-design:frontend-design` skill (Constitution Principle I).

**Audience / deployment**

- **FR-018**: The **internal build** MUST read the **private archive locally** to generate the site.
- **FR-019**: A **public deployment** MUST be a **deliberate export** of public-domain text and images, distinct from the internal build, and MUST NOT be an incidental side effect of the internal build.
- **FR-020**: Secrets/credentials required to read private data or object-store handles MUST be kept **out of version control** (mechanism is an open question below).

### Key Entities

- **Source**: A corpus source (e.g. PB-P001, *La Nouvelle France*). Carries canonical metadata: source id, archival identifier (ARK), rights, and image-provider handles. Has many Issues.
- **Issue**: One issue of a source (78 for PB-P001). Carries issue-level text (English translation is currently issue-level) and belongs to a Source. Has many Pages.
- **Page**: A single page within an issue. Carries the master scan handle, page-level French OCR text, a page identifier, and a content hash (sha256). Belongs to an Issue.
- **Image-source provider (config)**: Selects how page image URLs are built — source-identifier or object-store + CDN — plus that provider's required parameters (e.g. CDN base).
- **Provenance record**: The identifying facts surfaced in the provenance rail (source id, ARK, date, rights, page, sha256), derived from canonical metadata.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can open any of the 78 PB-P001 issues, reach any page, and see the scan, French OCR, and English translation together — for 100% of pages that have complete corpus data.
- **SC-002**: From any page, a reader can navigate to the adjacent page within the issue in a single action, and every source/issue/page view has a stable shareable URL that reproduces the same view.
- **SC-003**: A reader can search a term that appears in PB-P001 and reach the containing page from a result, entirely client-side (the deployed site requires no application server).
- **SC-004**: Every page reading view shows a provenance rail populated from that page's real metadata (source id, ARK, date, rights, page, sha256) — no page is missing its provenance.
- **SC-005**: The same page renders correctly under both image-source providers with no change to the reading view or viewer behavior.
- **SC-006**: Any missing or inconsistent corpus field causes the build to fail with a message naming the offending source/issue/page and field — verified by removing a required field and observing a loud failure (never a silent placeholder).
- **SC-007**: The site renders its display typeface and assets under a strict content-security policy with no external font/asset host requests.
- **SC-008**: A public deployment can be produced as a distinct deliberate action whose output contains only public-domain material, without altering the internal build.

## Open Questions *(non-blocking — resolve in `/speckit-clarify`)*

Carried verbatim from the approved design record; none are blockers to planning. Each has a documented working assumption (see Assumptions) so the spec is complete; clarify will confirm or change them.

- **OQ-1 — Text↔image alignment**: Page-level OCR is extractable, but the English translation is currently **issue-level**. Align translation to pages approximately, or present translation issue-level beside per-page OCR? (Coordinate with the `source-translation` feature's output shape.)
- **OQ-2 — Which text layers to surface**: Raw OCR + corrected French + English, or a curated subset (e.g. corrected-French primary with raw OCR on demand)?
- **OQ-3 — Build access to private data**: How the generator reads the private archive (OCR/translations), object-store image handles, and config/credentials — keeping secrets out of git.
- **OQ-4 — Public export pipeline**: What public-domain text/images get published and how (a deliberate export step vs building straight from the archive).
- **OQ-5 — Search granularity**: Per-page vs per-issue index; covering French + English.
- **OQ-6 — Object-store image tiling**: IIIF tiling vs full-image + client-side zoom for the object-store (CDN) provider; CDN in front of the object store.
- **OQ-7 — Data-layer generalization**: Monograph vs periodical vs source-group shape in the data layer (ties to the `source-groups` feature).

## Assumptions

- **Working assumptions for the open questions** (to be confirmed in clarify): OQ-1 → present English translation at issue level beside per-page OCR until alignment data exists; OQ-2 → surface raw OCR (French) + English translation, with corrected-French folded in as it becomes available; OQ-3 → the build reads the private archive from a local path and reads credentials from the environment (not committed); OQ-4 → public export is a separate deliberate step, not built in v1's internal path; OQ-5 → index per page across both languages; OQ-6 → full-image + client-side deep-zoom for the object-store provider initially; OQ-7 → model the data layer as periodical (Source → Issue → Page) with room to generalize.
- **Dependencies**: consumes the shipped `canonical-source-metadata` (Source/Repository model) and `archive-object-store` (object-store image handles); consumes `source-translation` output (in-flight — governs OQ-1/OQ-2).
- **Content scope**: v1 content is PB-P001 (*La Nouvelle France*); the data layer is built to generalize but only PB-P001 is populated in v1.
- **Deployment**: the deployed public artifact is a static site requiring no application server; target hosts apply a strict content-security policy.
- **Users**: readers use a modern browser capable of running the deep-zoom viewer and client-side search; the primary audience is human readers/researchers of the corpus.
- **Editorial stance**: the site's purpose is to frame the source as evidence, never to present the propaganda (or its noisy OCR) as neutral truth.

## Dependencies

- **`impl:feature/canonical-source-metadata`** (shipped) — Source/Repository/metadata model feeding provenance and provider handles.
- **`impl:feature/archive-object-store`** (shipped) — object-store image handles for the object-store + CDN provider.
- **`impl:feature/source-translation`** (in-flight) — translation output shape; governs the text-layer and alignment open questions (OQ-1, OQ-2).
- **`impl:feature/source-groups`** — informs the data-layer generalization open question (OQ-7).
