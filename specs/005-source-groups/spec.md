# Feature Specification: Source Groups

**Feature Branch**: `feature/source-groups`

**Created**: 2026-07-09

**Status**: Draft

**Input**: User description: "Source Groups — a first-class `source-group` kind for research-defined collections that are discovered before they can be acquired (trial corpora, correspondence, parliamentary papers, manuscript collections). Roadmap item: impl:feature/source-groups. Resolves backlog TASK-3 (pb-p004-source-layout). Builds on the shipped impl:feature/canonical-source-metadata. Approved design record: docs/superpowers/specs/2026-07-09-source-groups-design.md."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Refuse to acquire a collection, with a helpful redirect (Priority: P1)

A researcher (or an automated acquisition step) references an identifier that names a
**research-defined collection** rather than a single archival object — for example
`PB-P004`, the Marquis de Rays legal corpus. There is no single archival object behind
it to fetch. Today the attempt fails with an opaque "unregistered source" error. With
this feature, the system recognizes the identifier as a **source group** and refuses the
fetch/acquire with a loud, informative message that redirects the user to the correct
action: discover and inventory the group's members, then acquire the members.

**Why this priority**: This is the concrete resolution of backlog **TASK-3** and the
headline user value — it converts a confusing dead-end into an actionable instruction. It
is the minimum viable slice: even with nothing else, a collection identifier stops
failing opaquely.

**Independent Test**: Mark a source as a source group, attempt to fetch/acquire it, and
confirm the operation fails loudly with a message naming the identifier and instructing
the user to discover/inventory/acquire its members (not a generic error, not a silent
skip, not a partial fetch).

**Acceptance Scenarios**:

1. **Given** a source recognized as a source group, **When** a fetch/acquire of that
   identifier is attempted, **Then** the operation fails loud with a message that names
   the identifier, states it is a source group, and directs the user to discover and
   acquire its members.
2. **Given** a source that is NOT a source group (an ordinary monograph or periodical),
   **When** a fetch/acquire is attempted, **Then** the guardrail does not trigger and the
   existing acquisition behavior is unchanged.
3. **Given** a source group, **When** its non-fetchability is evaluated, **Then** the
   determination is keyed on the source's kind, not on any naming convention of the
   identifier.

---

### User Story 2 - Model a collection as a source group with members (Priority: P2)

A cataloguer needs to describe a body of evidence as a container of member works rather
than as a single work. A source group holds **members** (each an independently
catalogued Source, linked to the group) and deliberately holds **no** repository records,
because a collection is not itself a held copy. Validation enforces the split so a record
cannot be half-collection, half-object.

**Why this priority**: This is the data-model foundation that makes the P1 guardrail
meaningful and durable. It is separable from P1: the guardrail keys on kind, while this
story adds the full members-vs-repository-records validation contract.

**Independent Test**: Author a source-group record with members and no repository
records — it validates. Author a source-group record with zero members — it also
validates (declared-but-unpopulated). Author a source-group record that carries
repository records — validation rejects it with a specific reason. Author an ordinary
source that carries members — validation rejects it.

**Acceptance Scenarios**:

1. **Given** a source-group record with one or more members and no repository records,
   **When** it is validated, **Then** validation passes.
2. **Given** a source-group record that carries repository records, **When** it is
   validated, **Then** validation fails, stating a source group must not hold repository
   records.
3. **Given** a source-group record with no members yet, **When** it is validated, **Then**
   validation passes (a declared-but-unpopulated group is valid), provided it holds no
   repository records and remains non-fetchable.
4. **Given** an ordinary monograph/periodical record that carries members, **When** it is
   validated, **Then** validation fails, stating only a source group may hold members.
5. **Given** a member and its group, **When** the membership relationship is inspected,
   **Then** the member is resolvable to exactly one group and the group is resolvable to
   its members.

---

### User Story 3 - Track members through a discovery pipeline (Priority: P3)

Members of a collection are not acquired in one step — they are **discovered**,
inventoried, verified, and only then **approved for acquisition** before the existing
acquisition flow takes over. Some discovered candidates are deliberately **excluded**
(duplicate / irrelevant / superseded / out-of-scope) yet retain research value and must be
preserved, not deleted. The status vocabulary needs new values so a member's position in the
pipeline Discover → Inventory → Verify → Promote → Acquire → Preserve — and an intentional
exclusion — is expressible and validated.

**Why this priority**: It makes the collection lifecycle first-class, but the P1 guardrail
and P2 model deliver value without it. It is additive and independently testable.

