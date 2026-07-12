# Feature Specification: Edition Publishing

**Feature Branch**: `feature/edition-publishing`

**Created**: 2026-07-12

**Status**: Draft

**Input**: User description: "A governed pipeline to publish the rendered facsimile-edition PDFs (from corpus-print-pdf) and record each publication in the canonical bibliography SSOT — public URL, checksum, publish date, edition variant, and the pinned snapshot it was built from — rights-gated fail-closed, with immutable versioned artifacts."

**Design record**: `docs/superpowers/specs/2026-07-12-edition-publishing-design.md`

**Roadmap item**: `impl:feature/edition-publishing`

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish a source's editions and record them in the SSOT (Priority: P1)

An operator has built the facsimile-edition PDFs for a source (e.g. the english-only
edition of *La Nouvelle France*). They run the publish step, and each PDF is distributed
to the public, CDN-fronted store at a stable citable URL, while the canonical bibliography
metadata gains a record that this published edition exists — its public URL, checksum,
publish date, edition variant, and the pinned snapshot it was built from. A scholar can
now discover, cite, and verify the published edition from the metadata alone.

**Why this priority**: This is the feature's reason for being — turning built PDFs into
discoverable, citable, verifiable published editions recorded in the single source of
truth. Without it, publications are invisible to the record.

**Independent Test**: Publish one source's built edition; confirm each issue's PDF is
retrievable at a recorded public URL, its bytes match the recorded checksum, and the
source's canonical metadata carries a publication entry naming the edition, its URLs, and
the snapshot it came from.

**Acceptance Scenarios**:

1. **Given** a source whose PDFs are built and whose rights are affirmatively clearable,
   **When** the operator publishes that source's edition, **Then** every built issue PDF
   is uploaded to the public store and recorded, and the source's metadata gains a
   publication entry (variant, publish date, pinned snapshot, canonical URL base, rights
   basis, and a per-issue manifest reference).
2. **Given** a completed publication, **When** a reader fetches an issue at its recorded
   public URL, **Then** the returned PDF's checksum equals the recorded checksum.
3. **Given** a completed publication, **When** an auditor reads the source's metadata,
   **Then** every published issue is traceable by its public URL and checksum, and the
   edition names the exact pinned snapshot it was built from.

---

### User Story 2 - Rights-gated, fail-closed publishing (Priority: P2)

Publishing must never distribute material that is not lawfully distributable. The operator
attempts to publish; the pipeline refuses unless the source carries an affirmative
distributable-rights determination, and says exactly why.

**Why this priority**: Legal integrity is a hard precondition for a public archive
(Constitution IV). It gates US1 but is a distinct, independently-testable guarantee.

**Independent Test**: Attempt to publish a source whose rights are merely "likely",
absent, or non-distributable; confirm the publish is refused with a message naming the
missing/insufficient rights determination and nothing is uploaded or recorded.

**Acceptance Scenarios**:

1. **Given** a source with no affirmative distributable-rights determination (e.g. a
   free-text "likely" note, or absent), **When** the operator attempts to publish it,
   **Then** the publish is refused, names the rights gap, and uploads/records nothing.
2. **Given** a source with an affirmative distributable-rights determination, **When** the
   operator publishes, **Then** the publication proceeds and the cleared rights basis is
   recorded on the publication entry.

---

### User Story 3 - Idempotent, immutable re-publishing (Priority: P3)

Re-running publish must be safe and citation-stable. An unchanged edition re-publishes as a
no-op; a changed rebuild is published as a NEW immutable version without breaking prior
citable URLs.

**Why this priority**: Reproducibility and citation stability — a corrected edition must
never silently overwrite a URL scholars have cited, and a repeat run must not churn.

**Independent Test**: Publish an edition; re-run publish with no rebuild → zero uploads and
no metadata change. Rebuild the same edition with a change and re-publish → a new versioned
artifact and a new publication record, while the previous version's URL still resolves.

**Acceptance Scenarios**:

1. **Given** an edition already published, **When** publish is re-run with the identical
   built PDFs, **Then** no artifact is re-uploaded and the metadata is unchanged.
