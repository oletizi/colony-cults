---
slug: 016-acquire-metadata-completion
targetVersion: ""
---

# Audit log — 016-acquire-metadata-completion

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-01 — The completion tail silently skips a fetched-but-not-injected acquire — contradicting its own "fails loud" comment

Finding-ID: AUDIT-20260719-01 (claude-01 + codex-02; cross-model)
Status:     open
Severity:   high
Per-lane:   claude=high, codex=high
Decision:   agreement (gate-counted high)
Surface:    src/sourcegroup/acquire.ts (completion-tail gate, new block ~446–470; AcquireInput doc ~155–175)

The tail runs only when `input.dryRun !== true && (mirroredMasters || completionInjected)`, where `mirroredMasters = acquisition.assets.length > 0` and `completionInjected = input.completionObjectStore !== undefined || input.gather !== undefined`. A Gallica-shaped acquire returns `assets: []`, so `mirroredMasters` is false; the tail then runs *only if the caller injected `gather` or `completionObjectStore`*. If a Gallica (or any fetch-only) acquire actually fetched per-page masters to the archive but the caller did **not** inject completion machinery, all three predicates are false, the `if` is skipped, and `runAcquire` falls straight through to returning success — status stays `to-collect`, bytes orphaned. That is precisely the Principle XV violation this feature exists to make impossible.

Worse, the `reconcileArchiveRoot` doc comment asserts the opposite: "Absent ⇒ the Gallica completion tail cannot run and **fails loud** (never silently skips advancing a fetched copy)." The code does not fail loud — absence of the machinery makes the guard false and the tail is silently skipped. An adopter (or unattended agent) reading that comment will believe the weld is mechanical when it is in fact conditional on optional injected parameters. The structural defect is that `runAcquire` cannot distinguish "pure dispatch, nothing to complete" from "fetched bytes, completion needed but machinery not wired" — both present as `mirroredMasters=false, completionInjected=false`. A fix needs a positive signal that a fetch wrote durable bytes (e.g. a `fetched`/`didWrite` flag on the acquisition result) so the tail can fail loud when that signal is set but no completion store/gather is available, instead of trusting the caller to always inject.

### AUDIT-20260719-02 — Zero-asset B2-direct acquires are misrouted into the Gallica reconcile path

Finding-ID: AUDIT-20260719-02
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire.ts:464-475

The completion tail decides to run when either masters were returned or *any* completion dependency was injected, then delegates path selection to `runReconcile` based on the persisted record shape. For a B2-direct CLI acquire, the CLI injects `completionObjectStore`; if the selected B2-direct adapter legitimately returns `assets: []` on a non-dry-run path, `mirroredMasters` is false but `completionInjected` is true, so `runReconcile` is called with only `objectStore` and no `archiveRoot`/`gather`. Because the record has no assets, `runReconcile` falls through to its archive-provenance path and throws for missing Gallica dependencies instead of treating this as a zero-master B2-direct outcome.

This shape is not hypothetical: the museum adapter has a documented HTML-only path that returns `assets: []` with `complete: true`, and dry-run is not the only empty-assets producer. The blast radius is high because an operator can hit this through normal `bib acquire` on a B2-direct record that mirrors no master bytes; the new completion tail converts an otherwise valid acquisition/cataloging outcome into a misleading Gallica-provenance failure. A reasonable fix is to make the completion path use an explicit acquisition/repository shape signal, or an explicit adapter outcome, rather than inferring Gallica-vs-B2 solely from `assets.length` plus which dependencies happened to be injected.

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-03 — Completion tail routes on `assets.length` alone, so a B2-direct adapter that emitted a `metadataSnapshotRef` with zero assets is silently skipped — orphaned snapshot bytes

Finding-ID: AUDIT-20260719-03
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire.ts:~535-555 (the `else if (acquisition.assets.length > 0)` branch and its trailing `else` no-op)

The B2-direct trigger is `else if (acquisition.assets.length > 0)`. The trailing comment justifies the `else` no-op as "a metadata/HTML-only cataloging outcome: there are no object-store bytes to orphan." But `AcquisitionResult` also carries `metadataSnapshotRef`, and `completeAndVerify` treats a set `metadataSnapshotRef` as a record-level snapshot that was written (it overlays `metadataSnapshot` onto the record and sets `expectsMetadataSnapshot: true`). A non-`gallica` adapter that returns `assets: []` **but** `metadataSnapshotRef: 'b2://…'` — precisely the "metadata/HTML-only" outcome the comment contemplates, except it *did* persist a snapshot to the store — falls through to the `else` no-op. `runReconcile` never runs, the acquisition `status` is never advanced, and `verifyRecordComplete` never confirms the snapshot. That is exactly the orphan XV names: bytes in B2 that the SSOT `status` (`to-collect`) does not reflect, with no fail-loud.