**Independent Test**: Set a member's status to `discovered`, `approved-for-acquisition`, or
`excluded` and confirm validation accepts it; confirm the previously-existing statuses
continue to validate unchanged.

**Acceptance Scenarios**:

1. **Given** a member record with status `discovered`, **When** it is validated, **Then**
   validation passes.
2. **Given** a member record with status `approved-for-acquisition`, **When** it is
   validated, **Then** validation passes.
3. **Given** a discovered candidate that is intentionally excluded, **When** it is recorded
   with status `excluded` and a reason in `notes`, **Then** validation passes and the record
   (with its exclusion rationale) is retained in the SSOT rather than deleted.
4. **Given** any record using a pre-existing status value, **When** it is validated,
   **Then** validation behaves exactly as before this feature.

---

### User Story 4 - Reclassify PB-P004 as the first source group (Priority: P3)

The live example, `PB-P004` (French / Marquis de Rays legal corpus), is currently
mis-modeled as a `monograph` with a single `to-collect` repository record. It must be
reclassified as a source group, its single repository record migrated into a members
list, and its member works (indictment / proceedings / sentencing / appeal / government
report) seeded as they are discovered. The migration must not break the existing
derivation and validation of the bibliography.

**Why this priority**: It applies the new model to the real record that motivated the
feature. It depends on P1–P3 being in place, so it is sequenced last.

**Independent Test**: After migration, `PB-P004` validates as a source group (members
present, no repository records, non-fetchable), the whole bibliography still validates,
and any derived outputs still build without error.

**Acceptance Scenarios**:

1. **Given** the migrated `PB-P004` record, **When** the bibliography is validated,
   **Then** `PB-P004` validates as a source group and the full bibliography still
   validates.
2. **Given** the migrated record, **When** a fetch/acquire of `PB-P004` is attempted,
   **Then** the P1 guardrail fires with the informative redirect.
3. **Given** trial newspaper coverage of the corpus, **When** it is catalogued, **Then**
   it is filed under the `PB-N###` newspaper series, not as a `PB-P004` member.
4. **Given** the candidate `ark:/12148/bpt6k5785971m`, **When** it is recorded, **Then**
   it remains a candidate needing verification and is not auto-promoted to an acquired
   member.

---

### Edge Cases

- **A source group nested inside a source group.** Whether a member may itself be a
  source group (a collection-of-collections) is out of scope for this feature; the model
  should not forbid it accidentally but the pipeline and validation target one level.
- **A member referencing a non-existent group**, or a **group listing a non-existent
  member** — validation must fail loud with the dangling reference named, not silently
  drop it.
- **A member with no stable archival identity yet** (no ARK/DOI/ISBN/OCLC/repository id)
  — it is treated as requiring discovery, not acquisition, even before it is formally
  marked, so an accidental fetch of an un-acquirable member also fails informatively.
- **An empty collection** (a group declared before any member is discovered) — valid per
  FR-005; validation still enforces no repository records and non-fetchability on the
  zero-member group.
- **A record that is both marked a source group and carries repository records** — a
  contradiction that validation must reject rather than resolve by precedence.

## Clarifications

### Session 2026-07-09

- Q: Member identity scheme for source-group members? → A: Each member gets its own
  stable, opaque `PB-###` id plus an explicit membership edge — structure is a
  relationship, not encoded in the id (model-consistent with the shipped canonical
  opaque-id principle). Hierarchical `PB-P004-001` ids rejected.
- Q: How is the group↔member link represented? → A: The **member** carries
  `part_of: <group-id>`; the group's member list is **derived** from those edges (single
  source of truth, no bidirectional state to keep in sync).
- Q: Is a zero-member (declared-but-unpopulated) source group valid? → A: Yes — a group
  may exist with no members yet, matching the discover-before-acquire premise. Validation
  still enforces no repository records and non-fetchability regardless of member count.
- Q: Where does the pre-promotion candidate inventory live? → A: Candidates are **member
  stubs carrying `status: discovered`** (maturing to `approved-for-acquisition`, then the
  existing acquisition statuses) — one record type and one pipeline, no parallel store.

### Session 2026-07-09 (design review)

- Q: How is an intentionally-excluded discovery preserved (duplicate / irrelevant /
  superseded / out-of-scope)? → A: Add an **`excluded`** status value; the excluded stub is
  retained in the SSOT with the reason in its `notes` field. Preserves discovery history
  without a separate store (single-record-type decision upheld). Raised by third-party spec
  review (Rec 4). The review's other points either matched existing decisions or (its
  hierarchical `PB-P004-003` ID example) conflicted with the settled flat-opaque-ID
  decision (FR-007) and were not adopted.
