# Feature Specification: Source-Group Acquisition

**Feature Branch**: `feature/source-group-acquisition`

**Created**: 2026-07-10

**Status**: Draft

**Input**: Operator-approved design record `docs/superpowers/specs/2026-07-09-source-group-acquisition-design.md` (roadmap item `impl:feature/source-group-acquisition`).

## Overview

The shipped source-groups feature deliberately made **PB-P004** (the Marquis de Rays legal corpus — indictment, proceedings, sentencing, appeal, government report) a `source-group` that cannot be fetched: it is a research-defined collection, not a single archival object. That was correct, but it left PB-P004 with **no members** and **no pipeline** to populate them. The actual court records are still un-acquired.

This feature builds a **reusable member-acquisition pipeline** for any source-group and runs it end-to-end on PB-P004. The pipeline separates deterministic software checks from research judgment:

```
Discover → Inventory → Repository verification → Research approval (Promote) → Acquire → Preserve
                                                        └→ Exclude (alternative outcome)
```

The deliverable is both the reusable `inventory` / `verify-member` / `promote` / `exclude-member` commands (plus a discovery search helper over one spike-selected mechanism) **and** the actually-acquired PB-P004 corpus as the v1 validation run.

"Repository verification" (the stage) denotes the **deterministic** checks over repository resolution, rights, required metadata, and copy identity — not general code quality. Its command is `verify-member`.

## User Scenarios & Testing *(mandatory)*

Actors are the **researcher/operator** (a person or an agent-assisted session) working the corpus, and the **software** that performs deterministic checks and archival acquisition. Each story is independently testable given fixtures for its predecessor's output.

### User Story 1 - Inventory a candidate as a source-group member (Priority: P1)

A researcher has identified a candidate archival object (an ARK) that belongs in a source-group's corpus and wants it recorded as a member with full provenance, without yet acquiring it.

**Why this priority**: Nothing downstream exists without member records. Inventory is the entry point and the foundation of the whole pipeline; it is the smallest slice that delivers standalone value (a durable, well-formed member record with preserved evidence).

**Independent Test**: Run `inventory <ark> --group PB-P004` against a known public-domain ARK and confirm it creates a member Source (flat opaque id, `partOf: PB-P004`, `status: discovered`) and a RepositoryRecord (`status: wanted`) that preserves both raw and normalized metadata.

**Acceptance Scenarios**:

1. **Given** a valid public-domain ARK and the existing source-group PB-P004, **When** the researcher runs `inventory <ark> --group PB-P004 --kind monograph`, **Then** a new member Source is created at the next-free flat opaque id (e.g. `PB-P007`) with `kind: monograph`, `partOf: PB-P004`, `status: discovered`, and no group prefix in the id.
2. **Given** the same command, **When** it completes, **Then** a RepositoryRecord is created at acquisition status `wanted` (never `to-collect`), carrying `sourceArchive`, the ark, `source_url`, `rightsRaw` (the archive's verbatim statement) and `rightsStatus` (the normalized project determination).
3. **Given** the same command, **When** it completes, **Then** the raw repository response is preserved as an immutable acquisition snapshot referenced by the RepositoryRecord (recording `retrievedAt`, `endpoint`, and `normalizationVersion`) alongside the normalized fields.
4. **Given** a `--group` that does not resolve to an existing `source-group`, **When** the researcher runs `inventory`, **Then** it fails loud with an informative error and creates nothing.
5. **Given** an ARK the archive reports as non-public-domain, **When** the researcher runs `inventory`, **Then** the member is recorded with `rightsStatus` other-than-public-domain and is flagged as not acquirable (only public-domain members are acquired downstream); its terminal path is `exclude-member` (US3), not promotion — inventory preserves the discovered candidate, and exclusion is the explicit next step.

---

### User Story 2 - Verify a member's repository copy (Priority: P2)

Before a member is considered for the corpus, the software confirms its repository copy is acquirable — deterministically, with no research judgment.

**Why this priority**: The deterministic gate protects the research-approval step and acquisition from resolvable-only-later failures (dead ARK, missing metadata, duplicate). It is a pure function of the member record and is testable in isolation.

**Independent Test**: Run `verify-member PB-P007` against inventoried fixtures (one clean, one dead-ARK, one duplicate, one missing-required-field) and confirm the machine verdict matches expectation for each, with no relevance judgment made.

**Acceptance Scenarios**:

1. **Given** an inventoried member whose ARK resolves, whose normalized rights permit acquisition, whose required metadata is present, and which is not a duplicate, **When** `verify-member PB-P007` runs, **Then** it emits a passing machine verdict.
2. **Given** a member whose ARK does not resolve, **When** `verify-member` runs, **Then** it emits a failing verdict naming the unresolved identifier and does not advance any status.
3. **Given** a member whose normalized `rightsStatus` does not permit acquisition, **When** `verify-member` runs, **Then** it fails the rights check explicitly.
4. **Given** a member sharing an ARK with an existing member of the same archive, **When** `verify-member` runs, **Then** it reports a **hard duplicate**.
5. **Given** a member with a matching normalized title/creator/date but a different ARK, **When** `verify-member` runs, **Then** it reports a **possible duplicate requiring review** (not a hard failure).
6. **Given** any input, **When** `verify-member` runs, **Then** it makes **no** determination about corpus relevance.
7. **Given** a member with more than one RepositoryRecord (copies at different archives), **When** `verify-member` runs without an archive selector, **Then** it fails loud requiring `--archive <sourceArchive>`; **When** exactly one RepositoryRecord exists, **Then** it verifies that one without a selector.

---

### User Story 3 - Promote a member (research approval) (Priority: P2)

A researcher judges a technically-valid member to be a relevant part of the corpus and records that approval, moving it from candidate to approved-for-acquisition.

**Why this priority**: This is the human judgment gate that keeps "valid archival object" distinct from "relevant member of this corpus." It is the transition acquisition depends on.

**Independent Test**: Run `promote PB-P007` against a verified member fixture and confirm promote re-runs deterministic verification, records the verdict, advances the Source `discovered → approved-for-acquisition` and the selected RepositoryRecord `wanted → to-collect`, with membership unchanged.

**Acceptance Scenarios**:

1. **Given** a member with `status: discovered` whose existing `partOf` resolves to a valid source-group, **When** the researcher runs `promote PB-P007`, **Then** promote **re-runs the deterministic repository-verification checks itself** and, only if they pass, advances the Source to `approved-for-acquisition` and the selected RepositoryRecord from `wanted` to `to-collect`.
2. **Given** promote re-runs verification, **When** it passes, **Then** promote **records the verification verdict** (result, `verifiedAt`, the checks, and the metadata-snapshot reference) on the member as provenance; **When** any check fails, **Then** promote fails loud, records nothing, and applies no status transition.
3. **Given** the promote command, **When** it runs, **Then** it treats the **existing `partOf` as authoritative** and never establishes or alters membership; the group is not re-supplied.
4. **Given** a `--group` flag is provided (operator clarity), **When** it does not equal the member's existing `partOf`, **Then** promote fails loud; **When** it equals the existing `partOf`, **Then** promote proceeds — the flag may only assert equality, never set membership.
5. **Given** a member with more than one RepositoryRecord, **When** `promote` runs without `--archive`, **Then** it fails loud requiring `--archive <sourceArchive>`; **When** exactly one RepositoryRecord exists, **Then** promote selects it without a selector.
6. **Given** a member whose `partOf` does not resolve to a valid source-group, **When** `promote` runs, **Then** it fails loud and changes nothing.
7. **Given** a member the researcher judges irrelevant (or one that failed verification, e.g. non-public-domain rights), **When** they run `exclude-member PB-P007 --reason "<text>"`, **Then** the Source advances `discovered → excluded` with the reason recorded — a **separate operation**, never a silent consequence of, or step after, approval.

---

### User Story 4 - Acquire an approved member to the object store (Priority: P1)

An approved member's archival object (page images, OCR, provenance) is pulled into the private archive/object store, reusing the shipped fetcher.

**Why this priority**: This is the ultimate point of the feature — getting the actual court records preserved. Along with Inventory it forms the value spine.

**Independent Test**: Given an approved-for-acquisition member fixture with a resolvable ARK in its RepositoryRecord, run the acquire step and confirm the object is fetched to the object store with provenance, and that the operator supplied only the source id (never the ARK separately).

**Acceptance Scenarios**:

1. **Given** an approved member whose RepositoryRecord carries the ARK, **When** the researcher acquires it, **Then** the acquire step **resolves the ARK from the RepositoryRecord** and drives the shipped fetcher (`--object-store`) to pull page images → object store, OCR, and provenance — the operator never supplies both the id and the ARK.
2. **Given** a member with more than one RepositoryRecord, **When** acquisition runs without `--archive`, **Then** it fails loud requiring `--archive <sourceArchive>`; **When** exactly one RepositoryRecord exists, **Then** acquisition selects it without a selector.
3. **Given** acquisition of a member, **When** the fetcher runs, **Then** no new fetch code is introduced — the shipped fetcher is reused unchanged.
4. **Given** an attempt to fetch the source-group **PB-P004 itself**, **When** the fetcher is invoked on it, **Then** the shipped guardrail still blocks it; the guardrail never blocks a member.
5. **Given** a member that is not `approved-for-acquisition`, **When** acquisition is attempted, **Then** it fails loud and fetches nothing.

---

### User Story 5 - Discover candidate records (agent-assisted) (Priority: P3)

A researcher searches an archive for candidate legal records for a source-group and judges which are original court records versus later historical accounts.

**Why this priority**: Discovery feeds the pipeline but is agent-assisted and gated behind a mechanism spike; the pipeline can be exercised from operator-supplied ARKs without it, so it is the lowest-priority slice for v1 mechanics while still being on the critical path for scale.

**Independent Test**: With the spike-selected mechanism configured, run the discovery search helper for a known query and confirm it returns candidate identifiers over exactly that one mechanism, failing loud (not falling back) when the mechanism is unavailable; relevance is left to the researcher.

**Acceptance Scenarios**:

1. **Given** the spike has selected one documented discovery mechanism, **When** the researcher runs the search helper for a query (e.g. *marquis de Rays procès*), **Then** it returns candidate identifiers using only that mechanism and leaves relevance judgment to the researcher.
2. **Given** the selected mechanism is unavailable, **When** the search helper runs, **Then** it **fails clearly** and does **not** fall back to another mechanism.
3. **Given** the spike finds no reliable API, **When** the feature ships, **Then** it explicitly accepts operator-supplied candidate identifiers rather than substituting fragile browser automation.

---

### Edge Cases

- **Different copy of an existing work**: a new ARK for a work already represented by a member attaches a **new RepositoryRecord to the existing Source**, not a new Source.
- **Newspaper trial coverage**: routes to the `PB-N###` newspaper namespace, not a PB-P004 member — a current single-`partOf` modeling constraint (the model's `partOf` is singular), not an absolute historical rule; revisit if multi-membership is ever modeled.
- **Re-inventorying an already-inventoried ARK**: creates a **new immutable metadata snapshot** rather than overwriting the original response.
- **Cross-domain status value**: writing a Source-lifecycle value onto a RepositoryRecord status (or vice-versa) is rejected as a vocab validation error.
- **Candidate `ark:/12148/bpt6k5785971m`** (from the guidance): must be verified as an *original* court record vs a later account; may end `excluded` or route elsewhere.
- **Approved source later found irrelevant**: requires an explicit reconsideration path to `excluded`, never a silent transition.
- **ID allocation race**: the next-free `PB-P###` id is derived by scanning existing sources; concurrent inventory must not allocate the same id.

## Requirements *(mandatory)*

### Functional Requirements

**Inventory**
- **FR-001**: The system MUST create a member Source from an ARK via `inventory <ark> --group <group-id> [--kind monograph]`, assigning the **next-free flat opaque id** in the `PB-P###` namespace with no group prefix. Id allocation MUST be **atomic** — scan for the maximum, attempt an exclusive create, and on collision rescan and retry — with **no mutable counter**, so concurrent inventory never allocates the same id.
- **FR-002**: The member Source MUST record `partOf: <group-id>` as the sole membership mechanism, `kind` (default `monograph`), and `status: discovered`.
- **FR-003**: Inventory MUST create a RepositoryRecord at acquisition status **`wanted`** (never `to-collect`), carrying `sourceArchive`, ark, `source_url`, `rightsRaw`, and `rightsStatus`.
- **FR-004**: Inventory MUST preserve the **raw repository response** as an immutable acquisition snapshot referenced by the RepositoryRecord, recording `retrievedAt`, `endpoint`, and `normalizationVersion`, alongside the normalized fields; re-inventory MUST create a new snapshot, never overwrite an existing one.
- **FR-005**: Inventory MUST fail loud when `--group` does not resolve to an existing `source-group`, creating nothing.

**Repository verification** (deterministic checks over one RepositoryRecord)
- **FR-006**: `verify-member <id> [--archive <sourceArchive>]` MUST perform only **deterministic** checks and make no corpus-relevance judgment.
- **FR-007**: Verification MUST confirm the repository identifier resolves, the normalized rights permit acquisition, and required metadata is present, failing loud and naming the failed check otherwise.
- **FR-008**: Verification MUST classify duplicates: **same ARK within the same archive → hard duplicate**; **matching normalized title/creator/date with a different ARK → possible duplicate requiring review**.
- **FR-009**: A different repository copy of a work already represented MUST attach a **new RepositoryRecord to the existing Source** (keyed by `(sourceId, sourceArchive)`), not create a new Source.
- **FR-009a**: When a member has more than one RepositoryRecord, `verify-member`, `promote`, and acquisition MUST require **`--archive <sourceArchive>`** to select the target record and MUST **fail loud on ambiguity**; when exactly one RepositoryRecord exists, the selector MAY be omitted and that record is used.

**Research approval / Promote**
- **FR-010**: `promote <id> [--archive <sourceArchive>]` MUST record research approval, advancing the Source `discovered → approved-for-acquisition` and the selected RepositoryRecord `wanted → to-collect`.
- **FR-010a**: Promote MUST **re-run the deterministic repository-verification checks (FR-006–FR-008) itself** before applying any status transition, and MUST **fail loud, transitioning nothing**, if any check fails — the invariant (nothing acquired unverified, SC-004) is enforced at the promote gate, never trusted from prior console output.
- **FR-010b**: On a passing re-verification, promote MUST **record the verification verdict as provenance** on the member — result, `verifiedAt`, the per-check outcomes, and the referenced immutable metadata snapshot — so the approval is auditable.
- **FR-011**: Promote MUST treat the member's **existing `partOf` as authoritative** and MUST NOT establish or alter membership; a `--group` flag, if present, MUST only assert equality with the existing `partOf`.
- **FR-012**: Promote MUST fail loud when the member's `partOf` does not resolve to a valid `source-group`.
- **FR-013**: `approved-for-acquisition` and `excluded` MUST be modeled as **alternative outcomes** of `discovered`; **exclusion MUST be a separate operation** with its own reconsideration path, never a silent step after approval.
- **FR-013a**: The system MUST provide `exclude-member <id> --reason <text>` performing the `discovered → excluded` transition and recording the reason. This is the defined terminal path for a discovered candidate that is not acquired (e.g. non-public-domain rights, judged irrelevant). Reconsidering an `excluded` member back into the pipeline MUST likewise be an explicit operation, never implicit.

**Acquire / Preserve**
- **FR-014**: Acquisition of an approved member MUST **resolve the ARK from the selected RepositoryRecord** (`--archive <sourceArchive>` per FR-009a) and drive the **shipped fetcher** (`--object-store`); the operator MUST NOT supply both the source id and the ARK.
- **FR-015**: Acquisition MUST introduce **no new fetch code** in v1 (the shipped fetcher is reused unchanged).
- **FR-016**: The shipped source-group guardrail MUST continue to block fetching a `source-group` itself while never blocking a member.
- **FR-017**: Acquisition MUST fail loud for any member not in `approved-for-acquisition`, and only **public-domain** members MUST be acquired.

**Discovery**
- **FR-018**: The discovery search helper MUST use exactly **one** documented mechanism selected by a gated spike, and MUST **fail loud when that mechanism is unavailable** — no runtime fallback chain.
- **FR-019**: If the spike finds no reliable API, the feature MUST accept **operator-supplied candidate identifiers** rather than substituting fragile browser automation.
- **FR-020**: Relevance judgment (original record vs later account) MUST remain a human/agent decision; the software MUST NOT auto-classify relevance.

**Cross-cutting**
- **FR-021**: All commands MUST **fail loud with informative errors** and MUST NOT implement fallbacks or mock data.
- **FR-022**: The two lifecycle vocabularies (Source lifecycle vs RepositoryRecord acquisition status) MUST remain disjoint; a cross-domain value MUST be rejected as a vocab validation error.
- **FR-023**: The pipeline MUST be **reusable for any source-group**, not special-cased to PB-P004.

### Key Entities *(include if feature involves data)*

- **Source (member)**: an archive-independent work that is a member of a source-group. Flat opaque `sourceId` (`PB-P###`), `kind`, `partOf` (the membership edge), and a `SourceLifecycleStatus` (`discovered` → `approved-for-acquisition` | `excluded`, alternative outcomes). Carries a recorded **verification verdict** (result, `verifiedAt`, per-check outcomes, snapshot reference) after promotion, and an **exclusion reason** when excluded.
- **Source Group**: an existing Source with `kind: source-group`; holds no member list (membership is derived from members' `partOf` edges) and is never fetchable.
- **RepositoryRecord**: one archive's held copy of a member — `sourceArchive`, ark, `source_url`, `rightsRaw` + `rightsStatus`, a `RepositoryAcquisitionStatus` (`wanted` → `to-collect` → `collecting` → `collected` → `archived`), and a reference to its metadata snapshot(s).
- **Metadata snapshot**: an immutable record of one raw repository response for a RepositoryRecord — `path`, `retrievedAt`, `endpoint`, `normalizationVersion`. Re-inventory appends a new snapshot.
- **Discovery candidate**: an identifier surfaced by the discovery helper, pending research relevance judgment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A researcher can take a public-domain ARK from candidate to preserved object store through the full pipeline (inventory → verify → promote → acquire) with the operator supplying the ARK only once (at inventory).
- **SC-002**: The PB-P004 Marquis de Rays legal corpus has its identified original court records acquired to the object store as the v1 validation run, each with preserved provenance and raw metadata.
- **SC-003**: The `inventory` / `verify-member` / `promote` commands operate unchanged on a **second, different** source-group (proving reusability, not PB-P004 special-casing).
- **SC-004**: 100% of acquired members are public-domain and `approved-for-acquisition`; no member reaches `approved-for-acquisition` without promote's re-run verification passing (enforced at the promote gate, FR-010a), and each carries a recorded verification verdict.
- **SC-005**: Every command fails loud with an informative message on its defined error conditions (unresolved group, dead ARK, non-public-domain rights, cross-domain status, unavailable discovery mechanism) — verified with negative-path fixtures.
- **SC-006**: For every inventoried member, the raw repository response is recoverable from an immutable snapshot after a later re-inventory (the original is never overwritten).

## Assumptions

- **Verification durability** (spec-review issue 2, operator decision 2026-07-10): **rerun + record** — `promote` re-runs the deterministic checks itself and records the verdict as provenance (FR-010a/FR-010b). `verify-member` remains a standalone inspection command; the acquire-safety invariant is enforced at the promote gate, not from prior console output.
- **RepositoryRecord selection** (spec-review issue 3): commands select a copy by **`--archive <sourceArchive>`** (the shipped `(sourceId, sourceArchive)` key), inferring the sole record when only one exists and failing loud on ambiguity (FR-009a) — no new RepositoryRecord id is introduced.
- **Raw-metadata storage model** (approval clarification 3): the recommended **separate immutable acquisition snapshot** referenced by the RepositoryRecord is adopted as the default. Whether this is recorded as an explicit amendment to the `004-canonical-source-metadata` data model is an open item for the planning phase.
- **Metadata-driven fetcher resolution** (`fetch-source <id> --repository`) is a **stated target, out of v1 scope** — it is new fetch code. v1 has the acquire step resolve the ARK from the RepositoryRecord internally and pass it to the unchanged fetcher.
- **Discovery mechanism** is resolved by the gated spike; the lead candidate is the BnF general-catalogue SRU (`catalogue.bnf.fr`), distinct from the anti-bot-blocked Gallica web search. The spec does not promise a search helper until the spike proves its underlying service.
- The shipped fetcher, source-group model, canonical-metadata model, and B2 object store are reused as-is (all shipped dependencies).
- The researcher/operator (possibly an agent-assisted session) performs relevance judgment; the software performs only deterministic checks and archival I/O.
- Only public-domain members are acquired; rights are normalized from the archive's statement, with the raw statement preserved as evidence.