The routing predicate is the wrong invariant. The completion tail should fire whenever the adapter wrote *anything* durable — `acquisition.assets.length > 0 || acquisition.metadataSnapshotRef !== undefined` — not on `assets.length` alone. Blast radius: an unattended acquire of a copy whose adapter captures a metadata snapshot without page-image masters reports success while leaving the snapshot unrecorded and the record stuck at `to-collect`; a later operator sees a catalogued-but-uncollected record and cannot tell the snapshot exists. Add a fixture: non-gallica adapter, `assets: []`, `metadataSnapshotRef` set → the tail must complete + verify, not no-op.

---

### AUDIT-20260719-04 — Completeness path is re-derived from record shape, so a B2-direct acquire with an empty asset list passes through the Gallica branch untouched

Finding-ID: AUDIT-20260719-04
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire-completeness.ts:90-118 (branch pivot at the `masters.length > 0` test); CompletenessContext at :52-77

`verifyRecordComplete` decides B2-direct vs per-page-provenance **purely from the record's own asset shape** — `objectStoreMasters(record).length > 0`. But the caller already knows the adapter kind for a fact: the CLI (commit 54cbd25, "explicit adapter-kind path selection") injects `completionObjectStore` for museum/IA/papers-past and `reconcileArchiveRoot`+`gather` for Gallica (`bib-sourcegroup-acquire.ts:230-235`). That knowledge is thrown away at the gate — `CompletenessContext` has no adapter-kind / expected-shape input, so the verifier re-derives the path from `record.assets`.

The consequence is a false-negative on the exact defect Principle XV exists to catch. A museum/IA/papers-past acquire that mirrored bytes to B2 but recorded **zero** masters (adapter dropped its assets, partial write, upstream bug) has `masters.length === 0`, so it falls into the Gallica branch (:127-134) and **resolves** as long as `status` reached `collected` — never HEADing the store, never noticing the orphaned bytes. That is precisely "bytes in B2 the SSOT record does not reflect," which this verifier is the sole gate against. The gate cannot fire because it can't distinguish "legitimately per-page-provenance" from "B2-direct adapter that emitted nothing."

Fix: thread the adapter kind (or an `expectedMasterCount`/`isB2Direct` flag) into `CompletenessContext` — runAcquire already has it — and fail loud when a B2-direct acquire presents zero object-store masters, rather than silently reinterpreting it as Gallica-shaped.

### AUDIT-20260719-05 — Completion deps are chosen from built adapters, not the selected acquire path

Finding-ID: AUDIT-20260719-05
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/bib-sourcegroup-acquire.ts:195-233

`runAcquireCli` documents that the B2 adapters are “built only when THIS member’s selected copy is the matching identifier type” at lines 195-202, then derives `completionDeps` from whether any of those adapter builders returned something at lines 219-233. That makes the completion dependency channel depend on adapter construction side effects rather than the selected record’s actual dispatch kind. If a member has multiple repository records and `--archive` selects a Gallica/ARK copy while one of the B2 adapter builders still returns an adapter, the CLI injects only `completionObjectStore` and omits `reconcileArchiveRoot`/`gather`. The core acquire path then treats the dispatched Gallica adapter as requiring those omitted deps, so a valid selected Gallica acquire fails after doing the fetch work rather than completing status inline.

The blast radius is high because this breaks a normal operator workflow for multi-copy records: the feature’s stated goal is that `bib acquire` completes the SSOT record in the same operation, but the CLI can starve that selected path of its required completion machinery. A reasonable fix is to derive completion dependencies from the same selected-record/dispatch-kind decision used by `runAcquire`, or pass both dependency sets when available and let `runAcquire` select by `adapter.repository`. The existing `selectedCopyHasRecordedAssets` helper at lines 311-327 shows the file already has a selected-copy peek pattern; acquire completion should be wired to the selected copy, not to broad adapter availability.

## 2026-07-19 — dispositions (round 2 findings)

- **AUDIT-20260719-03** — FIXED (commit pending). runAcquire now fails loud on a B2-direct snapshot-only outcome (`assets: []` + `metadataSnapshotRef`) instead of skipping/misrouting; the routing invariant is the adapter kind, not `assets.length` alone. Regression fixture added (`AUDIT-03: ... fails loud`). No shipped adapter currently produces this shape; the guard makes it impossible to complete silently.
- **AUDIT-20260719-04** — FIXED (commit pending). The explicit adapter kind (`isB2Direct`) is threaded into `CompletenessContext`; the verifier no longer re-derives B2-direct-vs-Gallica from `record.assets` shape alone, and a B2-direct copy presenting ZERO masters now fails loud rather than resolving through the empty-assets Gallica branch. Verifier fixtures added (AUDIT-04 x3).
- **AUDIT-20260719-05** — FALSE POSITIVE (disposition: invariant-first boundary). The premise (a B2 adapter builder returning an adapter while `--archive` selects a Gallica copy) cannot occur: each `build*AdapterForMember` selects the copy via the SAME `selectRepositoryRecord(candidates, archive)` runAcquire dispatches on and returns `undefined` unless THAT selected copy is its identifier type. Thus `isB2Direct` equals the dispatched kind and `completionDeps` always matches the selected path; a `--archive`-selected Gallica copy is never starved of `reconcileArchiveRoot`/`gather`. Clarified with an explicit invariant comment at `bib-sourcegroup-acquire.ts` (the `isB2Direct` derivation).

