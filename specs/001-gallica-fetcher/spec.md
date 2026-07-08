# Feature Specification: Gallica Fetcher

**Feature Branch**: `feature/gallica-fetcher` (stack-control single-branch; spec dir `specs/001-gallica-fetcher`)

**Created**: 2026-07-08

**Status**: Draft

**Input**: Reusable command-line tool to fetch nineteenth-century public-domain sources from the BnF Gallica digital library for the Colony Cults research archive. Design source of truth: `docs/superpowers/specs/2026-07-08-gallica-fetcher-design.md`.

## User Scenarios & Testing *(mandatory)*

The "user" is a researcher or research agent building the Colony Cults archive. The first concrete target is *La Nouvelle France* (`PB-P001`), a promotional newspaper for the Port Breton colony scheme, held by Gallica as a periodical of 78 issues spanning 1879–1885.

### User Story 1 - Build an authoritative issue census (Priority: P1)

A researcher points the tool at a Gallica periodical and receives a complete, exact list of its issues — each issue's identifier, publication date, and page count — as a durable, human- and machine-readable file committed to the public research repository.

**Why this priority**: The census is the smallest independently valuable slice. It resolves the open run-length conflict (whether the run is 1879–1881 or 1879–1885) with authoritative host data, and it is the prerequisite map for any later image or text fetching. It carries no copyright risk (metadata only) and no heavy assets.

**Independent Test**: Run the census command against the *La Nouvelle France* periodical identifier; confirm it produces a census file listing 78 issues across 1879–1885 with per-issue identifiers, dates, and page counts, deterministically ordered.

**Acceptance Scenarios**:

1. **Given** a valid Gallica periodical identifier, **When** the researcher runs the census command, **Then** a per-source census file is written to the public repository listing every issue with its identifier, date, and page count, ordered by date, with stable formatting.
2. **Given** an existing census file for the same source, **When** the census command is re-run, **Then** the output is byte-identical unless the host holdings changed (deterministic).
3. **Given** the census command is run with the dry-run flag, **When** it executes, **Then** it reports what it would write and where, without writing anything.

### User Story 2 - Mirror full-resolution page images into the private archive (Priority: P2)

A researcher fetches the full-resolution page images for one issue, or for an entire source, into the private preservation archive, each accompanied by provenance metadata and a checksum, and never lands a heavy asset in the public repository.

**Why this priority**: Page images are the primary preservation artifact and the evidentiary basis for the research. They depend on the census (US1) for the issue list. They are separable from OCR (US3), which is slower and optional.

**Independent Test**: Fetch a single known public-domain issue; confirm its page images land only under the private archive location, each with a provenance record (source URL, retrieval date, checksum, format) and a verifiable checksum, and that a repeat run skips already-fetched pages.

**Acceptance Scenarios**:

1. **Given** an issue whose rights status is confirmed public-domain, **When** the researcher fetches it, **Then** every page image is downloaded at full resolution into the private archive with a provenance record and checksum.
2. **Given** an issue whose rights status is not confirmed public-domain, **When** the researcher attempts to fetch it, **Then** the tool refuses with a descriptive error and downloads nothing.
3. **Given** a target path outside the private archive location, **When** any image/PDF/text asset would be written there, **Then** the tool refuses and writes nothing (no override exists).
4. **Given** pages already fetched and recorded, **When** the fetch is re-run without forcing, **Then** already-present, checksum-recorded pages are skipped; **When** re-run with the force flag, **Then** they are re-fetched.
5. **Given** the dry-run flag, **When** a fetch is invoked, **Then** the tool reports intended downloads, target paths, per-issue rights status, and estimated total size, and writes nothing.

### User Story 3 - Produce searchable OCR text for fetched issues (Priority: P3)

A researcher turns already-fetched page images into a searchable PDF/A plus a plain-text sidecar, so the recruitment and propaganda language of the source becomes full-text searchable for the evidence model.

**Why this priority**: OCR is the most compute-intensive step and is not required for preservation of the images themselves. It is decoupled so it can run separately, be skipped, or be re-run without re-downloading.

**Independent Test**: Take an issue whose images are already fetched, run the OCR step, and confirm it produces a searchable PDF/A and a plain-text file in the private archive, with the issue's OCR status recorded in provenance.

**Acceptance Scenarios**:

1. **Given** an issue with fetched images and the OCR toolchain present, **When** the researcher runs OCR (or fetches with OCR enabled), **Then** a searchable PDF/A and a plain-text sidecar are produced in the private archive and the OCR status is recorded.
2. **Given** the OCR toolchain (including the French language data) is missing, **When** an OCR-enabled run starts, **Then** the tool fails loud before doing work, naming the missing tools and how to install them.
3. **Given** an images-only run and a missing OCR toolchain, **When** the fetch runs, **Then** it completes normally (the OCR toolchain is not required when OCR is not requested).

### Edge Cases