2. **Given** an edition already published, **When** the edition is rebuilt with changed
   content and re-published, **Then** the changed issues are published at a NEW immutable
   versioned location, a new publication record is written, and every previously-published
   URL still resolves unchanged.

---

### User Story 4 - Reconcile already-published editions into the SSOT (Priority: P3)

72 english-only *La Nouvelle France* (PB-P001) issue PDFs were published to the public
store by hand, with no SSOT record. The operator reconciles them so the record reflects
reality.

**Why this priority**: The record must not lie by omission — published editions that exist
but are unrecorded are exactly the gap this feature closes; the existing publications must
be brought under the record.

**Independent Test**: Run the reconciliation over the 72 already-published PB-P001
english-only PDFs; confirm the source's metadata afterward records that published edition
(per-issue URLs + checksums), matching what is actually served.

**Acceptance Scenarios**:

1. **Given** 72 PB-P001 english-only PDFs already public but unrecorded, **When** the
   operator reconciles them, **Then** the source's metadata records the published edition
   with each issue's public URL and checksum, consistent with the served artifacts.

---

### Edge Cases

- **Source without affirmative rights** → publish refused, naming the rights gap (FR-002).
- **Variant selected but no built PDFs present** → fail loud naming the missing build
  (do not publish an empty edition).
- **Changed rebuild** → a new immutable versioned artifact + record; prior URLs untouched
  (FR-009).
- **A build that failed for one issue** (missing from the built dir) → that issue is not
  published; the gap is reported attributably, not silently skipped.
- **Public-store download cap during a warm/verify read** → warming/verification reads are
  the capped transaction class; a cap hit is surfaced, not fatal to the recorded
  publication (the upload itself is a different, uncapped class).
- **A publication entry already exists for the same version** → idempotent no-op (FR-004).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a publish operation that operates over already-built
  edition PDFs (it does not build them); building and publishing are separate, composable
  steps.
- **FR-002**: The system MUST refuse to publish a source that lacks an *affirmative*
  distributable-rights determination — fail-closed. A "likely", absent, or
  non-distributable rights state MUST block the publish with a descriptive message
  (Constitution IV).
- **FR-003**: Each published PDF MUST be uploaded to an **immutable, versioned** public
  location, keyed by edition variant, source, issue, and the build's pinned snapshot, so a
  distinct build never overwrites a prior published artifact.
- **FR-004**: The publish operation MUST be idempotent — it MUST NOT re-upload an artifact
  when the exact versioned target already holds the identical PDF (verified by checksum),
  and MUST leave the metadata unchanged in that case.
