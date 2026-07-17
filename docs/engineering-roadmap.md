---
doc-grammar: roadmap
---

# Roadmap

The governed dependency graph of this project's features. Each item is a
heading-keyed unit identified by its `<phase>:<kind>/<slug>` id.

Mutate the graph with `stackctl roadmap` verbs (run `stackctl roadmap --help`
for the full surface): `add` a new item, `advance` its status, `decompose`,
`reclassify`, `defer`, and `cluster` / `group` to gather existing items under a
created-or-reused parent. Example — cluster items under a new epic with a
dependency chain:

    stackctl roadmap cluster multi:feature/epic --children design:feature/a,impl:feature/b --chain --apply

For an edit that has no verb yet (e.g. moving a `part-of` / `depends-on` edge):
edit this file directly, then run `stackctl roadmap order` to revalidate the
graph (it fails loud on a cycle / dangling ref / duplicate id).

## impl:feature/gallica-fetcher
- status: closed
- validated: yes
- analyze-clean: yes
- spec: specs/001-gallica-fetcher
- design-approved: yes
- design: docs/superpowers/specs/2026-07-08-gallica-fetcher-design.md
Reusable TypeScript/tsx tool to fetch Gallica public-domain sources via documented web-service and IIIF APIs (Issues census, Pagination, IIIF images, OCR text) with provenance and checksums into the private archive; first target La Nouvelle France PB-P001

## impl:feature/source-translation
- status: in-flight
- analyze-clean: yes
- spec: specs/002-source-translation
- design-approved: yes
- design: docs/superpowers/specs/2026-07-08-source-translation-design.md
- depends-on: impl:feature/gallica-fetcher
Mechanism to translate captured public-domain French sources (OCR text from the gallica-fetcher archive) to English for the research archive: machine-assisted translation retaining the original-language citation, labelled machine-assisted, with engine + date provenance, per AGENTS.md translation policy. First input: La Nouvelle France issue.txt OCR (PB-P001, public domain -> full translation committable).

## impl:feature/archive-object-store
- status: closed
- validated: yes
- analyze-clean: yes
- spec: specs/003-archive-object-store
- design-approved: yes
- design: docs/superpowers/specs/2026-07-08-archive-object-store-design.md
Move the archive's binary image masters from git to Backblaze B2 (S3-compatible; bucket colony-cults, endpoint https://s3.us-west-004.backblazeb2.com, region us-west-004). Fetcher archive-writer uploads image bytes to B2 and records the object key + sha256 in the git-tracked provenance; git keeps only census + provenance + OCR text + manifest. Includes a one-time migration (masters already uploaded + verified in B2; remaining: strip images from git history + force-push, coordinated with the translation session). Subsumes TASK-6.

