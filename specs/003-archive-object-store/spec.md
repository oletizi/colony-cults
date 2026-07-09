# Feature Specification: Archive Object Store (Backblaze B2)

**Feature Branch**: `feature/archive-object-store` (spec dir `specs/003-archive-object-store`)

**Created**: 2026-07-08

**Status**: Draft

**Roadmap item**: `impl:feature/archive-object-store` (design-approved)

**Design record**: `docs/superpowers/specs/2026-07-08-archive-object-store-design.md`

**Input**: Move the archive's full-resolution image masters out of git and into an S3-compatible object store (Backblaze B2), so git keeps only small, diff-friendly research assets while the binary preservation masters live in object storage — addressed as an object-store backend for the fetcher's archive-writer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Image masters land in object storage, not git (Priority: P1)

The archivist runs the fetcher to capture a newspaper issue's page images. The
full-resolution image masters are written to the object store (Backblaze B2), and
the git-tracked archive records only where each master lives and how to verify it
(object key + checksum + size) — no image bytes enter git. The census, per-asset
provenance, OCR text, and integrity manifest continue to live in git.

**Why this priority**: This is the entire point of the feature. Git cannot
delta-compress JPEGs, so every master sits at full size in history forever; the
archive `.git` reached ~2.1 GB for a single source and pushes began timing out.
Keeping masters out of git is what makes the archive scale across the remaining
sources and future cases while preserving the masters.

**Independent Test**: Fetch one issue against an isolated archive worktree; confirm
the working tree and git index contain no image bytes, the object store holds each
page master at its expected key, and the git-tracked provenance for each page
records the object key, sha256, and size.

**Acceptance Scenarios**:

1. **Given** a configured object store and valid credentials, **When** the fetcher
   captures an issue's page images, **Then** each image master is uploaded to the
   object store at a key that mirrors its archive path, and no image bytes are
   written into the git working tree.
2. **Given** a page master has been uploaded, **When** the fetcher records
   provenance, **Then** the git-tracked companion record for that page includes the
   object store provider, bucket, key, endpoint, sha256, and size.
3. **Given** an issue has been captured, **When** the archivist inspects the git
   status, **Then** only small research assets (census, provenance, OCR text,
   manifest) appear as changes — never `.jpg`/`.jpeg`/`.png` bytes.

---

### User Story 2 - Resumable, idempotent capture (Priority: P2)

The archivist re-runs a capture that was interrupted (e.g. a sleep-interrupted run
that left stragglers). Already-uploaded masters are recognized and skipped; only
the missing masters are uploaded. The archivist can force a re-upload when needed,
and can verify that every recorded master still matches what is in the object store.

**Why this priority**: Captures are long-running and interruptible. Without
resumability every restart re-uploads everything (slow, wasteful) or risks gaps.
This mirrors the existing skip-if-recorded behavior the archive-writer already has
for local files, extended to the object store.

**Independent Test**: Run a capture to completion; re-run it and confirm every
master is skipped with zero uploads; delete or corrupt one recorded master's object
and confirm `--verify` reports exactly that one as a mismatch; run with `--force`
and confirm the master is re-uploaded.

**Acceptance Scenarios**:

1. **Given** a page master already exists in the object store with the recorded
   sha256, **When** the fetcher runs again, **Then** that master's upload is skipped
   and reported as skipped.
2. **Given** the archivist passes `--force`, **When** the fetcher runs, **Then**
   the master is re-uploaded regardless of an existing object.
3. **Given** the archivist passes `--verify`, **When** verification runs, **Then**
   each recorded master is pulled from the object store by key and its sha256 is
   compared to the recorded value, and any mismatch or missing object is reported.

---

### User Story 3 - The archive stays verifiable and restorable (Priority: P2)

Because the masters no longer live in git, the archive's integrity guarantee must
now span git (provenance) and the object store (bytes). Given the git-tracked
provenance alone, the archivist can locate every master in the object store and
prove it is byte-identical to what was captured.

**Why this priority**: The masters are the preservation truth. If the git record
cannot authoritatively locate and verify the bytes, the split between git and the
object store has weakened the archive rather than scaled it.

**Independent Test**: From a fresh clone containing only the git-tracked records,
resolve every page master's object key from provenance, fetch it, and confirm its
sha256 matches the recorded value for a full issue.