## 2026-07-19 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260719-06 — Gallica completion dependencies are checked only after fetching

Finding-ID: AUDIT-20260719-06
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire.ts:431-542

`runAcquire` dispatches and executes `adapter.acquire(record, ctx)` at lines 431-437 before it validates that a non-dry-run Gallica acquire has `reconcileArchiveRoot` and `gather` at lines 530-542. That means the new fail-loud guard can still fire only after the Gallica fetcher has already written durable page images/provenance as side effects. The operation then reports failure, but it has created exactly the incomplete/orphan-prone state this feature is supposed to make mechanically impossible to finish into; it also violates the project’s frugal access discipline by making an external fetch whose result is discarded by the failed command.

The blast radius is high for direct `runAcquire` consumers and tests that inject the core API without CLI wiring: a missing completion dependency now fails loudly, but too late to prevent source requests and archive writes. A reasonable fix is to preflight path-required completion dependencies immediately after `registry.selectForRecord(record)` and before `adapter.acquire` for any non-dry-run `adapter.repository === 'gallica'`. For B2-direct paths, either require the head-capable store before side effects for adapters that can mirror masters, or make the adapter outcome expose a no-bytes plan before commit; the key issue here is that known-required Gallica machinery is already knowable before line 437.

### AUDIT-20260719-07 — Optional `isB2Direct` with silent inference fallback re-opens the exact channel the AUDIT-04 fix closed

Finding-ID: AUDIT-20260719-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/sourcegroup/acquire-completeness.ts:110-111 (the `const b2Direct = ctx.isB2Direct ?? masters.length > 0` fallback); CompletenessContext.isB2Direct declared optional

The AUDIT-04 fix was explicitly meant to stop a B2-direct acquire that recorded zero masters from being silently reinterpreted as the empty-assets Gallica shape. The mechanism it added is an *optional* `isB2Direct?: boolean`, resolved with `const b2Direct = ctx.isB2Direct ?? masters.length > 0`. Auditing this fix as a fresh surface (round-0 self-red-team): the fix does not close the channel, it gates the closure on every caller remembering to thread the flag. Any call site that omits `isB2Direct` — a future caller, a refactor of `runAcquire`, a test, or a second entry point — silently reverts to `masters.length > 0` inference, which is precisely the buggy behavior AUDIT-04 documented: a B2-direct record that failed to record masters has `masters.length === 0`, infers `b2Direct = false`, takes the Gallica branch, and resolves as complete having HEADed nothing. The module doc asserts "runAcquire always does" thread it, but that assertion is unenforced here and unverifiable from this chunk.

This is the fallback-hides-failure pattern the project's own guidelines forbid ("Never implement fallbacks... Throw errors with a description of the missing functionality"). The blast radius is the core Principle XV guarantee: an unattended acquire could report success over zero verified bytes. A stronger fix makes the field required (`isB2Direct: boolean`) so the type system forces every caller to state the dispatched kind, or throws when it is absent for a record whose kind cannot be safely inferred. The inference-only path should exist, if at all, only behind an explicit `inferKind: true` opt-in that unit tests pass deliberately.

### AUDIT-20260719-08 — Dry-run Gallica acquire still requires an archive root

Finding-ID: AUDIT-20260719-08
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/bib-sourcegroup-acquire.ts:239-244

The CLI comment says `--dry-run` is exempt because it mirrors nothing, but `completionDeps` eagerly calls `resolveArchiveRoot(repoRoot)` for every non-B2 selected copy before `runAcquire` sees `dryRun`. `resolveArchiveRoot` fails loud when `COLONY_ARCHIVE_ROOT` is unset, so `bib acquire <gallica-id> --dry-run` can fail in a fresh or metadata-only environment even though the completion tail is supposed to be skipped.

This is a real operator-facing correctness bug: dry-run is the safe preflight path, and the new completion wiring makes it depend on private archive worktree configuration that should only be needed for a real Gallica completion. A reasonable fix is to make completion deps conditional on `!dryRun`, or at least avoid resolving `reconcileArchiveRoot` until the non-dry-run Gallica branch actually needs it.

## 2026-07-19 — dispositions (round 3 findings)

