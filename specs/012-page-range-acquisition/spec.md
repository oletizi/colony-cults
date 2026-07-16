# Feature Specification: Page-range (excerpt) acquisition

**Feature Branch**: `feature/corpus-gap-closure`

**Created**: 2026-07-15

**Status**: Draft

**Input**: User description: "Add a `--pages <spec>` flag to `bib fetch-source` that acquires only the specified IIIF folios of a document (masters + per-page provenance), instead of the whole document. Motivating consumer: PB-P054, the de Rays Cour de cassation arrêt at folios 48-50 of the Bulletin des arrêts criminels 1884 fascicule. HOW source-of-truth: docs/superpowers/specs/2026-07-15-page-range-acquisition-design.md."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Acquire only the pertinent pages of a large document (Priority: P1)

A researcher has located a short, pertinent passage — a single court decision, a
few pages of a chapter — inside a large digitized document (e.g. a 200-page legal
serial fascicule of otherwise-unrelated material). They want the corpus to hold
**only those pages**, not the entire volume. They run the acquisition command with
a page selection and the corpus mirrors exactly the chosen folios (image masters +
provenance), leaving the rest un-acquired.

**Why this priority**: This is the whole feature's reason to exist. Without it, a
pertinent excerpt can only enter the corpus by mirroring its entire host document —
the "acquire noise" antipattern. It is independently valuable and shippable on its own.

**Independent Test**: Run the acquisition command against a multi-page document with
a page selection of a subset of folios; confirm the corpus holds exactly those folios'
masters + provenance and none of the others.

**Acceptance Scenarios**:

1. **Given** a public-domain document of N pages and a page selection of folios 48–50, **When** the researcher acquires with that selection, **Then** exactly the masters for folios 48, 49, 50 are mirrored to the object store with per-page provenance, and no other folio is fetched or stored.
2. **Given** a page selection combining a range and a list ("48-50,55"), **When** the researcher acquires, **Then** the corpus holds exactly folios 48, 49, 50, 55.
3. **Given** the motivating case PB-P054 (folios 48–50 of fascicule bpt6k61587296), **When** the researcher acquires that excerpt, **Then** PB-P054 advances from `to-collect` to `archived` holding exactly those three folios, verified in the object store.

---

### User Story 2 - Whole-document acquisition is unchanged (Priority: P1)

A researcher acquiring a whole document (a monograph, a full issue) with **no** page
selection sees exactly today's behavior — every folio fetched, same provenance, same
integrity guarantees. The new capability must not perturb the existing acquisition path.

**Why this priority**: The corpus already holds many whole-document acquisitions; a
regression here would corrupt or re-fetch existing holdings. Preserving the default
path is as critical as adding the excerpt path.

**Independent Test**: Acquire a document with no page selection and confirm the result
is identical to the pre-feature behavior (same folios, same masters, same provenance).

**Acceptance Scenarios**:

1. **Given** a document and no page selection, **When** the researcher acquires it, **Then** every folio `1..pageCount` is fetched exactly as before the feature existed.
2. **Given** an already-acquired whole document, **When** the researcher re-runs acquisition with no page selection, **Then** the run is idempotent (already-held folios are skipped), unchanged from today.

---

### User Story 3 - The excerpt is self-describing and verifiable (Priority: P2)

The corpus records **which** folios an excerpt holding is meant to contain, so the
holding is honest about its intended extent, a dry run previews only the selected
pages, and reconciliation verifies the held folios against the declared set.

**Why this priority**: An excerpt that does not record its intended extent looks like a
partial/incomplete acquisition of a whole document. Recording the declared folios lets
the corpus treat the excerpt as complete-on-its-own and lets verification confirm it.

**Independent Test**: Acquire an excerpt, inspect the source's repository record for the
declared folios, run a dry run (reports only those folios) and reconcile (verifies those
folios against the object store).

**Acceptance Scenarios**:

1. **Given** an excerpt acquisition of folios 48–50, **When** it completes, **Then** the source's repository record records the declared extent as folios 48, 49, 50.
2. **Given** a dry run with a page selection, **When** the researcher previews, **Then** only the selected folios are reported (count + size estimate), not the whole document.
3. **Given** a recorded excerpt, **When** the researcher reconciles it, **Then** the system verifies exactly the declared folios against the object store and reports them as held.

---

### Edge Cases