**Acceptance Scenarios**:

1. **Given** only the git-tracked provenance for an issue, **When** the archivist
   resolves object keys and fetches masters, **Then** every master is retrievable
   and checksum-matches its recorded sha256.
2. **Given** the integrity manifest, **When** the archivist audits an issue,
   **Then** the manifest and per-asset provenance agree on the recorded checksums.

---

### User Story 4 - Fetch the straggler issues via the new backend (Priority: P3)

The ~5 PB-P001 issues left incomplete by a sleep-interrupted run are captured with
the object-store backend, so their masters go straight to the object store and
never touch git.

**Why this priority**: These stragglers are known outstanding work that should be
completed through the new path rather than the old git-writing path, avoiding a
fresh round of git bloat.

**Independent Test**: Identify the straggler issues, capture them with the backend
enabled, and confirm their masters are in the object store with git-tracked
provenance and no image bytes in git.

**Acceptance Scenarios**:

1. **Given** the list of straggler issues, **When** they are captured with the
   object-store backend, **Then** each completes with masters in the object store
   and provenance in git, and no image bytes are added to git.

---

### Edge Cases

- **Missing or unreadable credentials** → the run fails loud with a clear message;
  it does not silently fall back to writing bytes into git.
- **Credentials file parsing quirk** → the secret key line uses a tab after its
  key name; parsing must strip leading whitespace including tabs. A wrong strip
  yields an authentication failure, which must surface as a loud, actionable error.
- **Upload failure** (network, auth, quota) → fails loud; the partial state is
  detectable and resumable on re-run (no half-recorded provenance claiming an
  upload that did not happen).
- **Checksum mismatch** on verify → reported as a hard failure naming the asset,
  never silently repaired or ignored.
- **Object exists but recorded sha256 differs** → treated as a mismatch, not a
  skip; surfaced for the archivist to resolve (or overwritten only under `--force`).
- **Concurrent archive activity** → a separate process (the translation session)
  may be writing to the archive repo's working tree at the same time; the capture
  must operate in an isolated worktree so the two never collide (see Assumptions).
- **OCR needs the image bytes** → OCR currently reads the local page image; with
  masters in the object store the OCR path must have the bytes available at the
  moment it runs (see FR-013 and the open clarification).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The archive-writer MUST support an object-store backend that writes
  image masters to an S3-compatible object store (Backblaze B2) instead of the git
  working tree.
- **FR-002**: On writing a master, the system MUST upload the bytes to the object
  store and MUST NOT leave the image bytes in the git working tree or index.
- **FR-003**: The object key for a master MUST mirror that master's archive path
  (e.g. `archive/cases/port-breton/newspapers/la-nouvelle-france/<date>_<ark>/f001.jpg`).
- **FR-004**: The system MUST record, in the git-tracked companion record for each
  master, the object store location (provider, bucket, key, endpoint) alongside the
  master's sha256 and size.
- **FR-005**: Git MUST continue to track census, per-asset provenance, OCR issue
  text, and the integrity manifest. Git MUST NOT track image master bytes.
- **FR-006**: The system MUST skip uploading a master when the object already exists
  in the object store with the recorded sha256 (resumable, idempotent capture).
- **FR-007**: The system MUST provide a `--force` mode that re-uploads a master even
  when a matching object already exists.
- **FR-008**: The system MUST provide a `--verify` mode that fetches each recorded
  master from the object store by key and compares its sha256 to the recorded value,
  reporting any mismatch or missing object.
- **FR-009**: The system MUST read object-store credentials from the operator's
  credentials file and MUST pass them to the client via environment variables, never
  as command-line arguments. Credential parsing MUST strip leading whitespace
  including tabs from field values.
- **FR-010**: The system MUST read non-secret configuration (bucket, endpoint,
  region) from a source that is not committed to git (a gitignored archive config or
  the tool config). Secrets MUST NOT be committed to git.
- **FR-011**: The system MUST fail loud — with a clear, actionable error and a
  non-zero result — on missing/unreadable credentials, authentication failure,
  upload failure, or checksum mismatch. It MUST NOT fall back to writing bytes into
  git or to mock behavior.
- **FR-012**: The system MUST be able to capture the known straggler PB-P001 issues
  through the object-store backend, producing object-store masters with git-tracked
  provenance and no image bytes in git.