- **AUDIT-20260719-06** — FIXED. Completion machinery is now PREFLIGHTED immediately after `registry.selectForRecord(record)` and BEFORE `adapter.acquire` (the fetch/mirror side effect), for both paths: a non-dry-run Gallica acquire requires `reconcileArchiveRoot` + `gather`, a non-dry-run B2-direct acquire requires `completionObjectStore`. Failing before the fetch means no orphan-prone durable state is written and no external fetch is spent on a command that will fail. Dispatch/characterization tests that drive a real acquire now inject the machinery (matching production).
- **AUDIT-20260719-07** — FIXED. `CompletenessContext.isB2Direct` is now REQUIRED (no `?? masters.length > 0` fallback). The type system forces every caller to state the dispatched kind; the fallback-hides-failure path that could revert to the AUDIT-04 false-negative is gone (Principle V). All verifier unit tests thread the explicit kind.
- **AUDIT-20260719-08** — FIXED. The CLI resolves completion + companion machinery (`resolveObjectStoreConfig` / `resolveArchiveRoot`) ONLY for a non-dry-run acquire; `bib acquire <id> --dry-run` no longer depends on private archive/B2 configuration and works in a fresh/metadata-only environment.

## 2026-07-20 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260720-01 — Snapshot-only guard still creates the orphan it rejects

Finding-ID: AUDIT-20260720-01
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire.ts:479-500, src/sourcegroup/acquire.ts:566-581

For B2-direct adapters, `runAcquire` persists adapter-emitted `metadataSnapshotRef` only inside the `acquisition.assets.length > 0` block at lines 479-500. The new snapshot-only branch at lines 566-581 throws when `metadataSnapshotRef` is present with zero assets, but that check runs after `adapter.acquire(record, ctx)` has already completed. A `metadataSnapshotRef` is, by contract, a reference to a durable snapshot the adapter already wrote, so this path refuses success while still leaving the durable snapshot unrecorded in the SSOT.

That means the fail-loud guard prevents a false success but does not prevent the orphaned snapshot state it names. The blast radius is high for any B2-direct adapter that follows the `AcquisitionResult` contract and emits a snapshot ref without page masters: an unattended adapter author can reasonably read this branch as protective, but the side effect has already happened. A reasonable fix would either make snapshot-only completion a real path in `runAcquire` before throwing is possible, or make the adapter contract reject/predict that shape before durable snapshot creation.

## 2026-07-20 — dispositions (round 5 finding)

- **AUDIT-20260720-01** — FIXED. The snapshot-only fail-loud fired AFTER `adapter.acquire` had already written the durable snapshot, so it refused success while leaving the snapshot unrecorded (the orphan it named). Replaced the throw with the real completion: the persist block now records `metadataSnapshotRef` on the SSOT whenever the adapter emits one (decoupled from `assets.length`), so a snapshot-only outcome is reflected in the record (no orphan) and the acquire succeeds — companions are still written only for mirrored masters. The AUDIT-03 test now asserts the snapshot is recorded, not a throw. No shipped adapter produces this shape; the persist decoupling makes it impossible to drop silently.

## 2026-07-20 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260720-02 — B2-direct completeness silently ignores recorded assets without objectStoreKey

Finding-ID: AUDIT-20260720-02
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire-completeness.ts:75-133

`objectStoreMasters()` filters `record.assets` down to only assets with a non-empty `objectStoreKey`, and the B2-direct branch verifies only that filtered list. That means a B2-direct record with mixed assets, for example one valid `objectStoreKey` asset plus one emitted asset missing `objectStoreKey`, will pass completeness while silently ignoring the malformed recorded asset. The zero-master guard only catches the all-missing case; it does not catch partial omission.

The downstream blast radius is high because this verifier is the fail-loud gate before acquire reports success. A B2-direct adapter or record writer regression could lose object-store linkage for one page/master while still passing as complete if another page has a valid key. A reasonable fix is to make the B2-direct path validate the asset set before filtering: every asset that represents a mirrored master must have a non-empty `objectStoreKey` and checksum, or the verifier should throw naming the offending asset/source.

## 2026-07-20 — dispositions (round 6 finding)

- **AUDIT-20260720-02** — FIXED. The B2-direct verifier iterated only `objectStoreMasters()` (assets WITH a non-empty `objectStoreKey`), so a record with one valid asset plus one asset missing its key passed while silently ignoring the malformed one (the zero-master guard only caught the all-missing case). The verifier now iterates the FULL recorded asset set and fails loud on any asset missing its `objectStoreKey` or `checksum` before HEADing — no partial omission slips through. Two regression fixtures added.

## 2026-07-20 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260720-03 — Per-page path silently skips verification when assets are present

Finding-ID: AUDIT-20260720-03
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire-completeness.ts:157-168

The `isB2Direct === false` branch treats the record as per-page-provenance and only checks that `ctx.reconciled.status` is `collected` or `archived`. It does not assert that `assets` is empty, even though the documented Gallica/per-page shape is explicitly `assets: []` and “acquired no object-store masters” in the error text. That means a caller bug, bad migration, or malformed record with recorded object-store assets plus `isB2Direct: false` will bypass every `objectStoreKey`, `checksum`, and `ObjectStore.head` check and still report complete.