- Q: Should the Source lifecycle values (`discovered`/`approved-for-acquisition`/`excluded`)
  and the RepositoryRecord acquisition values (`wanted`/`to-collect`/`collecting`/`collected`/
  `archived`) continue to share one flat 8-value status vocabulary? → A: No — **split into two
  distinct, per-entity vocabularies** (`SourceLifecycleStatus` and `RepositoryAcquisitionStatus`
  in `src/bibliography/vocab.ts`) so the type system and runtime validator reject cross-domain
  values: a `Source` authored with an acquisition-only value (e.g. `archived`) now fails loud at
  load, and a `RepositoryRecord` authored with a discovery-only value (e.g. `discovered`/
  `excluded`) is reported as a `vocab` validation finding. A Source's lifecycle and a
  RepositoryRecord's acquisition status are different state machines with a one-way handoff at
  `approved-for-acquisition`, not one shared pipeline. Raised by PR review.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Source model MUST support a `source-group` kind in addition to the
  existing `periodical` and `monograph` kinds. A source group represents a
  research-defined collection of member works, not a single archival object.
- **FR-002**: A source group MUST NOT itself be fetchable/acquirable. Any attempt to
  fetch or acquire a source group MUST fail loud and informatively, naming the identifier
  and directing the user to discover, inventory, and acquire the group's members.
- **FR-003**: The non-fetchability determination MUST key on the source's **kind**, not
  on identifier naming conventions. The general rule the system MUST apply: a source
  lacking a stable archival identity (ARK/DOI/ISBN/OCLC/repository id) is assumed to
  require discovery, not acquisition.
- **FR-004**: RepositoryRecord MUST remain a **separate entity** — it MUST NOT be folded
  into the kind vocabulary. The model's two axes (a Source's kind; the RepositoryRecord
  entity that records a held copy) MUST be preserved.
- **FR-005**: A source group MUST NOT hold repository records and MUST NOT be fetchable,
  **regardless of how many members it has** — a zero-member (declared-but-unpopulated)
  source group is valid, matching the discover-before-acquire premise. Non-group sources
  MUST hold repository records and MUST NOT hold members. Validation MUST enforce this
  split (group ⇒ no repository records, non-fetchable; non-group ⇒ no members) and fail
  loud with a specific reason when it is violated.
- **FR-006**: A member MUST carry a `part_of: <group-id>` edge linking it to exactly one
  source group; a member's membership is stated on the member record. The group's member
  list MUST be **derived** from those edges — the edge is the single source of truth, and
  the group record does NOT maintain a redundant member list. Validation MUST fail loud
  when a `part_of` edge names a non-existent group.
- **FR-007**: Each member MUST carry its own **stable, opaque `PB-###` identifier**,
  consistent with the shipped canonical principle that identifiers are permanent and
  structure is a relationship (the `part_of` edge), not encoded in the identifier.
  Hierarchical composite ids (e.g. `PB-P004-001`) MUST NOT be used.
- **FR-008**: The system MUST express the collection lifecycle Discover → Inventory → Verify →
  Promote → Acquire → Preserve, plus intentional exclusion, via **two distinct, per-entity
  closed vocabularies** rather than one shared vocabulary — a `Source`'s own lifecycle status
  (`discovered`, `approved-for-acquisition`, `excluded`) is a separate state machine from a
  `RepositoryRecord`'s acquisition status (`wanted`, `to-collect`, `collecting`, `collected`,
  `archived`), linked only by a one-way handoff: a Source's lifecycle ends at
  `approved-for-acquisition`, at which point a RepositoryRecord may be authored for it beginning
  at `wanted`/`to-collect`. A candidate that is discovered but deliberately not promoted
  (duplicate / irrelevant / incomplete / superseded / out-of-scope) MUST be recordable as
  `excluded` with the reason captured in the record's existing `notes` field — the discovery is
  preserved, not deleted, so the exclusion and its rationale remain in the SSOT. All
  previously-valid RepositoryRecord acquisition status values MUST continue to validate
  unchanged. **Cross-domain values MUST be rejected**: authoring a RepositoryRecord acquisition
  value (e.g. `archived`) on a `Source` MUST fail loud at load; authoring a Source lifecycle
  value (e.g. `discovered`/`excluded`) on a `RepositoryRecord` MUST be reported as a validation
  finding.
- **FR-009**: `PB-P004` MUST be reclassified from a monograph-with-repository-record into
  a source group whose single existing `to-collect` repository record is migrated into a
  members list. The migration MUST NOT break existing bibliography derivation or
  validation.