- **FR-013**: The OCR and verify paths MUST have access to a master's bytes when
  they need them, given the master no longer resides in git. [NEEDS CLARIFICATION:
  should OCR run at fetch time while bytes are still local (before upload, no
  post-upload local copy retained), or should OCR/verify fetch bytes from the object
  store on demand? This determines whether a local image ever persists after upload.]
- **FR-014**: All development and testing that touches the archive repository MUST
  occur in a dedicated git worktree of the archive repository (its own branch and
  working tree), never in the shared archive clone that the translation session is
  actively using. (Process/operational requirement; see Assumptions.)

### Key Entities

- **Image master**: the full-resolution page image (JPEG) that is the preservation
  truth. Now stored as an object in the object store, not in git.
- **Object-store location**: provider, bucket, object key, and endpoint identifying
  where a master lives in the object store; recorded in git-tracked provenance.
- **Provenance record (companion)**: the per-asset git-tracked record; extended to
  carry the object-store location in addition to the existing sha256 and size.
- **Integrity manifest**: the git-tracked checksum manifest (`MANIFEST.sha256`) that
  audits recorded checksums across the archive.
- **Credentials**: the operator's object-store key material (access key id + secret),
  read from a local file, never committed, passed via environment variables.
- **Archive worktree**: an isolated git worktree of the archive repository used for
  this feature's development and testing, decoupled from the shared clone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After capturing an issue with the backend enabled, the number of image
  master bytes added to git is zero (no `.jpg`/`.jpeg`/`.png` bytes in the git index
  or working tree).
- **SC-002**: Every image master captured with the backend is retrievable from the
  object store using only the git-tracked provenance, and 100% of retrieved masters
  match their recorded sha256.
- **SC-003**: Re-running a completed capture uploads zero masters (every already-
  present master is skipped), confirming idempotent resumability.
- **SC-004**: `--verify` detects 100% of introduced mismatches or missing objects
  (a corrupted or deleted object is always reported; a matching object is never
  falsely reported).
- **SC-005**: A missing-credential, upload-failure, or checksum-mismatch condition
  always produces a loud, non-zero failure and never a silent fallback or a
  git-written image byte.
- **SC-006**: The ~5 PB-P001 straggler issues are captured through the backend with
  masters in the object store and provenance in git.

## Assumptions

- **Isolated archive worktree**: development and testing use a dedicated git
  worktree of `colony-cults-archive` (own branch, own working tree). The shared
  clone at the archive path is on `main` with a dirty working tree owned by an
  active translation process and must not be touched. Worktrees share the same git
  object store, which is acceptable because this feature only reduces git content.
- **Backblaze B2, S3-compatible**: bucket `colony-cults`, endpoint
  `https://s3.us-west-004.backblazeb2.com`, region `us-west-004`. The app key is
  scoped to exactly this bucket. (Verified live in the design session: authorize,
  and a put/get/delete round-trip against the endpoint.)
- **Credentials source**: `~/.config/backblaze/b2-credentials.txt` (YAML with
  `keyID` / `keyName` / `applicationKey`; `keyID` = access key id, `applicationKey`
  = secret access key; the `applicationKey` line uses a tab after the colon).
- **Existing archive-writer semantics reused**: the current skip-if-recorded,
  `--force`, and `--verify` behaviors for local assets are the model the object-store
  backend mirrors; companion records and the manifest already exist.
- **Prior migration state**: the PB-P001 masters were already uploaded to the object
  store and checksum-verified in the design session; this feature is the backend that
  makes the fetcher write there going forward (plus the straggler capture).

## Out of Scope

- **One-time git-history purge**: stripping the historical `.jpg` bytes from the
  archive repo's git history and force-pushing to reclaim the ~2 GB (which subsumes
  backlog TASK-6) is BLOCKED on the translation session quiescing and is explicitly
  out of scope for this spec. It is a separate, coordinated operation.
- **Rejected alternatives** (context, not scope): Git LFS (recurring GitHub LFS
  storage + bandwidth cost); not storing bytes / re-fetching from Gallica on demand
  (abandons the preservation-mirror guarantee).

## Follow-ups

- **Rotate the object-store key**: the secret key was exposed in the design session
  transcript and MUST be rotated once the migration is complete.