Blast radius is high because this verifier is the fail-loud completion gate: a downstream acquire can be reported complete while recorded masters are missing or corrupt, which directly breaks the stated “FULL asset set” / no-orphan-assets guarantee. A reasonable fix is to make the false branch enforce its invariant, e.g. reject `assets.length > 0` for per-page-provenance unless there is a separately modeled, verified non-B2 asset shape.

### AUDIT-20260720-04 — B2 dry-runs still construct B2 adapters before the dry-run exemption applies

Finding-ID: AUDIT-20260720-04
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/cli/bib-sourcegroup-acquire.ts:203-250

The new dry-run exemption only delays `resolveObjectStoreConfig()` for the completion object store at lines 237-250, but the CLI has already called `buildMuseumAdapterForMember`, `buildInternetArchiveAdapterForMember`, and `buildPapersPastAdapterForMember` at lines 203-209. For a selected B2-direct record, those builders construct the real adapter and resolve B2/private archive dependencies before `completionDeps` is computed. In particular, the museum and Papers Past builders resolve B2 config while building their adapters, and the IA builder resolves both archive root and B2 config. So `bib acquire <B2-direct id> --dry-run` can still fail in a fresh metadata-only environment even though lines 231-250 state dry-run “MUST NOT depend on that configuration.”

Blast radius is high because this is a user-visible correctness defect in the advertised dry-run path and in the explicit AUDIT-20260719-08 fix surface: an operator validating a B2-direct acquire without private config will fail before the acquire dry-run can run. A reasonable fix is to thread dry-run into the adapter-builder decision, or provide dry-run-capable lightweight adapters that do not resolve B2/archive dependencies until a real mirror is requested.

### AUDIT-20260720-05 — Zero-asset B2-direct success tests encode a contract contradiction

Finding-ID: AUDIT-20260720-05
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire.test.ts:1009-1060, src/sourcegroup/acquire.test.ts:1063-1105

The new tests assert that B2-direct acquires with `assets: []` should succeed, persist only a snapshot, or leave status untouched. That conflicts with the verifier contract introduced for spec 016: B2-direct completion is supposed to prove object-store-backed masters are present and advance status to `archived`; zero B2-direct masters are an incompleteness, not a completed acquire. The tests at lines 1009-1060 and 1063-1105 make this no-op/snapshot-only path a blessed behavior.

Blast radius is high because these tests are executable specification for future implementation work. A downstream agent can reasonably preserve this behavior and bypass the completion verifier for B2-direct zero-master outcomes, causing `runAcquire` to report success while the SSOT remains `to-collect` or only partially updated. A reasonable fix is to align the tests with the invariant: B2-direct non-dry-run outcomes either produce verifiable masters and advance to `archived`, or fail loud with a specific completeness error.

## 2026-07-20 — dispositions (round 7 findings)

- **AUDIT-20260720-03** — FIXED. The per-page-provenance (isB2Direct:false) verifier branch now asserts its invariant: a per-page copy carrying object-store assets fails loud (its bytes would otherwise bypass every objectStoreKey/checksum/HEAD check). Regression fixture added.
- **AUDIT-20260720-04** — PARTIAL / SCOPED. My AUDIT-08 comment overclaimed that dry-run is fully config-free. Corrected: spec 016 no longer makes dry-run resolve archive/B2 config (Gallica dry-run in particular), but the PRE-EXISTING B2 adapter builders (specs 011/013/015) resolve B2 config while constructing the adapter regardless of --dry-run. Making those builders dry-run-lightweight is a cross-adapter change out of this feature's scope — filed as backlog TASK-48 (dry-run-lightweight-b2-adapter-builders). Comment corrected to not overclaim.
- **AUDIT-20260720-05** — RESOLVED (working-as-intended, guarded + clarified). A zero-master B2-direct outcome is LEGITIMATE for the documented museum HTML-only path (`masterImageUrl === null` -> `assets: [], complete: true`), so failing it loud would break a real adapter path. But codex's concern (zero-master must not BLINDLY pass) is now guarded: a zero-master B2-direct outcome succeeds ONLY when the adapter AFFIRMS `complete: true`; `complete: false` fails loud. Tests clarified to cite the museum HTML-only path + the complete-flag guard; a fail-loud fixture for `complete: false` added.

## 2026-07-20 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260720-06 — Idempotency test measures only the completion store, not duplicate acquire writes

Finding-ID: AUDIT-20260720-06
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire.test.ts:876-905

The re-run test says it “heals it with 0 duplicate object-store writes,” but the only write counter is `fakeObjectStore.putCount` on the completion store at lines 889 and 904-905. That store is only used by the completion tail’s HEAD checks; it is not the store used by the adapter to mirror bytes. The adapter fixture at line 888 is `acquiringMuseumAdapter([asset])`, which always behaves as if acquisition happened again and has no instrumentation for fetches or uploads.