- **FR-010**: Members of `PB-P004` MUST be seedable as they are discovered (indictment /
  proceedings / sentencing / appeal / government report), each becoming an independently
  acquirable Source once it has a stable archival identity. Trial newspaper coverage MUST
  be filed under the `PB-N###` series, not as `PB-P004` members. The candidate
  `ark:/12148/bpt6k5785971m` MUST remain a candidate needing verification, not
  auto-promoted.
- **FR-011**: The guardrail's refusal MUST be observable to a user or automated caller
  (a clear failure with an actionable message), not a silent no-op or a partial result.

### Key Entities *(include if feature involves data)*

- **Source**: An archive-independent work. Gains a `source-group` kind alongside
  `periodical` and `monograph`. A source group is a container of members and holds no
  held-copy records; the other kinds hold repository records and no members.
- **Member (of a source group)**: A Source that belongs to exactly one source group,
  linked by a membership relationship. Independently catalogued and — once it has a stable
  archival identity — independently acquirable.
- **RepositoryRecord**: Unchanged, separate entity — the held copy of a Source at a given
  archive (ARK, rights, assets). Present on non-group sources; absent on source groups.
- **Source lifecycle status vocabulary**: The closed set of values (`discovered`,
  `approved-for-acquisition`, `excluded`) a `Source` itself may carry, tracking its
  discovery/approval position — a distinct vocabulary from a RepositoryRecord's acquisition
  status, with `excluded` preserving an intentionally-excluded discovery (reason in `notes`).
- **RepositoryRecord acquisition status vocabulary**: The unchanged closed set of values
  (`wanted`, `to-collect`, `collecting`, `collected`, `archived`) a `RepositoryRecord` may carry,
  tracking a held copy's own acquisition/preservation progress. A Source's lifecycle vocabulary
  and this one are separate — cross-domain values are rejected by validation.
- **Discovery record / candidate inventory**: The pre-promotion inventory of candidate
  members (title / creator / ARK / repository / rights / relevance / status). Represented
  as **member stubs carrying `status: discovered`** — the same record type that later
  matures to `approved-for-acquisition` and then the existing acquisition statuses. No
  separate parallel store.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of attempts to fetch/acquire a source group fail with an informative
  message that names the identifier and states the corrective action; 0% fail with the
  previous opaque "unregistered source" error.
- **SC-002**: A cataloguer can distinguish a collection from a single work from the record
  alone, without consulting external notes — the record's kind states it.
- **SC-003**: 100% of malformed records (group-with-repository-records,
  group-without-members, non-group-with-members, dangling membership references) are
  rejected by validation with a specific, named reason.
- **SC-004**: After the `PB-P004` migration, the full bibliography still validates and all
  previously-passing records continue to pass — zero regressions in existing validation.
- **SC-005**: Every member's position in the Discover → … → Acquire lifecycle is
  expressible with a validated status value.

## Assumptions

- **Migration default**: `PB-P004`'s current single `to-collect` repository record is
  rewritten into the members list in place, preserving its identifier and existing
  metadata, so downstream CSV/derivation and validation continue to operate without a
  schema break. (Design open question "migration mechanics" — reasonable default; the
  concrete migration steps are settled during planning.)
- **Kind-keyed behavior default**: The "never acquire a source group" and "no stable id ⇒
  discovery" rules are encoded so the acquisition engine keys on the source's kind, not on
  identifier naming conventions. (Design open question "vocab/agent-behavior encoding" —
  the design already decided kind-keying; treated here as settled, not open.)
- **Discovery-record location** (resolved in Clarifications): candidate members are
  represented as member stubs carrying `status: discovered` rather than a separate
  parallel store, keeping one record type through the pipeline.
- **Builds on shipped canonical model**: The shipped `impl:feature/canonical-source-metadata`
  (Source / RepositoryRecord separation, opaque stable ids, closed vocabularies) is the
  substrate; this feature extends it and does not re-litigate it.
- **One level of grouping**: The pipeline and validation target a single level of
  collection membership; collection-of-collections is neither required nor deliberately
  forbidden.

## Dependencies

- **impl:feature/canonical-source-metadata** (shipped) — provides the Source /
  RepositoryRecord model, opaque stable identifiers, and closed status vocabulary this
  feature extends.
- **Backlog TASK-3 (pb-p004-source-layout)** — this feature resolves it; the guardrail
  (US1) is the concrete fix.
- **Approved design record** — `docs/superpowers/specs/2026-07-09-source-groups-design.md`
  is the source of truth for scope and the carried-forward open questions.
