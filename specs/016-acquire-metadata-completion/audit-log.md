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