The blast radius is high because this test can bless a non-idempotent rerun path: production may re-fetch or re-upload an already-recorded master while the test still reports “0 duplicate writes.” Given this project’s frugal acquisition policy and rate-limit sensitivity, that is a real operational defect. A reasonable fix is to either make `runAcquire` short-circuit already-recorded assets into reconcile/verify only, or instrument the adapter-side write/fetch path in this test and assert it is not invoked on the orphan-healing rerun.

## 2026-07-20 — dispositions (round 8 finding)

- **AUDIT-20260720-06** — FIXED (test). The idempotent re-run test asserted "0 duplicate object-store writes" via the COMPLETION store's putCount, which is heads-only and therefore vacuously 0 — it never proved the ADAPTER did not re-mirror already-held bytes. Replaced the fixture with `idempotentMuseumAdapter`, which models the shipped adapter's content-addressed INV-E (short-circuit when the master is already recorded + present) and instruments its own mirror path; the re-run test now asserts `mirrorCount() === 0` (adapter did not re-fetch/re-upload) in addition to status healing to archived. Adapter-level idempotency itself is still owned + tested by the adapter's own suite; this asserts runAcquire's re-run drives that short-circuit rather than forcing a re-mirror.

## 2026-07-20 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260720-07 — completeAndVerify verifies an in-memory record shape that drops `qualityAssessment`/`excludedLeaves` that `persistAcquisition` wrote to disk

Finding-ID: AUDIT-20260720-07
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire-complete.ts:55-66 (completeAndVerify's `completedRecord`) vs :129-165 (`persistAcquisition`'s `updatedRecords`)

`persistAcquisition` writes the acquired record to the SSOT with four adapter-authored fields — `assets`, `qualityAssessment`, `excludedLeaves`, and `metadataSnapshot`. But `completeAndVerify` reconstructs a *separate* in-memory `completedRecord` for `verifyRecordComplete` that spreads only **two** of them:

```js
const completedRecord: RepositoryRecord = {
  ...record,
  ...(acquisition.assets.length > 0 ? { assets: acquisition.assets } : {}),
  ...(acquisition.metadataSnapshotRef !== undefined
    ? { metadataSnapshot: acquisition.metadataSnapshotRef } : {}),
};
```

`qualityAssessment` and `excludedLeaves` are silently omitted. `verifyRecordComplete` trusts the record it is *handed* (it is not re-loaded from disk — otherwise the param would be pointless), so the verifier sees a shape that has already drifted from what was persisted. This is duplicated record-shape construction (persist builds it once with four fields, complete rebuilds it with two) that has *already* diverged — the exact bug-factory the project guidelines warn about.

Blast radius: if `verifyRecordComplete` (in the sibling chunk `acquire-completeness.ts`, not visible here) derives its expected-vs-held asset count from `excludedLeaves` — the natural way to express "N pages total minus K deliberately-excluded = expected masters" — then verifying against a record *missing* `excludedLeaves` yields the wrong expected count and a wrong verdict. A false-complete verdict is precisely the Principle XV orphan-slips-through failure this feature exists to prevent; a false-incomplete verdict fails a good acquire loud. This escalates to `blocking` if `acquire-completeness.ts` references either field, and is at minimum a latent fragility today. Fix: build the completed shape **once** (share a helper with `persistAcquisition`, or have `completeAndVerify` re-load the just-persisted record) so verify can never diverge from what was written.

## 2026-07-20 — dispositions (round 10 finding)

- **AUDIT-20260720-07** — FIXED. `completeAndVerify` reconstructed a separate in-memory record (only `assets` + `metadataSnapshot`), dropping `qualityAssessment`/`excludedLeaves` that `persistAcquisition` wrote — a duplicated, already-diverged record shape (latent today: the verifier does not yet read those fields, but a bug-factory). Now `completeAndVerify` RE-LOADS the just-persisted + reconciled record from disk and verifies THAT (the single source of truth), so the verifier can never judge a shape that drifted from what was written. (Round 9 also FATALed govern on file size — acquire.ts/acquire.test.ts exceeded the 500-line/24576-byte envelope; split into acquire-fixtures.ts + acquire-completion.test.ts and extracted the completion machinery into acquire-complete.ts, no behavior change.)

## 2026-07-20 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260720-08 — completeAcquisition advances-then-verifies: a verify failure leaves a falsely-`collected` status persisted on disk

Finding-ID: AUDIT-20260720-08
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire.ts:410 (the `completeAcquisition` call) + JSDoc at src/sourcegroup/acquire.ts:143-158; ordering realized in src/sourcegroup/acquire-complete.ts (not in this chunk)