- **Folio out of bounds**: a selected folio below 1 or above the document's page count → refuse the whole run, write nothing.
- **Malformed selection**: non-integer tokens, or a reversed range like `50-48` → refuse at parse, write nothing.
- **Empty selection**: a page-selection argument that resolves to no folios → refuse.
- **Duplicate/overlapping tokens**: `48-50,49` → de-duplicated to `{48,49,50}`, not an error.
- **Wrong acquisition path**: a page selection on the periodical multi-issue path → usage error (out of operator-decided scope).
- **Idempotent re-run**: re-acquiring the same excerpt skips already-held folios; no duplication, no re-fetch.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The single-document acquisition command MUST accept an optional page-selection argument naming which folios of the document to acquire.
- **FR-002**: The page-selection MUST accept inclusive ranges and comma-separated lists, combinable (e.g. `48-50`, `48,50,52`, `48-50,55`), interpreted as a set of folios.
- **FR-003**: With a page-selection, the system MUST acquire (mirror masters + record per-page provenance) ONLY the selected folios and leave the rest of the document un-acquired.
- **FR-004**: With NO page-selection, the system MUST acquire the whole document exactly as it does today — no behavioral change to the default path.
- **FR-005**: The system MUST record the excerpt's intended extent (its declared folios) on the source's repository record, so the holding is self-describing.
- **FR-006**: An excerpt MUST count as a complete acquisition when its held folios equal its declared folios, independent of the document's total page count.
- **FR-007**: A dry run with a page-selection MUST report only the selected folios (count + estimate), not the whole document.
- **FR-008**: Reconciliation MUST verify the excerpt's held folios against the object store and report them relative to the declared set.
- **FR-009**: The system MUST fail loud (refuse, no fallback, write nothing) when a selected folio is out of the document's bounds (below 1 or above its page count).
- **FR-010**: The system MUST fail loud on a malformed page-selection: non-integer tokens, a reversed range, or a selection that resolves to no folios.
- **FR-011**: Duplicate or overlapping folios in the selection MUST be de-duplicated into a single ascending set, not rejected.
- **FR-012**: The page-selection MUST be honored on the single-document acquisition path; on the periodical multi-issue path it MUST be a usage error (operator-decided scope).
- **FR-013**: Excerpt masters and provenance MUST carry the SAME integrity guarantees as whole-document acquisitions — checksum, object key, retrieval metadata, and rights — an excerpt is not a lesser-provenance path.

### Key Entities *(include if feature involves data)*

- **Folio selection**: the set of document folios a caller requests to acquire — the input, normalized to a de-duplicated ascending set.
- **Declared excerpt extent**: the folios recorded on a source's repository record as its intended holding — the yardstick for "excerpt complete".
- **Held copy (excerpt)**: a corpus source whose held copy is a proper subset of the folios of a larger host document, identified by the host document plus its declared folios.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A researcher can acquire an M-page passage from a several-hundred-page document and the corpus holds exactly those M pages — zero unrelated pages mirrored.
- **SC-002**: Acquiring an excerpt of N folios mirrors exactly N page masters and records exactly N per-page provenance entries.
- **SC-003**: Whole-document acquisition with no page-selection is byte-for-byte identical to pre-feature behavior — zero regressions in existing acquisition results.
- **SC-004**: Every invalid page-selection (out-of-bounds, malformed, reversed, empty) is refused with a clear message and writes nothing — zero partial or garbage acquisitions.
- **SC-005**: The motivating case (PB-P054) advances from `to-collect` to `archived` holding exactly folios 48–50, verified present in the object store.

## Assumptions

- The correct folios are supplied by the caller; identifying them (e.g. via full-text search of the host document) is the pinpoint step and is a caller responsibility, not part of this feature. Mapping printed page numbers to folios is out of scope.
- Rights are assessed exactly as today (fail-closed). An excerpt of a public-domain document is public-domain; this feature does not change rights handling.
- The per-page fetch, checksum, object-store, provenance, and reconcile machinery is reused unchanged; an excerpt differs only in WHICH folios are fetched.
- **Out of scope by explicit operator decision (2026-07-15)**: page-selection on the periodical multi-issue path; printed-page → folio mapping; a distinct "excerpt" source kind; and coverage/audit surfaces for excerpts. These were weighed and deferred in an explicit scoping pass, not omitted by default.
