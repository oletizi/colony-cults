# CLI Command Contracts: Source-Group Acquisition

All verbs are `gallica bib <subaction>` (dispatched via `runBibliography`). Convention: `--dry-run` reports intended writes and writes nothing; errors → stderr, non-zero exit; success → stdout. All commands **fail loud** — no fallbacks.

---

## `bib inventory <ark> --group <group-id> [--kind monograph|periodical] [--archive <name>] [--dry-run]`

Create a source-group member from an archival object.

- **Preconditions**: `<group-id>` resolves to an existing `kind: source-group`; `<ark>` is retrievable from the discovery/repository endpoint.
- **Effects**:
  - Allocates the next-free `PB-P###` id atomically (exclusive-create + retry).
  - Writes a member Source: `kind` (default `monograph`), `partOf: <group-id>`, `status: discovered`, titles/creator/identifiers from the retrieved record.
  - Writes a RepositoryRecord at `status: wanted` with `sourceArchive`, ark, `originalUrl`, `rightsRaw` + `rightsStatus`.
  - Writes an immutable **metadata snapshot** (raw response, `retrievedAt`, `endpoint`, `normalizationVersion`) referenced from the RepositoryRecord.
- **Errors (fail loud)**: group missing / not a source-group; ark unretrievable; id-allocation exhausted retries; write collision.
- **Exit**: `0` created (or dry-run reported); non-zero on any error.

---

## `bib verify-member <id> [--archive <sourceArchive>]`

Deterministic repository verification of one member copy. No relevance judgment, no status change.

- **Preconditions**: member exists; if it has >1 RepositoryRecord, `--archive` selects one (else fail loud); exactly-one infers.
- **Effects**: none (read-only). Emits a `Verdict`: `identifierResolved`, `rights`, `requiredMetadata`, `hardDuplicate`, `possibleDuplicate` (`passed` | `review-required` | `failed`), and an overall pass/fail.
- **Errors (fail loud)**: member missing; ambiguous copy with no `--archive`; network resolve error surfaced verbatim.
- **Exit**: `0` verdict emitted (pass or fail is in the verdict payload — a clean run that finds a failing check still exits `0`; a *tooling* error exits non-zero). *(Exact exit-on-failing-verdict semantics finalized in tasks; default: verdict is data, tooling errors are non-zero.)*

---

## `bib promote <id> [--archive <sourceArchive>] [--group <group-id>]`

Research approval: rerun verification, record verdict, advance lifecycle.

- **Preconditions**: member `status == discovered`; existing `partOf` resolves to a valid source-group; copy selected per `--archive` (infer-one).
- **Effects**:
  1. **Re-runs** the deterministic verification (same path as `verify-member`).
  2. On pass: records `verification` (result/verifiedAt/checks/snapshotRef) on the selected RepositoryRecord; advances Source `discovered → approved-for-acquisition`; advances the selected RepositoryRecord `wanted → to-collect`.
  3. On any failing check: **aborts**, records nothing, changes no status.
- **`--group` semantics**: assertion-only — must equal the existing `partOf` or fail loud; never sets/alters membership.
- **Errors (fail loud)**: member missing / not `discovered`; `partOf` unresolved; `--group` mismatch; ambiguous copy; verification fails.
- **Exit**: `0` promoted; non-zero on abort/error.

---

## `bib exclude-member <id> --reason <text>`

Terminal path for a discovered candidate that will not be acquired.

- **Preconditions**: member `status == discovered`.
- **Effects**: advances Source `discovered → excluded`; records the `--reason`.
- **Errors (fail loud)**: member missing / not `discovered`; empty reason.
- **Exit**: `0` excluded; non-zero on error. Reconsidering an excluded member back into the pipeline is a separate explicit operation.

---

## `bib acquire <id> [--archive <sourceArchive>] [--object-store] [--dry-run]`

Acquire an approved member's copy by reusing the shipped fetcher.

- **Preconditions**: member `status == approved-for-acquisition`; `rightsStatus == public-domain`; copy selected per `--archive` (infer-one); the selected RepositoryRecord carries the ark.
- **Effects**: resolves the ark from the selected RepositoryRecord and invokes the shipped fetcher (`fetch-source <ark> --source-id <id> --object-store`) → page images to object store, OCR, provenance. Advances the RepositoryRecord acquisition status via the fetcher's existing path. **No new fetch code.**
- **Errors (fail loud)**: member not approved; rights not public-domain; ambiguous copy; group itself passed (shipped guardrail blocks); fetcher error surfaced verbatim.
- **Exit**: `0` acquired (or dry-run reported); non-zero on error.

---

## Discovery helper (spike-selected; contract shape)

`bib discover <query> [--limit N]` (name/shape finalized by the spike task).

- **Effects**: queries the **single** spike-selected mechanism; returns `DiscoveryCandidate[]` (identifier + title/creator/date hints + endpoint) to stdout for the researcher's relevance judgment. Does **not** create members or judge relevance.
- **Errors (fail loud)**: mechanism unavailable → clear error, **no fallback** to another mechanism.
- **If the spike finds no reliable API**: this verb is not shipped; the pipeline is driven from operator-supplied candidate ARKs into `inventory`.