The `completionObjectStore` JSDoc (acquire.ts:147-152) states the completion tail "reuses the idempotent `runReconcile` (heads-only) to advance the record's acquisition `status`, **then** `verifyRecordComplete` to confirm every recorded master is present + matching in the store BEFORE reporting success." So the ordering is: (1) `runReconcile` advances and **persists** `status` to the SSOT file (persisting is the whole job of the `reconcile` verb), (2) `verifyRecordComplete` runs and throws on any gap. Critically, AUDIT-20260720-02 (commit 6709f71) exists precisely because the completion verifier had to validate the **full** asset set rather than a "key-present subset" — which tells us reconcile's own advancement criterion (HEAD/key-presence) is strictly weaker than verify's (full set + matching). That gap is the hazard: a truncated/mismatched-but-present master (HEAD 200, wrong bytes/size) lets `runReconcile` advance `status` to `collected` and write it, and only then does `verifyRecordComplete` throw. The acquire fails loud (good), but the on-disk record is now left at `collected` for a record whose masters failed verification.

That is a false-positive completion state, and it is worse than the honest `to-collect` orphan the reconcile.ts REPAIR-ONLY note (reconcile.ts:35-42) assumes: an operator or an unattended downstream agent glancing at the SSOT sees `collected`/complete for a record that actually failed integrity verification, and treats the corrupt/partial master as acquired — the exact Principle XV failure (metadata not faithfully reflecting the assets) this feature is meant to make impossible. The blast radius is a mislabeled asset silently entering the corpus's "done" set after a real integrity failure.

A reasonable fix: `completeAcquisition` must run `verifyRecordComplete` **before** persisting any status advance (verify-then-advance), or capture the pre-advance status and revert it on a verify throw so a failed acquire never leaves an advanced status on disk. I could not confirm the ordering because `completeAcquisition`/`runReconcile` are in another chunk — verdict PLAUSIBLE, but the visible JSDoc asserts the advance-then-verify order explicitly, so this needs checking in `acquire-complete.ts`.

---

### AUDIT-20260720-09 — The completeness verifier never reads `record.status`; it gates on the in-memory `ctx.reconciled.status`, reopening exactly the divergent-in-memory-shape hole AUDIT-20260720-07 closed

Finding-ID: AUDIT-20260720-09
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   single-model (gate-counted high)
Surface:    src/sourcegroup/acquire-completeness.ts (b2Direct status gate `if (ctx.reconciled.status !== 'archived')` and per-page gate `if (!ACQUIRED_STATUSES.has(ctx.reconciled.status))`)

`verifyRecordComplete` reads `record.assets`, `record.sourceId`, `record.sourceArchive`, and `record.metadataSnapshot` — but it **never reads `record.status`**. Both status gates key on `ctx.reconciled.status`, the in-memory outcome the reconcile step *reported*, not the status the record actually persisted. This is the last line of defense before `runAcquire` reports success, and its entire mandate (per the module doc: "does the SSOT record FULLY reflect the bytes this acquire holds?") is to validate the *record*. Yet the one field that encodes acquisition status on the record is unchecked.

The failure mode is precisely the Principle XV defect this feature exists to prevent, and precisely what commit 90dea82 ("verify the on-disk record, not a divergent in-memory shape (AUDIT-20260720-07)") was supposed to have closed. If reconcile returns `{ status: 'archived' }` in memory but its write of `record.status` silently didn't land (partial write, exception after the return value was computed, a stale record object threaded in), the record on disk still reads `status: 'to-collect'` with masters sitting in B2 — the exact orphan-with-stale-status the CLAUDE.md commandment names as a DEFECT — and this verifier passes it as complete because it consulted the in-memory outcome instead of the persisted field. The test suite cannot catch this: every fixture keeps `record.status` and `ctx.reconciled.status` in lockstep (e.g. `b2Record({ status: 'to-collect' })` is always paired with `reconciled: { status: 'to-collect' }`), so the divergent case is never exercised.

A correct fix asserts the record's own persisted status: throw unless `record.status` itself is `archived` (B2-direct) / an acquired value (per-page), and additionally assert `record.status === ctx.reconciled.status` so a reconcile that reported one thing and persisted another fails loud. Trusting `ctx.reconciled.status` alone means the "on-disk record" verifier is still verifying an in-memory shape.

---

## 2026-07-20 — dispositions (round 11 findings)

- **AUDIT-20260720-09** — FIXED. `verifyRecordComplete` gated both status checks on the in-memory `ctx.reconciled.status`, never the persisted `record.status` — so a reconcile that reported a status but failed to persist it would pass. The verifier now judges the record's OWN persisted `status` (the caller hands it the disk-reloaded record) AND cross-checks `record.status === ctx.reconciled.status`, so a status advance that did not land fails loud. Two regression fixtures added (divergent report-vs-persisted; a non-archived persisted B2 status).
- **AUDIT-20260720-08** — RESOLVED by the AUDIT-09 fix. The advance-then-verify ordering cannot leave a falsely-advanced status once the verifier gates on the PERSISTED status: reconcile and verify share the same head+checksum advancement criterion (reconcile throws on a checksum mismatch and only advances when every recorded asset heads present + matching; the museum path iterates the full asset set), so a verify that throws implies the status was never advanced (still `to-collect`), and the new cross-check catches any report-vs-persist divergence. There is no reachable path where reconcile persists an advanced status while verify then throws.