## impl:feature/canonical-source-metadata
- status: closed
- validated: yes
- analyze-clean: yes
- spec: specs/004-canonical-source-metadata
- design-approved: yes
- depends-on: impl:feature/archive-object-store
- design: docs/superpowers/specs/2026-07-08-canonical-source-metadata-design.md
Two-level (really multi-level) canonical source metadata model: Source (intellectual work; stable internal ID PB-###; work-level identifiers ISBN/ISSN/OCLC; titles as data) separate from Repository Record (one source-archive's copy: Gallica/SLQ/IA/HathiTrust; copy-level identifiers ARK/IIIF-manifest/scan-DOI; provenance). Sits ABOVE the per-asset provenance the archive-object-store feature already emits; for serials adds Repository->Issue->Asset. Consolidates the 5 existing overlapping metadata representations into one SSOT. From a third-party design brief, with refinements. Depends-on archive-object-store (edge to add once that merges to main). Scope: sources only.

## impl:feature/corpus-browser
- status: closed
- validated: yes
- closes: TASK-9, TASK-10, TASK-11
- analyze-clean: yes
- spec: specs/005-corpus-browser
- design-approved: yes
- design: docs/superpowers/specs/2026-07-09-corpus-browser-design.md
- depends-on: impl:feature/archive-object-store
Static Astro website to browse the corpus (v1: PB-P001 La Nouvelle France): source->issue->page reading view with a deep-zoom page-image viewer beside French OCR + English translation (chosen layout: Facsimile & parallel text). Configurable image-source provider (source-archive IIIF e.g. Gallica, or our B2/CDN) via a flag. Client-side search (Pagefind) over OCR+translation. Public-reader, internal-first (build reads the private archive locally; public deploy is a deliberate export of PD text/images). Visual identity: cool archival 'Prospectus/Dossier' direction, provenance-rail signature. Also depends on source-translation output (in-flight).

## impl:feature/source-groups
- status: closed
- validated: yes
- analyze-clean: yes
- spec: specs/005-source-groups
- design-approved: yes
- design: docs/superpowers/specs/2026-07-09-source-groups-design.md
- depends-on: impl:feature/canonical-source-metadata
Source Group kind for research-defined collections that are discovered before acquired (resolves PB-P004 mis-model + backlog TASK-3). Extend Source.kind to periodical|monograph|source-group; a source-group has members (part_of edges), NOT repositoryRecords, and is never fetchable; fetcher/acquisition fails loud+informatively on a source-group keyed on kind. Add discovered/approved-for-acquisition to the status vocab. Reclassify PB-P004 (French legal corpus) as the first source-group with member children. Discover->Inventory->Verify->Promote->Acquire pipeline. Does NOT add repository-record to the kind enum (already a separate entity). From a third-party design guidance doc, with refinements.

## impl:feature/source-group-acquisition
- status: closed
- validated: yes
- analyze-clean: yes
- spec: specs/006-source-group-acquisition
- design-approved: yes
- design: docs/superpowers/specs/2026-07-09-source-group-acquisition-design.md
- depends-on: impl:feature/gallica-fetcher
Reusable Discover->Inventory->Technical-verify->Research-approve(Promote)->Acquire->Preserve pipeline for source-group members (agent-assisted discovery + judgment), proven end-to-end by acquiring PB-P004's Rays legal corpus. Builds inventory/verify-member/promote CLI commands over the shipped source-group model (member Source with partOf + lifecycle status discovered->approved-for-acquisition). Members get flat opaque IDs (next-free PB-P###, e.g. PB-P007); membership is the partOf edge only, never encoded in the id. verify-member is deterministic (resolve/rights/dedup/required-fields); promote records research judgment. RepositoryRecord created at inventory as wanted, ->to-collect at promote (separate acquisition vocab). Inventory preserves raw+normalized metadata. Acquire resolves the ark from the RepositoryRecord and reuses the shipped fetcher (--object-store to B2); no new fetch code in v1. Discovery search mechanism is a spike that selects ONE documented mechanism (BnF catalogue SRU lead) and fails loud when unavailable -- no runtime fallback. Resolves the PB-P004 blocked-assets gap that source-groups intentionally created. Newspaper coverage routes to PB-N### (current single-partOf modeling constraint, not an absolute rule). Revised 2026-07-10 after third-party review.

## impl:feature/corpus-coverage-audit
- status: shipped
- analyze-clean: yes
- spec: specs/007-corpus-coverage-audit
- design-approved: yes
- design: docs/superpowers/specs/2026-07-11-corpus-coverage-audit-design.md
- depends-on: impl:feature/canonical-source-metadata
Scoped-down capture from a third-party "Corpus Coverage & Discovery Audit" proposal (evaluated 2026-07-11). Answers "what evidence are we still missing?" as a LIGHTWEIGHT layer GENERATED from the existing bibliography (single source of truth), NOT a parallel hand-maintained research/ tree (avoids the legacy/ CSV drift trap). Reuses the shipped model: source-groups ARE discovery campaigns (PB-P004 = the trial-records campaign); the two shipped lifecycles (Source discovered->approved-for-acquisition->excluded, Repository wanted->...->archived) stay — REJECT the proposal's 11-stage linear lifecycle as false precision. In scope: (a) optional genre/evidence-class facet on Source (book/pamphlet/prospectus/newspaper/trial-record/gov-report/map/..., orthogonal to structural kind); (b) two pre-discovery lifecycle states referenced-but-unidentified + suspected; (c) per-source-group known-count with an explicit unknown (unknown != incomplete); (d) a repository x campaign search-history ledger (which repo searched, when, coverage, remaining questions) — the genuinely-missing artifact, since RepositoryRecords are per-copy not per-search; (e) an unresolved-references register mined from acquired sources' citations (how PB-P007 was found); (f) a CLI/stackctl coverage report that generates COUNTS with explicit unknowns — NO headline coverage %, which would be false precision over a mostly-unknown denominator. Out of scope: no fetch/OCR/translate, no new acquisition pipeline, no query automation (YAGNI until records are used by hand). Right-size to the current one-case, ~11-source corpus; do not build a research-program-management subsystem heavier than the corpus it manages.

## impl:feature/corpus-print-pdf
- status: shipped
- closes: TASK-14
- analyze-clean: yes
- spec: specs/007-corpus-print-pdf
- design-approved: yes
- design: docs/superpowers/specs/2026-07-11-corpus-print-pdf-design.md
- depends-on: impl:feature/corpus-browser

## impl:feature/coverage-web-view
- status: shipped
- spec: specs/008-coverage-web-view
- analyze-clean: yes
- design-approved: yes
- design: docs/superpowers/specs/2026-07-12-coverage-web-view-design.md
- depends-on: impl:feature/corpus-browser, impl:feature/corpus-coverage-audit
A public research-status page in the corpus-browser Astro site that renders the coverage-audit `CoverageReport` projection — framing the corpus honestly as an in-progress research effort ("what we hold, what is still missing"). One `/coverage` route composes four small section components over the report's four parts: per-campaign coverage (members vs believed extent, gap or `unknown`), evidence-class distribution (counts), the unresolved-references register (grouped by campaign + an ungrouped bucket), and the repository × campaign search history. Built statically at build time by importing the pure `buildCoverageReport` projection over the committed bibliography (`bibliography/sources/*.yml` + `search-log.yml`) — no archive, no snapshot, no derived artifact committed. Honors the audit's core constraint: counts and the literal `unknown` only, NEVER a headline coverage percentage or completeness bar. Cross-links campaigns/register owners to existing `/sources/<id>` pages where one exists; one masthead nav link. UI is authored through `/frontend-design` (Constitution Principle I). Out of scope: per-campaign drill-down routes, filtering/sorting, client JS, any percentage/progress affordance, projection or schema changes.

## impl:feature/edition-publishing
- status: shipped
- analyze-clean: yes
- spec: specs/008-edition-publishing
- design-approved: yes
- design: docs/superpowers/specs/2026-07-12-edition-publishing-design.md
- depends-on: impl:feature/canonical-source-metadata, impl:feature/corpus-print-pdf
A governed pipeline to publish the rendered facsimile-edition PDFs (from corpus-print-pdf) to the public B2 bucket / Cloudflare CDN and RECORD each publication in the canonical bibliography SSOT (Source / Repository-Record): the published derivative's public URL, PDF sha256, publish date, edition variant (parallel / english-only), and the pinned snapshot commit it was built from. Rights-gated, fail-closed — only lawfully-distributable / public-domain material. Replaces the ad-hoc upload scripts used to hand-publish the 72 PB-P001 english-only issues, and captures the public-export deferral from corpus-print-pdf spec 007.

## impl:feature/corpus-gap-closure
- status: in-flight
- spec: specs/009-corpus-gap-closure
- design-approved: yes
- design: docs/superpowers/specs/2026-07-13-corpus-gap-closure-design.md
- depends-on: impl:feature/corpus-coverage-audit

## impl:feature/corpus-model-coherence
- status: shipped
- analyze-clean: yes
- spec: specs/010-corpus-model-coherence
- design-approved: yes
- design: docs/superpowers/specs/2026-07-13-corpus-model-coherence-design.md
corpus

## impl:feature/museum-acquisition-path
- status: planned
- analyze-clean: yes
- spec: specs/011-museum-acquisition-path
- design-approved: yes
- design: docs/superpowers/specs/2026-07-13-museum-acquisition-path-design.md
- depends-on: impl:feature/source-group-acquisition

Spun out of 009's research loop (PB-P006 New Italy Museum). The museum's identified pre-1955 public-domain photographs + settler documents live in the online Musarch catalogue (newitaly.org.au/CAT/) with no acquisition path — not Gallica, not Trove, not IIIF — so the shipped 006 fetcher/promote pipeline cannot reach them. Captures the cluster surfaced attempting to inventory/acquire PB-P006: (TASK-26) a bespoke museum acquisition mechanism (fetch item detail page + image, record provenance, per-item rights); (TASK-27) a promotion path for standalone (non-grouped) sources to approved-for-acquisition, since promote/verify-member assume group members; (TASK-25) a first-class suspected[] resolution state (unexamined|identified|inventoried|excluded|unavailable) that bib coverage renders, so identified leads stop reading as open. Scope — and the research-first go/no-go on whether we commit to acquiring these items at all — is decided in design, not here.

## impl:feature/page-range-acquisition
- status: planned
- analyze-clean: yes
- spec: specs/012-page-range-acquisition
- design: docs/superpowers/specs/2026-07-15-page-range-acquisition-design.md
Add a minimal `--pages <folio-range>` flag to the shipped `bib fetch-source` (single-document path) so a researcher can acquire ONLY the pertinent folios of a large digitized document — masters + per-page provenance — instead of mirroring the whole thing. Constrains the existing per-page fetch loop (src/fetch/issue.ts) to a deduped ascending folio set; adds optional `RepositoryRecord.folios` recording the excerpt's intended extent (complete = held == declared, decoupled from pageCount — no such gate exists); fail-loud on out-of-bounds/malformed/empty ranges; dry-run scoped to the selection; reconcile verifies the declared folios. Reuses the whole pipeline unchanged (provenance already per-asset). First consumer: PB-P054, the de Rays Cour de cassation arrêt at folios 48-50 of the Bulletin des arrêts criminels 1884 fascicule bpt6k61587296 — advancing it to-collect -> archived without mirroring the fascicule's unrelated arrêts. Emerged this session (2026-07-15) from the PB-P054 acquisition need: a decision embedded in a serial has no standalone ark and does not fit the whole-document fetcher. Out of scope by operator decision: --pages on the periodical fetch-issue path, printed-page->folio mapping, a distinct excerpt Source kind, coverage/audit surfaces for excerpts.

## impl:feature/archiveorg-acquisition-path
- status: planned
- analyze-clean: yes
- spec: specs/013-archiveorg-acquisition-path
- design-approved: yes
- design: docs/superpowers/specs/2026-07-16-archiveorg-acquisition-path-design.md
- depends-on: impl:feature/source-group-acquisition

Spun out of 009's research loop (backlog TASK-32). SRCH-0013 verified that the de Groote 1880 promotional book (archive.org item nouvellefrancec00groogoog, ~368 pp, public domain, Google Books scan) — a central Port-Breton affair imprint absent from Gallica and long a Phase-2 ROADMAP goal — is real, digitised, and acquirable, but the shipped pipeline reaches only Gallica + the New Italy Museum, so nothing can mirror an Internet Archive item into the corpus + B2. The operator expects archive.org to hold much more affair material, so this warrants a reusable first-class RepositoryAdapter (contracts/repository-adapter.md: search / resolveIdentifier / determineRights / acquire), modelled on the shipped museum adapter (spec 011). Design surface: map archive.org advancedsearch + the item metadata API to search/resolveIdentifier; map possible-copyright-status to determineRights (fail-closed); and mirror page-image masters into B2 from archive.org's per-page assets (single-page TIFFs / DjVu / PDF) into our page-image-master model. Scope — and the research-first go/no-go on how deep to build vs. a minimal first acquisition — is decided in design, not here. Fail-loud, no fabrication (FR-008).

## impl:feature/source-query-client
- status: planned
- spec: specs/014-source-query-client