- **Run-length disagreement**: the census must report what the host authoritatively exposes, so that a discrepancy with other catalogues is surfaced as evidence rather than silently reconciled.
- **Host throttling / access-denied on a specific endpoint**: transient blocking must be retried with backoff and, if still failing, reported loudly — never silently skipped or substituted with partial/empty data.
- **Partial prior run**: a fetch interrupted midway must resume without re-downloading completed, checksum-verified assets.
- **Rights status absent or ambiguous** for an item: treated as "not confirmed public-domain" → refuse to mirror, report clearly.
- **Non-periodical (monograph) source**: the tool must also handle single-document sources (later Port Breton targets are books/pamphlets, not periodicals).
- **Corrupted or truncated download**: a checksum mismatch on verification must be reported, not accepted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The tool MUST build a per-source census of a Gallica periodical listing every issue with its stable identifier, publication date, and page count, sourced from the host's documented issue-listing service (not the interactive web UI).
- **FR-002**: The census MUST be written to the public research repository as a deterministic, per-source file (stable ordering by date, stable formatting) suitable for clean version-control diffs.
- **FR-003**: The tool MUST fetch full-resolution page images for a given issue, and for an entire source (iterating its census).
- **FR-004**: Before any download of an item, the tool MUST verify the item's rights status from the host's per-item rights metadata endpoint and proceed only when it is confirmed public-domain; on any other or absent status it MUST refuse with a descriptive error and download nothing. It MUST NOT rely on a generic, non-item-specific licensing statement.
- **FR-005**: The tool MUST store the raw rights-metadata response in the item's provenance record.
- **FR-006**: The tool MUST write image, PDF, and text preservation assets ONLY within the resolved private archive location, and MUST refuse (with no override) to write any such asset to any other location, including the public repository.
- **FR-007**: Every mirrored asset MUST have a provenance record capturing at least: local path, retrieval date, original source URL, checksum, file format, and OCR status.
- **FR-008**: The tool MUST compute and record a content checksum for every mirrored asset, and MUST support re-verifying existing assets against their recorded checksums.
- **FR-009**: The tool MUST be resumable: it MUST skip an asset that already exists and whose checksum is already recorded, unless re-fetching is explicitly forced.
- **FR-010**: The tool MUST provide a dry-run mode for the census and all fetch operations that reports intended actions — identifiers, target paths, per-item rights status, and estimated total size — and writes nothing.
- **FR-011**: OCR MUST be optional and decoupled: fetching defaults to images-only; OCR MUST be invocable in the same run via an opt-in, and separately against already-fetched issues without re-downloading.
- **FR-012**: OCR MUST produce a searchable PDF/A and a plain-text sidecar per issue, generated from the fetched page images (the tool performs its own OCR; it MUST NOT depend on the host's text-delivery endpoints).
- **FR-013**: Before performing OCR, the tool MUST validate that the required OCR toolchain — including the French-language recognition data — is present, and fail loud with install guidance if not; this check MUST apply only when OCR is requested.
- **FR-014**: The tool MUST access the host politely: a descriptive agent identifier including project and contact, request rate limiting, and exponential backoff. A transient access-denied response MUST be retried with backoff and, if still failing, reported loudly rather than silently skipped.
- **FR-015**: The tool MUST fail loud on missing functionality or data rather than substituting fallback, mock, or partial data.
- **FR-016**: The tool MUST generalize beyond the first source to other Gallica sources of the archive, including single-document (non-periodical) sources.
- **FR-017**: The tool MUST expose its capabilities as discrete commands — build census, fetch one issue, fetch a whole source, and OCR — each usable independently.

### Key Entities *(include if feature involves data)*

- **Source**: a Gallica-held work being mirrored (a periodical or a monograph), identified by a stable host identifier and mapped to a Colony Cults source ID (e.g. `PB-P001`).
- **Census**: the enumerated set of issues for a periodical source — each entry an issue identifier, date, and page count — persisted publicly.
- **Issue**: one fascicle of a periodical (or one monograph), comprising an ordered set of pages, with a rights status.
- **Asset**: a single mirrored file (page image, searchable PDF/A, or plain-text sidecar) held in the private archive.
- **Provenance record**: metadata bound to an asset — local path, retrieval date, original URL, checksum, format, OCR status, and the raw rights response for its issue.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For *La Nouvelle France*, the census enumerates all 78 issues across 1879–1885 with identifier, date, and page count for each, and the run-length conflict is settled by host data.
- **SC-002**: 100% of items mirrored have their rights status verified as public-domain beforehand, with the raw rights response stored; zero items are mirrored without a recorded public-domain confirmation.
- **SC-003**: Zero image, PDF, or text preservation assets are ever written outside the private archive location.
- **SC-004**: Every mirrored asset has a complete provenance record and a checksum that re-verifies successfully.
- **SC-005**: An interrupted full-source run, when resumed, downloads no asset it has already completed and verified.
- **SC-006**: A dry-run of a full-source fetch accurately reports the count of issues, intended paths, per-issue rights status, and an estimated total size, without writing anything.
- **SC-007**: For an issue with fetched images, OCR yields a searchable PDF/A whose text layer is searchable and a matching plain-text sidecar, without contacting the host's text endpoints.
- **SC-008**: An images-only full-source run succeeds on a machine with no OCR toolchain installed.

## Assumptions

- The underlying nineteenth-century publications are public-domain by age; the operative question is the rights status of each host digital reproduction, which the tool verifies per item.
- The host's documented issue-listing, pagination, per-item rights, and image-delivery services are available and are not subject to the same access barriers as the interactive web UI (verified during design).
- The private archive is a sibling repository/location resolvable from the tool's working context; only assets that may be lawfully mirrored are written there.
- The census (metadata) is safe to hold in the public repository; heavy and rights-sensitive assets are not.
- French is the primary OCR language for the first sources; the recognition data for it must be installed for OCR runs.
- The tool runs in an environment where the OCR toolchain can be installed by the operator when OCR is desired.
- Stack-control owns branching (single long-lived feature branch); this spec's directory name is independent of the git branch.