## 2026-07-20 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260720-10 — Fail-loud negative tests assert the throw but never assert the persisted record stayed unadvanced

Finding-ID: AUDIT-20260720-10
Status:     open
Severity:   high
Per-lane:   claude=high
Decision:   adjudicated (gate-counted high) — blast-radius=high, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/sourcegroup/acquire-completion.test.ts:74-110, 362-394 (tests: master-missing, checksum-mismatch, complete:false)

The three negative B2-direct tests verify only that `runAcquire` rejects — they never re-load the sources dir and assert the record was left `to-collect`. This is exactly the invariant this feature spent its last three commits welding down: "verify the PERSISTED record.status." Consider a regression where the completion tail advances the record to `archived` on disk *first* and only *then* runs the master-present / checksum verification and throws. All three tests (`fakeObjectStore({})` → master missing; stored `sha256:'d'*64` → mismatch; `complete:false` → zero-master) would still pass on the `rejects.toThrow` alone, while leaving precisely the orphan the spec forbids — an `archived`-status record whose master is absent or checksum-mismatched. The blast radius is high: an unattended agent refactoring `acquire.ts` (advance/verify ordering, transaction boundaries) gets a green suite while shipping the orphan-status corruption Principle XV exists to prevent, because the negative path's *only observable* is the exception, not the surviving on-disk state.

The fix mirrors the positive tests: after each `await expect(...).rejects.toThrow(...)`, `loadAllSources(dir)` and assert `record?.status === 'to-collect'` and (for the missing/mismatch cases) that no divergent `metadataSnapshot`/`assets` were persisted. Test 1 already demonstrates the load-and-assert pattern; the negative tests should apply it to the failure path, which is where the corruption actually lands.

## 2026-07-20 — dispositions (round 12 finding)

- **AUDIT-20260720-10** — FIXED (test). The three fail-loud B2-direct negatives (master-missing, checksum-mismatch, complete:false) asserted only `rejects.toThrow` and never that the on-disk record stayed unadvanced, so a regression that advanced status before verifying would pass green while leaving an orphan. Each negative now re-loads the sources dir after the throw and asserts `record.status === 'to-collect'`. This also empirically confirms the AUDIT-08 resolution — a failed acquire leaves no falsely-advanced status.

## 2026-07-20 — audit-barrage lift (end-govern-after_implement)

### AUDIT-20260720-11 — Museum idempotency fixture uses the wrong asset role

Finding-ID: AUDIT-20260720-11
Status:     open
Severity:   high
Per-lane:   codex=high
Decision:   adjudicated (gate-counted high) — blast-radius=unstated, reachability=unstated, fix-debt=no; no down-calibration signal — high retained.
Surface:    src/sourcegroup/acquire-fixtures.ts:247-259, src/sourcegroup/acquire-fixtures.ts:365-386

`sampleAsset()` emits a museum master with `role: 'front'` at line 256, but the shipped New Italy Museum adapter’s convergence seam records and recognizes the master as `role: 'primary'`. The idempotency fixture then compounds that mismatch by finding a recorded asset by `objectStoreKey` only at line 379 and returning the passed-in `asset` at lines 384-386. That does not model production behavior, where the adapter only short-circuits when the recorded primary master is present with its recorded checksum.

The blast radius is high because downstream tests using `sampleAsset()` plus `idempotentMuseumAdapter()` can assert “orphan-healing rerun does not re-fetch/re-mirror” for an on-disk shape the real adapter would not treat as already acquired. A reasonable fix is to make the museum fixture use `role: 'primary'` and make `idempotentMuseumAdapter()` mirror the production lookup more closely: select the recorded primary asset, `head(recorded.objectStoreKey)`, compare against `recorded.checksum`, and return `recorded` on the idempotent path.

## 2026-07-20 — dispositions (round 13 finding)

- **AUDIT-20260720-11** — FIXED (fixture fidelity). `sampleAsset()` used `role: 'front'`, but the shipped New Italy Museum adapter records + recognizes its master as `role: 'primary'` (recordedMasterAsset finds `role === 'primary'`), and `idempotentMuseumAdapter` matched by objectStoreKey only and returned the passed-in asset. Fixed both: sampleAsset now uses `role: 'primary'`, and the idempotency fixture mirrors the production seam — find the recorded `primary` master, HEAD its own recorded key, compare its recorded checksum, and return the RECORDED asset on the short-circuit. The re-run idempotency assertion now models an on-disk shape the real adapter would treat as already acquired.