- **FR-005**: The system MUST record each publication in the canonical bibliography SSOT as
  a per-edition entry on the **Source**, distinct from the source's `repositoryRecords`
  (which model other archives' copies, not derivatives we made). The entry MUST carry: the
  edition variant, publish date, the pinned snapshot the build came from, the canonical
  public URL base, the machine-assist label (engine + date) for translated editions, and
  the rights basis that cleared the gate.
- **FR-006**: The system MUST record per-issue integrity in a manifest — each issue's id,
  public URL, checksum, and page count — referenced from the Source's publication entry
  (keeping the source record lean).
- **FR-007**: The system MUST compute and record the checksum (sha256) of every published
  PDF, so any published artifact is verifiable from the record alone.
- **FR-008**: The system MUST commit the metadata + manifest changes as part of publishing
  — there is no published edition without a recorded, committed provenance.
- **FR-009**: A changed rebuild MUST be published as a NEW versioned artifact with a NEW
  publication record; every previously-published URL MUST remain valid and unchanged (no
  overwrite, no cache purge required).
- **FR-010**: The system MUST report the published count and the canonical public URLs of
  the published artifacts.
- **FR-011**: The system MUST fail loud with a descriptive error on any missing or
  inconsistent input (missing built PDF, unresolved source, missing snapshot pin) and MUST
  NOT silently skip, substitute, or publish partial/placeholder content.
- **FR-012**: The system MUST support both edition variants (`parallel` and `english-only`)
  — publishing whichever variant's PDFs are built.
- **FR-013**: The system MUST be able to reconcile already-published editions into the SSOT
  — recording the 72 hand-published PB-P001 english-only PDFs so the record matches what is
  actually served.
- **FR-014**: The published artifacts MUST be reachable through the public read-through CDN,
  and the recorded canonical URL MUST reference the CDN (so recorded reads are cache-served,
  not direct-store transactions).
- **FR-015**: The system SHOULD be able to warm the CDN for freshly-published artifacts (a
  priming read of each new URL) so first public reads are cache hits.

### Key Entities *(include if feature involves data)*

- **Publication**: a per-edition record on a Source — a published derivative edition (a
  variant) with its publish date, pinned snapshot, canonical URL base, machine-assist
  label, rights basis, and a reference to its per-issue manifest.
- **Publication Manifest**: the per-issue integrity list for one publication — each issue's
  id, public URL, checksum, and page count.
- **Published Artifact**: one immutable, versioned PDF at its public URL, checksum-matched
  to the manifest.
- **Rights Determination**: the affirmative, structured distributable-rights value on a
  Source that the publish gate requires.
- **Source** (existing SSOT entity, extended): gains a `publications` collection (distinct
  from `repositoryRecords`) and an affirmative rights determination.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After publishing a source's edition, 100% of the published issues are
  recorded in the SSOT with a public URL and a checksum — every published artifact is
  traceable from the record alone.
- **SC-002**: For every recorded publication, fetching the artifact at its recorded URL
  returns bytes whose checksum equals the recorded checksum (100% integrity match).
- **SC-003**: Zero publications occur for a source lacking an affirmative distributable
  -rights determination (the gate refuses 100% of non-cleared attempts).
- **SC-004**: Re-running publish on an unchanged edition performs zero uploads and makes
  zero metadata changes (idempotent).
- **SC-005**: After a changed rebuild is re-published, 100% of the previously-published
  URLs still resolve to their original bytes (immutability), and the new version is
  recorded.
- **SC-006**: The 72 already-published PB-P001 english-only issues are recorded in the
  SSOT, consistent with the served artifacts.

## Assumptions

_Informed defaults; the material scope decisions below are revisited in `/speckit-clarify`._

- **Rights determination** is a structured, affirmative field on the Source with a
  controlled value (e.g. `public-domain`); the publish gate requires it. PB-P001's current
  free-text "Public domain: likely" note is upgraded to an affirmative determination as
  part of enabling its publication. (Exact vocabulary + placement — top-level vs on a
  repository record — is a clarify/plan detail.)
- **Publication manifest location**: a dedicated location under the bibliography metadata
  (e.g. `bibliography/publications/`), named stably across re-publishes.
- **Version token**: the pinned snapshot archive-commit short identifies a build's version
  in the artifact key (a distinct build → a distinct key).
- **Both edition variants** (`parallel`, `english-only`) are in scope; the operator
  publishes whichever variant is built (scoping which to publish first is a later pass).
- **Canonical URL**: the recorded URL uses the configured read-through CDN base. A future
  custom-domain move (a stable public alias) is a plan-time concern, not a v1 blocker.
- **Publish scope**: this feature publishes the **PDF editions**. The corpus-browser
  **site's** public PD text/image export (the other half of the spec-007 deferral) is a
  related but separate mechanism; whether to fold it in is confirmed in clarify (captured,
  not cut).
- **Transaction classes**: uploading published artifacts is a write-class operation, not
  blocked by the public store's download cap; warming/verification reads are the capped
  class and are handled non-fatally.
- **Reproducibility**: the published PDFs are the deterministic output of `pdf:build` from
  a pinned snapshot; publishing records that pin so a publication is reproducible.

## Dependencies

- **Consumes (shipped)**: `corpus-print-pdf` (the PDF build layer + the snapshot pin +
  edition variants).
- **Consumes (closed)**: `canonical-source-metadata` (the Source / Repository-Record SSOT
  that `publications` extends), `archive-object-store` (the public B2 object store the
  artifacts are uploaded to).
- **Consumes (infra)**: the Cloudflare read-through CDN (`infra/cloudflare-cdn`, TASK-12)
  that fronts the public store for cache-served reads.
